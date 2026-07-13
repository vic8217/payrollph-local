// @ts-nocheck
import { randomInt } from "node:crypto";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import { createRecord, listRecords, updateRecord } from "@/server/entityStore";

const ALLOWED_ROLES = new Set(["super_admin", "admin", "user"]);

function todayInManila() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function generatePasscode() {
  return String(randomInt(100000, 1000000));
}

function sessionCompanyIds(session) {
  const ids = Array.isArray(session?.user?.company_profile_ids)
    ? session.user.company_profile_ids
    : [session?.user?.company_profile_id];
  return ids.map(String).filter(Boolean);
}

function canAccessCompany(session, companyProfileId) {
  return session.user.role === "super_admin" || sessionCompanyIds(session).includes(String(companyProfileId));
}

function visibleRecord(record, role) {
  if (role === "super_admin") return record;
  if (role === "admin") return { ...record, passcode: undefined };
  return { ...record, manager_passcode: undefined };
}

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user || !ALLOWED_ROLES.has(session.user.role)) {
    return res.status(401).json({ error: "You must be signed in to manage a daily passcode." });
  }

  const companyProfileId = String(req.method === "GET" ? req.query.company_profile_id || "" : req.body?.company_profile_id || "");
  if (!companyProfileId) return res.status(400).json({ error: "Company is required." });
  if (!canAccessCompany(session, companyProfileId)) {
    return res.status(403).json({ error: "You cannot manage passcodes for this company." });
  }

  try {
    if (req.method === "GET") {
      const records = await listRecords("DailyPasscode", {
        filter: { company_profile_id: companyProfileId },
        sort: "-date",
        limit: 14,
      });
      return res.status(200).json(records.map(record => visibleRecord(record, session.user.role)));
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET,POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const date = todayInManila();
    const [existing] = await listRecords("DailyPasscode", {
      filter: { company_profile_id: companyProfileId, date },
      limit: 1,
    });
    const generatedBy = session.user.email || session.user.name || session.user.id;
    const changes = { generated_by: generatedBy };

    // Preserve the established super-admin action: it always generates both codes.
    if (session.user.role === "super_admin") {
      changes.passcode = generatePasscode();
      changes.manager_passcode = generatePasscode();
    } else if (session.user.role === "admin") {
      changes.manager_passcode = generatePasscode();
    } else {
      changes.passcode = generatePasscode();
    }

    const record = existing
      ? await updateRecord("DailyPasscode", existing.id, changes)
      : await createRecord("DailyPasscode", { date, company_profile_id: companyProfileId, ...changes });

    return res.status(existing ? 200 : 201).json(visibleRecord(record, session.user.role));
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || "Unable to manage daily passcode." });
  }
}
