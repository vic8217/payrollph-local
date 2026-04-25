// @ts-nocheck
import bcrypt from "bcryptjs";
import { prisma } from "@/server/prisma";

const ALLOWED_ROLES = new Set(["admin", "user"]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const email = String(req.body?.email || "").toLowerCase().trim();
  const password = String(req.body?.password || "");
  const name = String(req.body?.name || "").trim();
  const role = String(req.body?.role || "user").trim();

  if (!email || !password || !name) {
    return res.status(400).json({ error: "Name, email, and password are required" });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  if (!ALLOWED_ROLES.has(role)) {
    return res.status(400).json({ error: "Role must be admin or user" });
  }

  try {
    const existing = await prisma.appUser.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "Email is already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.appUser.create({
      data: {
        email,
        name,
        passwordHash,
        role,
        approvalStatus: "pending",
      },
    });

    return res.status(201).json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unexpected server error" });
  }
}
