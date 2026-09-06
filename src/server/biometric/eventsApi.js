// @ts-nocheck
import { assignedCompanyId } from "./classifyTimeLog.js";

export function jsonResponse(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(payload);
}

export async function handleBiometricEventsRequest(req, res, deps) {
  const {
    authorize,
    prisma: store,
    interpretTimeLogs,
    rollbackInterpretation,
    dismissInterpretationReview,
    reprocessEventIds,
    requeueFailedInterpretation,
    listRecords,
    previewInterpretation,
  } = deps;

  try {
    const rawCompanyId = req.method === "GET" ? req.query?.company_profile_id : req.body?.company_profile_id;
    const companyProfileId = String(rawCompanyId || "").trim();
    if (!companyProfileId) return jsonResponse(res, 400, { error: "Company is required." });
    const session = await authorize(req, res, companyProfileId);
    if (!session) return;

    if (req.method === "GET") {
      const status = String(req.query.status || "").trim();
      const deviceId = String(req.query.device_id || "").trim();
      const devices = await store.biometricDevice.findMany({
        where: {
          OR: [
            { companyProfileId },
            { allowedCompanies: { some: { companyProfileId, status: "active" } } },
          ],
        },
        include: { allowedCompanies: { where: { status: "active" } } },
      });
      const authorizedDeviceIds = devices
        .filter((device) => assignedCompanyId(device) === companyProfileId)
        .map((device) => device.id);

      const events = await store.biometricTimeLog.findMany({
        where: {
          deviceId: deviceId ? { equals: deviceId } : { in: authorizedDeviceIds },
          ...(status ? { processingStatus: status } : {}),
          OR: [
            { companyProfileId },
            { companyProfileId: null, deviceId: { in: authorizedDeviceIds } },
          ],
        },
        include: { device: true },
        orderBy: { receivedAt: "desc" },
        take: 500,
      });

      const employees = listRecords
        ? await listRecords("Employee", { filter: { company_profile_id: companyProfileId }, limit: 10000 })
        : [];
      const employeeName = (employee) => [employee?.first_name, employee?.middle_name, employee?.last_name].filter(Boolean).join(" ").trim()
        || employee?.full_name
        || employee?.employee_id
        || null;

      return jsonResponse(res, 200, {
        events: events.map((event) => {
          const employee = employees.find((item) => String(item.id) === String(event.employeeRecordId))
            || employees.find((item) => String(item.employee_id) === String(event.employeeId));
          return {
            id: event.id,
            device_id: event.deviceId,
            device_serial: event.deviceSerial,
            log_id: event.logId,
            device_user_id: event.deviceUserId,
            occurred_at: event.occurredAt,
            occurred_at_local: event.occurredAtLocal,
            utc_timezone_minutes: event.utcTimezoneMinutes,
            attend_status: event.attendStatus,
            verify_method: event.verifyMethod,
            verify_method_normalized: event.verifyMethodNormalized,
            trans_id: event.transId,
            processing_status: event.processingStatus,
            employee_id: event.employeeId,
            employee_record_id: event.employeeRecordId,
            employee_name: employeeName(employee),
            company_profile_id: event.companyProfileId,
            ingest_source: event.ingestSource,
            received_at: event.receivedAt,
            discarded_field_names: event.discardedFieldNames || [],
            attendance_log_id: event.attendanceLogId,
            mapped_slot: event.mappedSlot,
            interpretation_code: event.interpretationCode,
            interpretation_message: event.interpretationMessage,
            review_reason: event.reviewReason,
            interpreted_at: event.interpretedAt,
          };
        }),
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return jsonResponse(res, 405, { error: "Method not allowed." });
    }

    const operation = String(req.body?.operation || "reprocess");
    const actor = {
      actorType: "user",
      actorId: session.user.email || session.user.id,
    };

    if (operation === "reprocess" || operation === "reprocess_quarantine") {
      const result = await reprocessEventIds({
        eventIds: req.body?.event_ids,
        explicitQuarantine: operation === "reprocess_quarantine",
        ...actor,
        companyProfileId,
      });
      return jsonResponse(res, 200, result);
    }

    if (operation === "interpret") {
      const result = await interpretTimeLogs(req.body?.event_ids, { ...actor, companyProfileId });
      return jsonResponse(res, 200, result);
    }

    if (operation === "apply_review") {
      const result = await interpretTimeLogs(req.body?.event_ids, { ...actor, applyReview: true, companyProfileId });
      return jsonResponse(res, 200, result);
    }

    if (operation === "rollback") {
      const eventIds = Array.isArray(req.body?.event_ids) ? req.body.event_ids : [];
      const results = [];
      for (const id of eventIds) results.push(await rollbackInterpretation(id, actor));
      return jsonResponse(res, 200, { results });
    }

    if (operation === "dismiss_review") {
      const eventIds = Array.isArray(req.body?.event_ids) ? req.body.event_ids : [];
      const results = [];
      for (const id of eventIds) results.push(await dismissInterpretationReview(id, actor));
      return jsonResponse(res, 200, { results });
    }

    if (operation === "requeue") {
      const eventIds = Array.isArray(req.body?.event_ids) ? req.body.event_ids : [];
      const results = [];
      for (const id of eventIds) results.push(await requeueFailedInterpretation(id, actor));
      return jsonResponse(res, 200, { results });
    }

    if (operation === "preview") {
      const eventIds = Array.isArray(req.body?.event_ids) ? req.body.event_ids : [];
      const employees = listRecords
        ? await listRecords("Employee", { filter: { company_profile_id: companyProfileId }, limit: 10000 })
        : [];
      const holidays = listRecords ? await listRecords("Holiday", { filter: { company_profile_id: companyProfileId }, limit: 5000 }) : [];
      const noWorkDays = listRecords ? await listRecords("NoWorkDay", { filter: { company_profile_id: companyProfileId }, limit: 5000 }) : [];
      const savedPeriods = listRecords ? await listRecords("PayrollPeriod", { filter: { company_profile_id: companyProfileId }, limit: 500 }) : [];
      const rows = await store.biometricTimeLog.findMany({
        where: { id: { in: eventIds.map((id) => String(id)) }, companyProfileId },
        include: { device: true },
      });
      const results = [];
      for (const event of rows) {
        const employee = employees.find((item) => String(item.id) === String(event.employeeRecordId));
        results.push({
          id: event.id,
          log_id: event.logId,
          device_serial: event.deviceSerial,
          device_user_id: event.deviceUserId,
          employee_id: event.employeeId,
          employee_name: employee ? [employee.first_name, employee.last_name].filter(Boolean).join(" ") : null,
          occurred_at: event.occurredAt,
          occurred_at_local: event.occurredAtLocal,
          attend_status: event.attendStatus,
          verify_method_normalized: event.verifyMethodNormalized || event.verifyMethod,
          processing_status: event.processingStatus,
          preview: previewInterpretation && employee
            ? await previewInterpretation(event, { employee, holidays, noWorkDays, savedPeriods, store: { listRecords } })
            : { ok: false, message: employee ? "Preview is unavailable." : "Employee record was not found." },
        });
      }
      return jsonResponse(res, 200, { results });
    }

    return jsonResponse(res, 400, { error: "Unsupported operation." });
  } catch (error) {
    console.error("Biometric events API failed:", error);
    if (res.headersSent) return;
    return jsonResponse(res, 500, { error: "Biometric events request failed.", code: "EVENTS_API_FAILED" });
  }
}
