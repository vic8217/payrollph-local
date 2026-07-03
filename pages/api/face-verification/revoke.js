// @ts-nocheck
import { prisma } from "@/server/prisma";
import {
  requireFaceAdmin,
  requireFaceFeatureEnabled,
  requireFaceSession,
  sanitizeProfile,
  sendFaceError,
} from "@/server/faceVerification";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    requireFaceFeatureEnabled();
    const user = await requireFaceSession(req, res);
    requireFaceAdmin(user);
    const profile = await prisma.employeeFaceProfile.update({
      where: { id: String(req.body?.profileId || "") },
      data: {
        status: "revoked",
        revokedAt: new Date(),
        revokedByUserId: user.id || null,
        auditLog: {
          action: "revoke",
          reason: req.body?.reason || null,
          by: user.email || user.id || null,
          at: new Date().toISOString(),
        },
      },
    });
    return res.status(200).json({ profile: sanitizeProfile(profile) });
  } catch (error) {
    return sendFaceError(res, error);
  }
}
