// @ts-nocheck
import { prisma } from "@/server/prisma";
import {
  findEmployeeForUser,
  requireFaceAdmin,
  requireFaceFeatureEnabled,
  requireFaceSession,
  sanitizeLog,
  sendFaceError,
} from "@/server/faceVerification";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    requireFaceFeatureEnabled();
    const user = await requireFaceSession(req, res);
    const scope = String(req.query.scope || "employee");
    const take = Math.min(Number(req.query.limit) || 100, 500);

    if (scope === "admin") {
      requireFaceAdmin(user);
      const where = {
        companyProfileId: req.query.company_profile_id || user.company_profile_id || null,
        ...(req.query.employee_id ? { employeeId: String(req.query.employee_id) } : {}),
        ...(req.query.result ? { result: String(req.query.result) } : {}),
      };
      const logs = await prisma.employeeFaceVerificationLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
      });
      return res.status(200).json({ logs: logs.map(sanitizeLog) });
    }

    const employee = await findEmployeeForUser(user);
    if (!employee) return res.status(200).json({ logs: [] });
    const logs = await prisma.employeeFaceVerificationLog.findMany({
      where: { employeeId: employee.employee_id, companyProfileId: employee.company_profile_id || null },
      orderBy: { createdAt: "desc" },
      take,
    });
    return res.status(200).json({ logs: logs.map(sanitizeLog) });
  } catch (error) {
    return sendFaceError(res, error);
  }
}
