// @ts-nocheck
import { prisma } from "@/server/prisma";
import {
  isUserPresenceEnabled,
  requireUserPresenceAdmin,
  requireUserPresenceSession,
  sanitizeUserFaceLog,
  sanitizeUserFaceProfile,
} from "@/server/userPresenceVerification";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await requireUserPresenceSession(req, res);
    const enabled = isUserPresenceEnabled();

    if (req.query.scope === "admin") {
      requireUserPresenceAdmin(user);
      const companyProfileId = req.query.company_profile_id || user.company_profile_id || null;
      const profiles = await prisma.userFaceProfile.findMany({
        where: companyProfileId ? { companyProfileId } : {},
        orderBy: { updatedAt: "desc" },
        include: { user: { select: { email: true, name: true, role: true, approvalStatus: true } } },
      });
      const recentLogs = await prisma.userFaceVerificationLog.findMany({
        where: companyProfileId ? { companyProfileId } : {},
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      const failedCount = await prisma.userFaceVerificationLog.count({
        where: {
          ...(companyProfileId ? { companyProfileId } : {}),
          result: { in: ["failed", "liveness failed", "no profile"] },
        },
      });

      return res.status(200).json({
        enabled,
        stats: {
          enrolledUsers: profiles.filter((profile) => profile.status === "active").length,
          failedCount,
        },
        users: profiles.map((profile) => ({
          userId: profile.userId,
          email: profile.user?.email || null,
          name: profile.user?.name || null,
          role: profile.user?.role || null,
          approvalStatus: profile.user?.approvalStatus || null,
          profile: sanitizeUserFaceProfile(profile),
        })),
        recentLogs: recentLogs.map(sanitizeUserFaceLog),
      });
    }

    const profile = await prisma.userFaceProfile.findUnique({ where: { userId: user.id } });
    const lastLog = await prisma.userFaceVerificationLog.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({
      enabled,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || null,
        role: user.role || "user",
        company_profile_id: user.company_profile_id || null,
      },
      profile: sanitizeUserFaceProfile(profile),
      lastLog: sanitizeUserFaceLog(lastLog),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || "Unexpected user presence error" });
  }
}
