// @ts-nocheck
import { prisma } from "@/server/prisma";

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    full_name: user.name,
    role: user.role,
    approval_status: user.approvalStatus || "approved",
    company_profile_id: user.companyProfileId,
    created_date: user.createdAt.toISOString(),
    updated_date: user.updatedAt.toISOString(),
  };
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const users = await prisma.appUser.findMany({
        orderBy: { createdAt: "asc" },
      });

      return res.status(200).json(users.map(toPublicUser));
    }

    if (req.method === "PATCH") {
      const { id, data } = req.body || {};

      if (!id) {
        return res.status(400).json({ error: "User id is required" });
      }

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
        },
      });

      return res.status(200).json(toPublicUser(user));
    }

    res.setHeader("Allow", "GET,PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Unexpected server error",
    });
  }
}
