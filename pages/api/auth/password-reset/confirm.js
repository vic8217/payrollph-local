// @ts-nocheck
import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import { prisma } from "@/server/prisma";

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = String(req.body?.token || "").trim();
  const password = String(req.body?.password || "");

  if (!token) {
    return res.status(400).json({ error: "Reset token is required" });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= new Date() || !resetToken.user) {
    return res.status(400).json({ error: "This password reset link is invalid or expired" });
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
