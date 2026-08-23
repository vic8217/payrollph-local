// @ts-nocheck
import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import { prisma } from "@/server/prisma";
import { isMaintenanceMode, sendMaintenanceUnavailable } from "@/server/maintenance";

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizePasscode(passcode) {
  return String(passcode || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (isMaintenanceMode()) return sendMaintenanceUnavailable(res);

  const token = String(req.body?.token || "").trim();
  const email = String(req.body?.email || "").toLowerCase().trim();
  const passcode = normalizePasscode(req.body?.passcode);
  const password = String(req.body?.password || "");

  if (!token && (!email || !passcode)) {
    return res.status(400).json({ error: "Email and reset passcode are required" });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const resetToken = token
    ? await prisma.passwordResetToken.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { user: true },
      })
    : await prisma.passwordResetToken.findFirst({
        where: {
          tokenHash: hashToken(passcode),
          user: { email },
        },
        include: { user: true },
      });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= new Date() || !resetToken.user) {
    return res.status(400).json({ error: "This reset passcode is invalid or expired" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();

  await prisma.$transaction([
    prisma.appUser.update({
      where: { id: resetToken.userId },
      data: {
        passwordHash,
        activeSessionId: null,
        activeSessionExpiresAt: null,
      },
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: now },
    }),
    prisma.passwordResetToken.updateMany({
      where: {
        userId: resetToken.userId,
        id: { not: resetToken.id },
        usedAt: null,
      },
      data: { usedAt: now },
    }),
  ]);

  return res.status(200).json({ message: "Password updated. You can now sign in." });
}
