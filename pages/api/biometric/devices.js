// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/server/prisma";
import { listRecords } from "@/server/entityStore";

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
      : devices.filter(d => d.allowedCompanies.some(link => visibleCompanyIdSet.has(String(link.companyProfileId))));

    return res.status(200).json({
      companies: visibleCompanies,
      devices: visibleDevices.map(d => ({
        id: d.id,
        device_serial: d.deviceSerial,
        cloud_id: d.cloudId,
        terminal_type: d.terminalType,
        product_name: d.productName,
        site_code: d.siteCode,
        site_name: d.siteName,
        status: d.status,
        last_seen_at: d.lastSeenAt,
        last_login_at: d.lastLoginAt,
        mapping_count: d.userMappings.length,
        company_ids: d.allowedCompanies.filter(link => link.status === "active").map(link => link.companyProfileId),
      })),
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const { operation, device_id: deviceId } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: "Device is required." });
  const device = await prisma.biometricDevice.findUnique({ where: { id: String(deviceId) } });
  if (!device) return res.status(404).json({ error: "Biometric device not found." });

  if (operation === "approve") {
    if (session.user.role !== "super_admin") return res.status(403).json({ error: "Only a super administrator can approve newly detected devices." });
    const updated = await prisma.biometricDevice.update({ where: { id: device.id }, data: { status: "active" } });
    return res.status(200).json({ device: updated });
  }

  if (operation === "set_companies") {
    const requestedIds = [...new Set((Array.isArray(req.body.company_profile_ids) ? req.body.company_profile_ids : []).map(v => String(v).trim()).filter(Boolean))];
    if (!requestedIds.length) return res.status(400).json({ error: "Select at least one company." });

    const allowedIds = session.user.role === "super_admin" ? null : new Set(companyIds(session));
    if (allowedIds && requestedIds.some(id => !allowedIds.has(id))) {
      return res.status(403).json({ error: "You can only assign companies you are authorized to manage." });
    }

    await prisma.$transaction(async tx => {
      const existing = await tx.biometricDeviceCompany.findMany({ where: { deviceId: device.id } });
      const requested = new Set(requestedIds);
      for (const link of existing) {
        await tx.biometricDeviceCompany.update({
          where: { id: link.id },
          data: { status: requested.has(link.companyProfileId) ? "active" : "inactive" },
        });
      }
      for (const companyProfileId of requestedIds) {
        await tx.biometricDeviceCompany.upsert({
          where: { deviceId_companyProfileId: { deviceId: device.id, companyProfileId } },
          update: { status: "active" },
          create: { deviceId: device.id, companyProfileId, status: "active" },
        });
      }
    });

    return res.status(200).json({ ok: true });
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
