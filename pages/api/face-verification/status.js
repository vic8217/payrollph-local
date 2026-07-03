// @ts-nocheck
import { prisma } from "@/server/prisma";
import {
  decryptText,
  employeeName,
  employeeRecords,
  faceSetting,
  findEmployeeForUser,
  isFaceVerificationEnabled,
  requireFaceSession,
  sanitizeLog,
  sanitizeProfile,
  sendFaceError,
} from "@/server/faceVerification";

function adminProfilePayload(profile) {
  const payload = sanitizeProfile(profile);
  if (!payload || !profile?.encryptedReferenceImage) return payload;

  try {
    payload.referenceImage = decryptText(
      profile.encryptedReferenceImage,
      profile.referenceImageIv,
      profile.referenceImageAuthTag,
    );
  } catch {
    payload.referenceImage = null;
  }

  return payload;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await requireFaceSession(req, res);
    const enabled = isFaceVerificationEnabled();
    const companyProfileId = req.query.company_profile_id || user.company_profile_id || null;
    const setting = await faceSetting(companyProfileId);

    if (!enabled) {
      return res.status(200).json({ enabled: false, message: "Face Verification is disabled." });
    }

    const isAdmin = ["super_admin", "admin", "user"].includes(user.role);
    if (req.query.scope === "admin" && isAdmin) {
      const employees = await employeeRecords(companyProfileId);
      const allEmployees = await employeeRecords(companyProfileId, { activeOnly: false });
      const profiles = await prisma.employeeFaceProfile.findMany({
        where: { companyProfileId },
        orderBy: { updatedAt: "desc" },
      });
      const activeEmployeeIds = new Set(employees.map((employee) => String(employee.employee_id || "").toLowerCase()));
      const employeeById = new Map(allEmployees.map((employee) => [
        String(employee.employee_id || "").toLowerCase(),
        employee,
      ]));
      const activeEmployeeProfiles = profiles.filter((profile) =>
        activeEmployeeIds.has(String(profile.employeeId || "").toLowerCase())
      );
      const unlistedProfiles = profiles.filter((profile) =>
        !activeEmployeeIds.has(String(profile.employeeId || "").toLowerCase())
      );
      const recentLogs = await prisma.employeeFaceVerificationLog.findMany({
        where: { companyProfileId },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      const profileEmployeeIds = new Set(activeEmployeeProfiles.map((profile) => String(profile.employeeId || "").toLowerCase()));
      const failedCount = await prisma.employeeFaceVerificationLog.count({
        where: { companyProfileId, result: "failed" },
      });

      return res.status(200).json({
        enabled,
        setting: {
          storePhotoEvidence: Boolean(setting.storePhotoEvidence),
          minimumConfidence: Number(setting.minimumConfidence || 0.82),
        },
        stats: {
          totalEnrolled: activeEmployeeProfiles.filter((profile) => profile.status === "active").length,
          withoutProfile: employees.filter((employee) => !profileEmployeeIds.has(String(employee.employee_id || "").toLowerCase())).length,
          suspendedOrRevoked: activeEmployeeProfiles.filter((profile) => ["suspended", "revoked"].includes(profile.status)).length,
          unlistedProfiles: unlistedProfiles.length,
          failedCount,
        },
        employees: employees.map((employee) => ({
          id: employee.id,
          employee_id: employee.employee_id,
          employee_name: employeeName(employee),
          department: employee.department || null,
          profile: adminProfilePayload(activeEmployeeProfiles.find((profile) =>
            String(profile.employeeId || "").toLowerCase() === String(employee.employee_id || "").toLowerCase()
          )),
        })),
        unlistedProfiles: unlistedProfiles.map((profile) => {
          const employee = employeeById.get(String(profile.employeeId || "").toLowerCase());
          return {
            id: `profile-${profile.id}`,
            employee_id: profile.employeeId,
            employee_name: employee ? employeeName(employee) : profile.employeeName,
            department: employee?.department || null,
            employeeStatus: employee?.status || "archived/unlisted",
            profile: adminProfilePayload(profile),
          };
        }),
        recentLogs: recentLogs.map(sanitizeLog),
      });
    }

    const employee = await findEmployeeForUser(user);
    const profile = employee
      ? await prisma.employeeFaceProfile.findFirst({
          where: { employeeId: employee.employee_id, companyProfileId: employee.company_profile_id || null },
          orderBy: { updatedAt: "desc" },
        })
      : null;
    const lastLog = employee
      ? await prisma.employeeFaceVerificationLog.findFirst({
          where: { employeeId: employee.employee_id, companyProfileId: employee.company_profile_id || null },
          orderBy: { createdAt: "desc" },
        })
      : null;

    return res.status(200).json({
      enabled,
      employee: employee ? {
        id: employee.id,
        employee_id: employee.employee_id,
        employee_name: employeeName(employee),
        department: employee.department || null,
      } : null,
      profile: sanitizeProfile(profile),
      lastLog: sanitizeLog(lastLog),
    });
  } catch (error) {
    return sendFaceError(res, error);
  }
}
