// @ts-nocheck
import { prisma } from "@/server/prisma";
import {
  requireFaceAdmin,
  requireFaceFeatureEnabled,
  requireFaceSession,
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

    const profile = await prisma.employeeFaceProfile.findUnique({
      where: { id: String(req.body?.profileId || "") },
    });
    if (!profile) return res.status(404).json({ error: "Face profile not found." });

    await prisma.employeeFaceProfile.delete({ where: { id: profile.id } });

    return res.status(200).json({
      cleared: true,
      profileId: profile.id,
      employeeId: profile.employeeId,
      clearedBy: user.email || user.id || null,
      clearedAt: new Date().toISOString(),
    });
  } catch (error) {
    return sendFaceError(res, error);
  }
}
