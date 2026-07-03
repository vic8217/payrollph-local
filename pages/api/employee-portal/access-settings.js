// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/server/prisma";

const ENTITY = "EmployeePortalAccessSetting";
const ADMIN_ROLES = new Set(["super_admin", "admin", "user"]);
const PROTECTED_TABS = ["cash-advance", "personal-leave", "overtime-request", "profile", "trip-report"];
const ACCESS_MODES = new Set(["choice", "face", "qr_face", "qr_only"]);

function defaultModes() {
  return Object.fromEntries(PROTECTED_TABS.map((tabId) => [tabId, "choice"]));
}

function normalizeModes(value = {}) {
  const modes = defaultModes();
  for (const tabId of PROTECTED_TABS) {
    const mode = value?.[tabId];
    if (ACCESS_MODES.has(mode)) modes[tabId] = mode;
  }
  return modes;
}

async function findSetting(companyProfileId) {
  const records = await prisma.entityRecord.findMany({
    where: { entity: ENTITY },
    orderBy: { updatedAt: "desc" },
  });
  return records.find((record) => record.data?.company_profile_id === companyProfileId) || null;
}

function payload(record, companyProfileId) {
  return {
    id: record?.id || null,
    company_profile_id: companyProfileId,
    protected_tab_access_modes: normalizeModes(record?.data?.protected_tab_access_modes),
    updated_date: record?.updatedAt?.toISOString?.() || null,
  };
}

export default async function handler(req, res) {
  const companyProfileId = String(req.query.company_profile_id || req.body?.company_profile_id || "").trim();
  if (!companyProfileId) return res.status(400).json({ error: "company_profile_id is required." });

  try {
    if (req.method === "GET") {
      const setting = await findSetting(companyProfileId);
      return res.status(200).json(payload(setting, companyProfileId));
    }

    if (req.method === "POST") {
      const session = await getServerSession(req, res, authOptions);
      if (!session?.user || !ADMIN_ROLES.has(session.user.role)) {
        return res.status(403).json({ error: "Not authorized to update employee portal access settings." });
      }

      const allowedCompanyIds = session.user.company_profile_ids?.length
        ? session.user.company_profile_ids
        : [session.user.company_profile_id].filter(Boolean);
      if (session.user.role !== "super_admin" && !allowedCompanyIds.includes(companyProfileId)) {
        return res.status(403).json({ error: "Not authorized for this company." });
      }

      const data = {
        company_profile_id: companyProfileId,
        protected_tab_access_modes: normalizeModes(req.body?.protected_tab_access_modes),
        updated_by_user_id: session.user.id || null,
        updated_by_user_email: session.user.email || null,
        updated_at: new Date().toISOString(),
      };
      const existing = await findSetting(companyProfileId);
      const record = existing
        ? await prisma.entityRecord.update({ where: { id: existing.id }, data: { data } })
        : await prisma.entityRecord.create({ data: { entity: ENTITY, data } });

      return res.status(200).json(payload(record, companyProfileId));
    }

    res.setHeader("Allow", "GET,POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || "Unexpected access settings error" });
  }
}
