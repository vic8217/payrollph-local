// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/server/prisma";

function toPublicUserStatus(user) {
  const activeUntil = user.activeSessionExpiresAt;
  const isOnline = Boolean(user.activeSessionId && activeUntil && activeUntil > new Date());

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    approval_status: user.approvalStatus || "approved",
    is_online: isOnline,
    active_until: activeUntil?.toISOString() || null,
  };
}

function toPublicLog(log) {
  return {
    id: log.id,
    user_id: log.userId,
    email: log.email,
    name: log.name,
    role: log.role,
    event_type: log.eventType,
    session_id: log.sessionId,
    ip_address: log.ipAddress,
    user_agent: log.userAgent,
    occurred_at: log.occurredAt.toISOString(),
  };
}

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions);
    if (session?.user?.role !== "super_admin") {
      return res.status(403).json({ error: "Only super admin can view user logs" });
    }

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const [users, logs] = await Promise.all([
      prisma.appUser.findMany({
        orderBy: [{ role: "asc" }, { name: "asc" }, { email: "asc" }],
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          approvalStatus: true,
          activeSessionId: true,
          activeSessionExpiresAt: true,
        },
      }),
      prisma.userAccessLog.findMany({
        orderBy: { occurredAt: "desc" },
        take: 200,
      }),
    ]);

    return res.status(200).json({
      users: users.map(toPublicUserStatus),
      logs: logs.map(toPublicLog),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unexpected server error" });
  }
}
