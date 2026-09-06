// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/server/prisma";
import { listRecords } from "@/server/entityStore";
import { recordBiometricAudit } from "@/server/biometric/audit";
import { assignedCompanyId } from "@/server/biometric/classifyTimeLog";
import {
  inspectMappingIntegrity,
  planMappingRepair,
  validateMappingIdentity,
} from "@/server/biometric/mappingIntegrity";
import { reprocessHeldTimeLogs } from "@/server/biometric/reprocess";

const MAPPING_ROLES = new Set(["super_admin", "admin", "hr_staff", "user"]);

function assignedCompanyIds(session) {
  return [
    ...(Array.isArray(session?.user?.company_profile_ids) ? session.user.company_profile_ids : []),
    ...String(session?.user?.company_profile_id || "").split(","),
  ].map(value => String(value || "").trim()).filter(Boolean);
}

function employeeName(employee) {
  return [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(" ").trim()
    || employee.full_name
    || employee.name
    || employee.employee_id
    || employee.id;
}

async function authorize(req, res, companyProfileId) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    res.status(401).json({ error: "Authentication required." });
    return null;
  }
  if (!MAPPING_ROLES.has(session.user.role)) {
    res.status(403).json({ error: "Your role is not allowed to manage biometric mappings." });
    return null;
  }
  if (
    session.user.role !== "super_admin" &&
    !assignedCompanyIds(session).includes(String(companyProfileId))
  ) {
    res.status(403).json({ error: "You are not assigned to this company." });
    return null;
  }
  return session;
}

async function ensureDeviceCompany(deviceId, companyProfileId) {
  return prisma.biometricDeviceCompany.findFirst({
    where: {
      deviceId: String(deviceId),
      companyProfileId: String(companyProfileId),
      status: "active",
      device: { status: "active" },
    },
    include: { device: true },
  });
}

async function loadEmployeesForValidation(companyProfileId, { employeeRecordId, employeeId } = {}) {
  const companyEmployees = await listRecords("Employee", {
    filter: { company_profile_id: companyProfileId },
    limit: 10000,
  });
  const extras = [];
  if (employeeRecordId && !companyEmployees.some((item) => String(item.id) === String(employeeRecordId))) {
    extras.push(...await listRecords("Employee", { filter: { id: employeeRecordId }, limit: 5 }));
  }
  if (employeeId && extras.length === 0) {
    extras.push(...await listRecords("Employee", { filter: { employee_id: employeeId }, limit: 20 }));
  }
  const seen = new Set(companyEmployees.map((item) => item.id));
  return [...companyEmployees, ...extras.filter((item) => item && !seen.has(item.id))];
}

async function validateRow({ deviceId, companyProfileId, employeeId, deviceUserId, employeeRecordId }, rowNumber = null) {
  const prefix = rowNumber ? `Row ${rowNumber}: ` : "";
  if (!deviceId || !companyProfileId || !employeeId || !String(deviceUserId || "").trim()) {
    return { error: `${prefix}device, company, employee_id, and device_user_id are required.` };
  }

  const deviceCompany = await ensureDeviceCompany(deviceId, companyProfileId);
  if (!deviceCompany) {
    return { error: `${prefix}selected biometric device is not authorized for this company.` };
  }
  const deviceAssignedCompany = assignedCompanyId(deviceCompany.device);
  if (deviceAssignedCompany !== String(companyProfileId)) {
    return { error: `${prefix}DEVICE_COMPANY_MISMATCH`, code: "DEVICE_COMPANY_MISMATCH" };
  }

  const employees = await loadEmployeesForValidation(companyProfileId, { employeeRecordId, employeeId });
  const identity = validateMappingIdentity({
    employees,
    declaredEmployeeId: employeeId,
    declaredEmployeeRecordId: employeeRecordId,
    companyProfileId,
    deviceCompanyId: deviceAssignedCompany,
  });
  if (!identity.ok) {
    return { error: `${prefix}${identity.code}: ${identity.error}`, code: identity.code };
  }

  return { employee: identity.employee, deviceCompany, code: null };
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const companyProfileId = String(req.query.company_profile_id || "").trim();
    if (!companyProfileId) return res.status(400).json({ error: "Company is required." });
    const session = await authorize(req, res, companyProfileId);
    if (!session) return;

    const [employees, deviceCompanies, mappings] = await Promise.all([
      listRecords("Employee", {
        filter: { company_profile_id: companyProfileId },
        sort: "last_name",
        limit: 10000,
      }),
      prisma.biometricDeviceCompany.findMany({
        where: { companyProfileId, status: "active", device: { status: "active" } },
        include: { device: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.biometricUserMapping.findMany({
        where: { companyProfileId },
        include: { device: true },
        orderBy: [{ status: "asc" }, { employeeId: "asc" }],
      }),
    ]);

    const activeEmployees = employees
      .filter(employee => String(employee.status || "active").toLowerCase() === "active")
      .map(employee => ({
        id: employee.id,
        employee_id: employee.employee_id,
        employee_name: employeeName(employee),
        department: employee.department || "",
        position: employee.position || "",
        status: employee.status || "active",
      }));

    return res.status(200).json({
      employees: activeEmployees,
      devices: deviceCompanies.map(link => ({
        id: link.device.id,
        device_serial: link.device.deviceSerial,
        cloud_id: link.device.cloudId,
        terminal_type: link.device.terminalType,
        product_name: link.device.productName,
        site_code: link.device.siteCode,
        site_name: link.device.siteName,
        status: link.device.status,
      })),
      mappings: mappings.map(mapping => {
        const deviceCompany = assignedCompanyId(mapping.device);
        const integrity = inspectMappingIntegrity(mapping, employees, deviceCompany);
        return {
          id: mapping.id,
          company_profile_id: mapping.companyProfileId,
          device_id: mapping.deviceId,
          device_serial: mapping.device?.deviceSerial,
          employee_record_id: mapping.employeeRecordId,
          employee_id: mapping.employeeId,
          device_user_id: mapping.deviceUserId,
          status: mapping.status,
          integrity: {
            stale: integrity.stale,
            code: integrity.code,
            error: integrity.error,
          },
        };
      }),
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const body = req.body || {};
  const companyProfileId = String(body.company_profile_id || "").trim();
  if (!companyProfileId) return res.status(400).json({ error: "Company is required." });
  const session = await authorize(req, res, companyProfileId);
  if (!session) return;

  const operation = String(body.operation || "upsert");

  if (operation === "deactivate") {
    const mappingId = String(body.mapping_id || "").trim();
    if (!mappingId) return res.status(400).json({ error: "Mapping is required." });
    const existing = await prisma.biometricUserMapping.findFirst({
      where: { id: mappingId, companyProfileId },
    });
    if (!existing) return res.status(404).json({ error: "Mapping not found." });
    const updated = await prisma.biometricUserMapping.update({
      where: { id: existing.id },
      data: { status: "inactive" },
    });
    await recordBiometricAudit({
      actorType: "user",
      actorId: session.user.email || session.user.id,
      companyProfileId,
      deviceId: existing.deviceId,
      eventType: "mapping_deactivated",
      result: "success",
      mappingId: existing.id,
      details: { device_user_id: existing.deviceUserId, employee_id: existing.employeeId },
    });
    return res.status(200).json({ mapping: updated });
  }

  if (operation === "repair") {
    const mappingId = String(body.mapping_id || "").trim();
    if (!mappingId) return res.status(400).json({ error: "Mapping is required." });
    const existing = await prisma.biometricUserMapping.findFirst({
      where: { id: mappingId, companyProfileId },
      include: { device: { include: { allowedCompanies: { where: { status: "active" } } } } },
    });
    if (!existing) return res.status(404).json({ error: "Mapping not found." });
    const deviceCompany = assignedCompanyId(existing.device);
    const employees = await loadEmployeesForValidation(companyProfileId, {
      employeeRecordId: existing.employeeRecordId,
      employeeId: existing.employeeId,
    });
    const planned = planMappingRepair(existing, employees, deviceCompany);
    if (!planned.ok) {
      return res.status(422).json({ error: `${planned.code}: ${planned.error}`, code: planned.code });
    }
    const updated = await prisma.biometricUserMapping.update({
      where: { id: existing.id },
      data: {
        ...planned.update,
        companyProfileId,
      },
    });
    await recordBiometricAudit({
      actorType: "user",
      actorId: session.user.email || session.user.id,
      companyProfileId,
      deviceId: existing.deviceId,
      deviceSerial: existing.device?.deviceSerial,
      eventType: planned.audit.eventType,
      result: "success",
      reasonCode: planned.audit.reasonCode,
      mappingId: existing.id,
      details: planned.audit.details,
    });
    return res.status(200).json({
      mapping: updated,
      events_requeued: planned.events_requeued,
      previous_employee_record_id: planned.audit.details.previousEmployeeRecordId,
    });
  }

  const inputRows = operation === "bulk_upsert"
    ? (Array.isArray(body.rows) ? body.rows : [])
    : [{
        employee_id: body.employee_id,
        employee_record_id: body.employee_record_id,
        device_user_id: body.device_user_id,
        device_id: body.device_id,
      }];

  if (!inputRows.length) return res.status(400).json({ error: "No mapping rows were supplied." });
  if (inputRows.length > 5000) return res.status(400).json({ error: "Bulk mapping is limited to 5,000 rows per upload." });

  const validation = [];
  const seenDeviceUsers = new Map();
  const seenEmployees = new Map();

  for (let index = 0; index < inputRows.length; index += 1) {
    const row = inputRows[index] || {};
    const deviceId = String(row.device_id || body.device_id || "").trim();
    const employeeId = String(row.employee_id || "").trim();
    const employeeRecordId = String(row.employee_record_id || body.employee_record_id || "").trim();
    const deviceUserId = String(row.device_user_id || "").trim();
    const rowNumber = Number(row.row_number || index + 2);

    const deviceUserKey = `${deviceId}::${deviceUserId}`;
    const employeeKey = `${deviceId}::${employeeId.toLowerCase()}`;
    if (seenDeviceUsers.has(deviceUserKey)) {
      validation.push({ row_number: rowNumber, error: `device_user_id "${deviceUserId}" is repeated in the upload.` });
      continue;
    }
    if (seenEmployees.has(employeeKey)) {
      validation.push({ row_number: rowNumber, error: `employee_id "${employeeId}" is repeated for the same device.` });
      continue;
    }
    seenDeviceUsers.set(deviceUserKey, rowNumber);
    seenEmployees.set(employeeKey, rowNumber);

    const checked = await validateRow({ deviceId, companyProfileId, employeeId, employeeRecordId, deviceUserId }, rowNumber);
    if (checked.error) {
      validation.push({
        row_number: rowNumber,
        error: checked.error.replace(/^Row \d+: /, ""),
        code: checked.code || null,
      });
      continue;
    }
    validation.push({
      row_number: rowNumber,
      ok: true,
      deviceId,
      employee: checked.employee,
      deviceUserId,
    });
  }

  const errors = validation.filter(item => !item.ok);
  if (errors.length) {
    return res.status(422).json({
      error: `${errors.length} mapping row(s) need correction before anything is saved.`,
      validation,
    });
  }

  const saved = [];
  for (const item of validation) {
    const existingByEmployee = await prisma.biometricUserMapping.findFirst({
      where: { deviceId: item.deviceId, employeeRecordId: item.employee.id },
    });
    const existingByDeviceUser = await prisma.biometricUserMapping.findFirst({
      where: { deviceId: item.deviceId, deviceUserId: item.deviceUserId },
    });

    if (existingByDeviceUser && existingByDeviceUser.employeeRecordId !== item.employee.id) {
      return res.status(409).json({
        error: `Device User ID ${item.deviceUserId} is already assigned to employee ${existingByDeviceUser.employeeId}.`,
      });
    }

    const target = existingByEmployee || existingByDeviceUser;
    const data = {
      companyProfileId,
      deviceId: item.deviceId,
      employeeRecordId: item.employee.id,
      employeeId: item.employee.employee_id,
      deviceUserId: item.deviceUserId,
      status: "active",
    };

    const mapping = target
      ? await prisma.biometricUserMapping.update({ where: { id: target.id }, data })
      : await prisma.biometricUserMapping.create({ data });
    saved.push(mapping);
    await recordBiometricAudit({
      actorType: "user",
      actorId: session.user.email || session.user.id,
      companyProfileId,
      deviceId: mapping.deviceId,
      eventType: "mapping_upserted",
      result: "success",
      mappingId: mapping.id,
      details: { device_user_id: mapping.deviceUserId, employee_id: mapping.employeeId },
    });
  }

  const reprocessed = [];
  for (const mapping of saved) {
    reprocessed.push(await reprocessHeldTimeLogs({
      deviceId: mapping.deviceId,
      deviceUserId: mapping.deviceUserId,
      mapping,
      explicitQuarantine: false,
      actorType: "user",
      actorId: session.user.email || session.user.id,
    }));
  }

  return res.status(200).json({
    saved_count: saved.length,
    mappings: saved,
    validation,
    reprocessed,
    updated_by: session.user.email || session.user.name || session.user.id,
  });
}
