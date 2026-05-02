// @ts-nocheck
import bcrypt from "bcryptjs";
import { createHash, timingSafeEqual } from "crypto";
import { prisma } from "@/server/prisma";

function hashSecret(value) {
  return createHash("sha256").update(String(value || "")).digest();
}

function isValidRecoveryKey(value) {
  const configuredKey = process.env.SUPER_ADMIN_RECOVERY_KEY || "";
  if (configuredKey.length < 32) {
    return false;
  }

  const submitted = hashSecret(value);
  const configured = hashSecret(configuredKey);
  return timingSafeEqual(submitted, configured);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const email = String(req.body?.email || "").toLowerCase().trim();
  const recoveryKey = String(req.body?.recoveryKey || "");
  const password = String(req.body?.password || "");

  if (!email || !recoveryKey) {
    return res.status(400).json({ error: "Email and recovery key are required" });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  if (!isValidRecoveryKey(recoveryKey)) {
    return res.status(403).json({ error: "Invalid super admin recovery key" });
  }

  const user = await prisma.appUser.findUnique({ where: { email } });
  if (!user || user.role !== "super_admin") {
    return res.status(404).json({ error: "Super admin account not found" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.appUser.update({
    where: { id: user.id },
    data: {
      passwordHash,
      activeSessionId: null,
      activeSessionExpiresAt: null,
      approvalStatus: "approved",
    },
  });

  return res.status(200).json({ message: "Super admin password updated. You can now sign in." });
}
