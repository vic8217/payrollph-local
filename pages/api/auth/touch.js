// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions, SESSION_IDLE_TIMEOUT_SECONDS } from "./[...nextauth]";
import { prisma } from "@/server/prisma";

/** Renew the persisted idle deadline for an already authenticated browser. */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) return res.status(401).json({ error: "Not authenticated" });

  const result = await prisma.appUser.updateMany({
    where: {
      id: session.user.id,
      activeSessionId: session.user.active_session_id,
      activeSessionExpiresAt: { gt: new Date() },
    },
    data: { activeSessionExpiresAt: new Date(Date.now() + SESSION_IDLE_TIMEOUT_SECONDS * 1000) },
  });

  if (result.count === 0) return res.status(401).json({ error: "Session expired" });
  return res.status(204).end();
}
