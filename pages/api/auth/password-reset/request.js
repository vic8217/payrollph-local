// @ts-nocheck
import { createHash, randomBytes } from "crypto";
import { prisma } from "@/server/prisma";
import { isMaintenanceMode, sendMaintenanceUnavailable } from "@/server/maintenance";

const RESET_TOKEN_TTL_MINUTES = 30;

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function getBaseUrl(req) {
  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL.replace(/\/$/, "");
  }

  const protocol = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${protocol}://${host}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (isMaintenanceMode()) return sendMaintenanceUnavailable(res);

  const email = String(req.body?.email || "").toLowerCase().trim();
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const response = {
    message: "If an account exists for that email, a password reset link has been prepared.",
  };

  try {
    const user = await prisma.appUser.findUnique({ where: { email } });
    if (!user) {
      return res.status(200).json(response);
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

    await prisma.$transaction([
      prisma.passwordResetToken.updateMany({
        where: {
          userId: user.id,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      }),
      prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      }),
    ]);

    const exposeResetLink =
      process.env.PASSWORD_RESET_EXPOSE_LINK === "true" || process.env.NODE_ENV !== "production";

    if (exposeResetLink) {
      response.resetLink = `${getBaseUrl(req)}/reset-password?token=${encodeURIComponent(token)}`;
      response.expiresAt = expiresAt.toISOString();
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error("Password reset request failed", error);
    return res.status(500).json({
      error: "Password reset is temporarily unavailable. Please restart the server and make sure the database schema is synced.",
    });
  }
}
