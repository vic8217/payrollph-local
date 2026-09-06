// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { finalizeAutomaticShiftLogs } from "@/server/attendance/finalizeAutomaticShifts";

const ADMIN_ROLES = new Set(["super_admin", "admin"]);

function assignedCompanyIds(session) {
  return [
    ...(Array.isArray(session?.user?.company_profile_ids) ? session.user.company_profile_ids : []),
    ...String(session?.user?.company_profile_id || "").split(","),
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

function toDate(value) {
  if (value == null || value === "") return new Date();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id && !session?.user?.email) {
    return res.status(401).json({ error: "Authentication required." });
  }
  if (!ADMIN_ROLES.has(session.user.role)) {
    return res.status(403).json({ error: "Only an administrator can run automatic shift finalization." });
  }

  const companyProfileId = String(req.body?.company_profile_id || "").trim();
  if (session.user.role !== "super_admin") {
    if (!companyProfileId) {
      return res.status(400).json({ error: "Company is required." });
    }
    if (!assignedCompanyIds(session).includes(companyProfileId)) {
      return res.status(403).json({ error: "You are not assigned to this company." });
    }
  }

  const asOf = toDate(req.body?.as_of);
  if (!asOf) {
    return res.status(400).json({ error: "as_of must be a valid timestamp when provided." });
  }

  const logIds = Array.isArray(req.body?.log_ids) ? req.body.log_ids : null;
  const result = await finalizeAutomaticShiftLogs({
    asOf,
    companyProfileId: companyProfileId || null,
    logIds,
  });

  return res.status(200).json({
    ok: true,
    triggered_by: session.user.email || session.user.id,
    ...result,
  });
}
