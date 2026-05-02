// @ts-nocheck
import { createHash, randomInt } from "crypto";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/server/prisma";

const RESET_PASSCODE_TTL_MINUTES = 30;
const PASSCODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

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
  if (session?.user?.role !== "super_admin") {
    return res.status(403).json({ error: "Only super admin can create reset passcodes" });
  }

  const userId = String(req.body?.id || "").trim();
  if (!userId) {
    return res.status(400).json({ error: "User id is required" });
  }

  const user = await prisma.appUser.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  });

  if (!user) {
    return res.status(404).json({ error: "User not found" });
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
