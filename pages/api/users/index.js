// @ts-nocheck
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/server/prisma";
import { normalizeAccessSchedule } from "@/lib/accessSchedule";
import { listRecords } from "@/server/entityStore";

function parseCompanyProfileIds(value) {
  return String(value || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function serializeCompanyProfileIds(value) {
  const ids = Array.isArray(value)
    ? value.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  return ids.length ? [...new Set(ids)].join(",") : null;
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

async function adminScopedCompanyIds(session) {
  if (session?.user?.role === "super_admin") return [];
  const assignedIds = sessionCompanyProfileIds(session);
  const companies = await listRecords("CompanyProfile");
  const createdIds = companies
    .filter((company) => company.status !== "archived" && company.created_by_user_id === session?.user?.id)
    .map((company) => company.id);
  return [...new Set([...assignedIds, ...createdIds])];
}

async function adminCanManageUser(session, user) {
  if (session?.user?.role === "super_admin") return true;
  if (user.role === "super_admin") return false;
  return hasCompanyOverlap(await adminScopedCompanyIds(session), parseCompanyProfileIds(user.companyProfileId));
}

async function assertAdminCanManageUser(session, user) {
  if (await adminCanManageUser(session, user)) return;
  const error = new Error("Admin users can only manage users assigned to their companies");
  error.statusCode = 403;
  throw error;
}

async function assertAdminCanAssignCompanies(session, companyProfileIds) {
  if (session?.user?.role === "super_admin") {
    return;
  }

  if (!companyProfileIds?.length) {
    const error = new Error("Admin users must select at least one company they created");
    error.statusCode = 403;
    throw error;
  }

  const companies = await listRecords("CompanyProfile");
  const allowedIds = new Set(
    companies
      .filter((company) =>
        company.status !== "archived" &&
        (company.created_by_user_id === session?.user?.id || !company.created_by_user_id)
      )
      .map((company) => company.id)
  );
  const blockedIds = companyProfileIds.filter((id) => !allowedIds.has(id));

  if (blockedIds.length) {
    const error = new Error("Admin users can only assign companies they created");
    error.statusCode = 403;
    throw error;
  }
}

function toPublicUser(user) {
  const companyProfileIds = parseCompanyProfileIds(user.companyProfileId);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    full_name: user.name,
    role: user.role,
    approval_status: user.approvalStatus || "approved",
    company_profile_id: companyProfileIds.length === 1 ? companyProfileIds[0] : null,
    company_profile_ids: companyProfileIds,
    access_schedule: user.accessSchedule,
    created_date: user.createdAt.toISOString(),
    updated_date: user.updatedAt.toISOString(),
  };
}

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions);
    if (!["super_admin", "admin"].includes(session?.user?.role)) {
      return res.status(403).json({ error: "Only super admin or admin can manage users" });
    }

    if (req.method === "GET") {
      let users = await prisma.appUser.findMany({
        where: {
          approvalStatus: {
            not: "denied",
          },
        },
        orderBy: { createdAt: "asc" },
      });

      if (session.user.role !== "super_admin") {
        const scopedCompanyIds = await adminScopedCompanyIds(session);
        users = users.filter((user) =>
          user.role !== "super_admin" &&
          hasCompanyOverlap(scopedCompanyIds, parseCompanyProfileIds(user.companyProfileId))
        );
      }

      return res.status(200).json(users.map(toPublicUser));
    }

    if (req.method === "PATCH") {
      const { id, data } = req.body || {};

      if (!id) {
        return res.status(400).json({ error: "User id is required" });
      }

      const existingUser = await prisma.appUser.findUnique({
        where: { id },
        select: { role: true, companyProfileId: true },
      });

      if (!existingUser) {
        return res.status(404).json({ error: "User not found" });
      }

      await assertAdminCanManageUser(session, existingUser);

      if (["denied", "suspended"].includes(data?.approval_status) && existingUser.role === "super_admin") {
        return res.status(400).json({ error: "Super admin cannot be suspended or denied" });
      }

      if (session.user.role !== "super_admin" && data?.role === "super_admin") {
        return res.status(403).json({ error: "Admin users cannot assign Super Admin role" });
      }

      const nextAccessSchedule =
        data?.access_schedule !== undefined
          ? data?.role === "super_admin"
            ? Prisma.DbNull
            : normalizeAccessSchedule(data.access_schedule) || Prisma.DbNull
          : undefined;
      const nextCompanyProfileId =
        data?.role === "super_admin"
          ? null
          : data?.company_profile_ids !== undefined
            ? serializeCompanyProfileIds(data.company_profile_ids)
            : data?.company_profile_id !== undefined
              ? data.company_profile_id || null
              : undefined;
      const nextCompanyProfileIds = parseCompanyProfileIds(nextCompanyProfileId);
      await assertAdminCanAssignCompanies(session, nextCompanyProfileIds);

      const user = await prisma.appUser.update({
        where: { id },
        data: {
          ...(data?.name !== undefined ? { name: data.name || null } : {}),
          ...(data?.role !== undefined ? { role: data.role } : {}),
          ...(data?.approval_status !== undefined
            ? { approvalStatus: data.approval_status }
            : {}),
          ...(nextCompanyProfileId !== undefined
            ? { companyProfileId: nextCompanyProfileId }
            : {}),
          ...(data?.access_schedule !== undefined
            ? { accessSchedule: nextAccessSchedule }
            : {}),
        },
      });

      return res.status(200).json(toPublicUser(user));
    }

    if (req.method === "DELETE") {
      if (session.user.role !== "super_admin") {
        return res.status(403).json({ error: "Only super admin can remove users" });
      }

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
    return res.status(error.statusCode || 500).json({
      error: error.message || "Unexpected server error",
    });
  }
}
