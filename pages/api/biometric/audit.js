// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/server/prisma";

function assignedCompanyIds(session) {
  return [
    ...(Array.isArray(session?.user?.company_profile_ids) ? session.user.company_profile_ids : []),
    ...String(session?.user?.company_profile_id || "").split(","),
  ].map(value => String(value || "").trim()).filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) return res.status(401).json({ error: "Authentication required." });
  if (!["super_admin", "admin"].includes(session.user.role)) {
    return res.status(403).json({ error: "Only administrators can view biometric audit events." });
  }

  const companyProfileId = String(req.query.company_profile_id || "").trim();
  if (session.user.role !== "super_admin") {
    if (!companyProfileId || !assignedCompanyIds(session).includes(companyProfileId)) {
      return res.status(403).json({ error: "You are not assigned to this company." });
    }
  }

  const events = await prisma.biometricAuditEvent.findMany({
    where: {
      ...(companyProfileId ? { companyProfileId } : {}),
      ...(req.query.event_type ? { eventType: String(req.query.event_type) } : {}),
      ...(req.query.device_serial ? { deviceSerial: String(req.query.device_serial) } : {}),
    },
    orderBy: { occurredAt: "desc" },
    take: 200,
  });

  return res.status(200).json({
    events: events.map(event => ({
      id: event.id,
      occurred_at: event.occurredAt,
      actor_type: event.actorType,
      actor_id: event.actorId,
      company_profile_id: event.companyProfileId,
      device_serial: event.deviceSerial,
      event_type: event.eventType,
      result: event.result,
      reason_code: event.reasonCode,
      details: event.details,
    })),
  });
}
