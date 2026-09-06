// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/server/prisma";
import { assignedCompanyId } from "@/server/biometric/classifyTimeLog";
import { reprocessEventIds } from "@/server/biometric/reprocess";

const VIEW_ROLES = new Set(["super_admin", "admin", "hr_staff", "user"]);

function assignedCompanyIds(session) {
  return [
    ...(Array.isArray(session?.user?.company_profile_ids) ? session.user.company_profile_ids : []),
    ...String(session?.user?.company_profile_id || "").split(","),
  ].map(value => String(value || "").trim()).filter(Boolean);
}

async function authorize(req, res, companyProfileId) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    res.status(401).json({ error: "Authentication required." });
    return null;
  }
  if (!VIEW_ROLES.has(session.user.role)) {
    res.status(403).json({ error: "Your role is not allowed to view biometric events." });
    return null;
  }
  if (session.user.role !== "super_admin" && !assignedCompanyIds(session).includes(String(companyProfileId))) {
    res.status(403).json({ error: "You are not assigned to this company." });
    return null;
  }
  return session;
}

export default async function handler(req, res) {
  const companyProfileId = String(req.method === "GET" ? req.query.company_profile_id : req.body?.company_profile_id || "").trim();
  if (!companyProfileId) return res.status(400).json({ error: "Company is required." });
  const session = await authorize(req, res, companyProfileId);
  if (!session) return;

  if (req.method === "GET") {
    const status = String(req.query.status || "").trim();
    const deviceId = String(req.query.device_id || "").trim();
    const devices = await prisma.biometricDevice.findMany({
      where: {
        OR: [
          { companyProfileId },
          { allowedCompanies: { some: { companyProfileId, status: "active" } } },
        ],
      },
      include: { allowedCompanies: { where: { status: "active" } } },
    });
    const authorizedDeviceIds = devices
      .filter(device => assignedCompanyId(device) === companyProfileId)
      .map(device => device.id);

    const events = await prisma.biometricTimeLog.findMany({
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

    return res.status(200).json({
      events: events.map(event => ({
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
        company_profile_id: event.companyProfileId,
        ingest_source: event.ingestSource,
        received_at: event.receivedAt,
        discarded_field_names: event.discardedFieldNames || [],
      })),
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const operation = String(req.body?.operation || "reprocess");
  if (operation !== "reprocess" && operation !== "reprocess_quarantine") {
    return res.status(400).json({ error: "Unsupported operation." });
  }

  const result = await reprocessEventIds({
    eventIds: req.body?.event_ids,
    explicitQuarantine: operation === "reprocess_quarantine",
    actorType: "user",
    actorId: session.user.email || session.user.id,
    companyProfileId,
  });
  return res.status(200).json(result);
}
