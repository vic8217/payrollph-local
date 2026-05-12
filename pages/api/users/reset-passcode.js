// @ts-nocheck
import { createHash, randomInt } from "crypto";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/server/prisma";

const RESET_PASSCODE_TTL_MINUTES = 30;
const PASSCODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function parseCompanyProfileIds(value) {
  return String(value || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function sessionCompanyProfileIds(session) {
  return Array.isArray(session?.user?.company_profile_ids) && session.user.company_profile_ids.length
    ? session.user.company_profile_ids
    : parseCompanyProfileIds(session?.user?.company_profile_id);
}

function hasCompanyOverlap(leftIds, rightIds) {
  if (!leftIds.length || !rightIds.length) return false;
  const right = new Set(rightIds);
  return leftIds.some((id) => right.has(id));
}

function normalizePasscode(passcode) {
  return String(passcode || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function hashPasscode(passcode) {
  return createHash("sha256").update(normalizePasscode(passcode)).digest("hex");
}

function generatePasscode() {
  let value = "";
  for (let index = 0; index < 8; index += 1) {
    value += PASSCODE_ALPHABET[randomInt(PASSCODE_ALPHABET.length)];
  }
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!["super_admin", "admin"].includes(session?.user?.role)) {
    return res.status(403).json({ error: "Only super admin or admin can create reset passcodes" });
  }

  const userId = String(req.body?.id || "").trim();
  if (!userId) {
    return res.status(400).json({ error: "User id is required" });
  }

  const user = await prisma.appUser.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, companyProfileId: true },
  });

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  if (
    session.user.role !== "super_admin" &&
    (user.role === "super_admin" ||
      !hasCompanyOverlap(sessionCompanyProfileIds(session), parseCompanyProfileIds(user.companyProfileId)))
  ) {
    return res.status(403).json({ error: "Admin users can only reset users assigned to their companies" });
  }

  const passcode = generatePasscode();
  const now = new Date();
  const expiresAt = new Date(Date.now() + RESET_PASSCODE_TTL_MINUTES * 60 * 1000);

  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: {
        userId: user.id,
        usedAt: null,
      },
      data: { usedAt: now },
    }),
    prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashPasscode(passcode),
        expiresAt,
      },
    }),
  ]);

  return res.status(200).json({
    email: user.email,
    name: user.name,
    passcode,
    expiresAt: expiresAt.toISOString(),
  });
}
