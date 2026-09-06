// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/server/prisma";
import { listRecords } from "@/server/entityStore";
import { recordBiometricAudit } from "@/server/biometric/audit";
import { assignedCompanyId } from "@/server/biometric/classifyTimeLog";
import { deriveConnectionStatus, presenceStaleMs } from "@/server/biometric/presence";

function companyIds(session) {
  return [
    ...(Array.isArray(session?.user?.company_profile_ids) ? session.user.company_profile_ids : []),
    ...String(session?.user?.company_profile_id || "").split(","),
  ].map(v => String(v || "").trim()).filter(Boolean);
}

async function requireAdmin(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    res.status(401).json({ error: "Authentication required." });
    return null;
  }
  if (!["super_admin", "admin"].includes(session.user.role)) {
    res.status(403).json({ error: "Only administrators can manage biometric devices." });
    return null;
  }
  return session;
}

function actorId(session) {
  return session.user.email || session.user.id;
}

async function assignSingleCompany(device, companyProfileId) {
  const existing = await prisma.biometricDeviceCompany.findMany({ where: { deviceId: device.id } });
  await prisma.$transaction(async tx => {
    for (const link of existing) {
      await tx.biometricDeviceCompany.update({
        where: { id: link.id },
        data: { status: link.companyProfileId === companyProfileId ? "active" : "inactive" },
      });
    }
    await tx.biometricDeviceCompany.upsert({
      where: { deviceId_companyProfileId: { deviceId: device.id, companyProfileId } },
      update: { status: "active" },
      create: { deviceId: device.id, companyProfileId, status: "active" },
    });
    await tx.biometricDevice.update({
      where: { id: device.id },
      data: { companyProfileId },
    });
  });
}

export default async function handler(req, res) {
  const session = await requireAdmin(req, res);
  if (!session) return;

  if (req.method === "GET") {
    const [devices, companies] = await Promise.all([
      prisma.biometricDevice.findMany({
        include: { allowedCompanies: true, userMappings: { where: { status: "active" }, select: { id: true } } },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      }),
      listRecords("CompanyProfile", { limit: 10000 }),
    ]);

    const allowedCompanyIds = session.user.role === "super_admin" ? null : new Set(companyIds(session));
    const visibleCompanies = companies
      .filter(c => !allowedCompanyIds || allowedCompanyIds.has(String(c.id)))
      .map(c => ({ id: c.id, company_name: c.company_name || c.trade_name || c.id }));

    const visibleCompanyIdSet = new Set(visibleCompanies.map(c => String(c.id)));
    const visibleDevices = session.user.role === "super_admin"
      ? devices
      : devices.filter(d => {
          const assigned = assignedCompanyId(d);
          return assigned && visibleCompanyIdSet.has(String(assigned));
        });

    const staleMs = presenceStaleMs();
    return res.status(200).json({
      companies: visibleCompanies,
      presence_stale_ms: staleMs,
      devices: visibleDevices.map(d => {
        const companyId = assignedCompanyId(d);
        return {
          id: d.id,
          device_serial: d.deviceSerial,
          cloud_id: d.cloudId,
          terminal_type: d.terminalType,
          product_name: d.productName,
          site_code: d.siteCode,
          site_name: d.siteName,
          status: d.status,
          connection_status: deriveConnectionStatus(d, new Date(), staleMs),
          last_seen_at: d.lastSeenAt,
          last_login_at: d.lastLoginAt,
          mapping_count: d.userMappings.length,
          company_id: companyId,
          company_ids: companyId ? [companyId] : [],
        };
      }),
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const { operation, device_id: deviceId } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: "Device is required." });
  const device = await prisma.biometricDevice.findUnique({
    where: { id: String(deviceId) },
    include: { allowedCompanies: true },
  });
  if (!device) return res.status(404).json({ error: "Biometric device not found." });

  if (operation === "approve") {
    if (session.user.role !== "super_admin") return res.status(403).json({ error: "Only a super administrator can approve newly detected devices." });
    const updated = await prisma.biometricDevice.update({ where: { id: device.id }, data: { status: "active" } });
    await recordBiometricAudit({
      actorType: "user",
      actorId: actorId(session),
      deviceId: device.id,
      deviceSerial: device.deviceSerial,
      eventType: "device_approved",
      result: "success",
    });
    return res.status(200).json({ device: updated });
  }

  if (operation === "disable") {
    if (session.user.role !== "super_admin") return res.status(403).json({ error: "Only a super administrator can disable a biometric device." });
    const updated = await prisma.biometricDevice.update({ where: { id: device.id }, data: { status: "disabled" } });
    await recordBiometricAudit({
      actorType: "user",
      actorId: actorId(session),
      companyProfileId: assignedCompanyId(device),
      deviceId: device.id,
      deviceSerial: device.deviceSerial,
      eventType: "device_disabled",
      result: "success",
    });
    return res.status(200).json({ device: updated });
  }

  if (operation === "set_company" || operation === "set_companies") {
    const requestedIds = [...new Set([
      req.body.company_profile_id,
      ...(Array.isArray(req.body.company_profile_ids) ? req.body.company_profile_ids : []),
    ].map(v => String(v || "").trim()).filter(Boolean))];

    if (!requestedIds.length) return res.status(400).json({ error: "Select one company." });
    if (requestedIds.length > 1) {
      return res.status(400).json({ error: "Phase 1 allows exactly one company per biometric device." });
    }

    const companyProfileId = requestedIds[0];
    const allowedIds = session.user.role === "super_admin" ? null : new Set(companyIds(session));
    if (allowedIds && !allowedIds.has(companyProfileId)) {
      return res.status(403).json({ error: "You can only assign a company you are authorized to manage." });
    }

    await assignSingleCompany(device, companyProfileId);
    await recordBiometricAudit({
      actorType: "user",
      actorId: actorId(session),
      companyProfileId,
      deviceId: device.id,
      deviceSerial: device.deviceSerial,
      eventType: "device_companies_set",
      result: "success",
      details: { company_profile_id: companyProfileId, phase1_single_company: true },
    });
    return res.status(200).json({ ok: true, company_profile_id: companyProfileId });
  }

  if (operation === "update_details") {
    const updated = await prisma.biometricDevice.update({
      where: { id: device.id },
      data: {
        siteCode: req.body.site_code ?? device.siteCode,
        siteName: req.body.site_name ?? device.siteName,
      },
    });
    return res.status(200).json({ device: updated });
  }

  return res.status(400).json({ error: "Unsupported operation." });
}
