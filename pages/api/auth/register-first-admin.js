// @ts-nocheck
import bcrypt from "bcryptjs";
import { prisma } from "@/server/prisma";
import { isMaintenanceMode, sendMaintenanceUnavailable } from "@/server/maintenance";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (isMaintenanceMode()) return sendMaintenanceUnavailable(res);

  const existingCount = await prisma.appUser.count();
  if (existingCount > 0) {
    return res.status(409).json({ error: "Initial admin already exists" });
  }

  const { email, password, name } = req.body || {};
  if (!email || !password || password.length < 8) {
    return res.status(400).json({
      error: "Email and a password of at least 8 characters are required",
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.appUser.create({
    data: {
      email: email.toLowerCase().trim(),
      name: name || null,
      passwordHash,
      role: "super_admin",
    },
  });

  return res.status(201).json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });
}
