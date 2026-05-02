// @ts-nocheck
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { normalizeAccessSchedule } from "@/lib/accessSchedule";

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    full_name: user.name,
    role: user.role,
    approval_status: user.approvalStatus || "approved",
    company_profile_id: user.companyProfileId,
    access_schedule: user.accessSchedule,
    created_date: user.createdAt.toISOString(),
    updated_date: user.updatedAt.toISOString(),
  };
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const users = await prisma.appUser.findMany({
        where: {
          approvalStatus: {
            not: "denied",
          },
        },
        orderBy: { createdAt: "asc" },
      });

      return res.status(200).json(users.map(toPublicUser));
    }

    if (req.method === "PATCH") {
      const { id, data } = req.body || {};

      if (!id) {
        return res.status(400).json({ error: "User id is required" });
      }

      if (["denied", "suspended"].includes(data?.approval_status)) {
        const existingUser = await prisma.appUser.findUnique({
          where: { id },
          select: { role: true },
        });

        if (existingUser?.role === "super_admin") {
          return res.status(400).json({ error: "Super admin cannot be suspended or denied" });
        }
      }

      const nextAccessSchedule =
        data?.access_schedule !== undefined
          ? data?.role === "super_admin"
            ? Prisma.DbNull
            : normalizeAccessSchedule(data.access_schedule) || Prisma.DbNull
          : undefined;

      const user = await prisma.appUser.update({
        where: { id },
        data: {
          ...(data?.name !== undefined ? { name: data.name || null } : {}),
          ...(data?.role !== undefined ? { role: data.role } : {}),
          ...(data?.approval_status !== undefined
            ? { approvalStatus: data.approval_status }
            : {}),
          ...(data?.company_profile_id !== undefined
            ? { companyProfileId: data.company_profile_id || null }
            : {}),
          ...(data?.access_schedule !== undefined
            ? { accessSchedule: nextAccessSchedule }
            : {}),
        },
      });

      return res.status(200).json(toPublicUser(user));
    }

    if (req.method === "DELETE") {
      const { id } = req.body || {};

      if (!id) {
        return res.status(400).json({ error: "User id is required" });
      }

      const existingUser = await prisma.appUser.findUnique({
        where: { id },
        select: { role: true },
      });

      if (existingUser?.role === "super_admin") {
        return res.status(400).json({ error: "Super admin cannot be removed" });
      }

      await prisma.appUser.delete({ where: { id } });

      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET,PATCH,DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Unexpected server error",
    });
  }
}
