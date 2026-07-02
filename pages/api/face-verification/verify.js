// @ts-nocheck
import { prisma } from "@/server/prisma";
import {
  assertPurpose,
  compareTemplates,
  decryptText,
  faceSetting,
  faceTemplateFromImage,
  findEmployeeForRequest,
  findEmployeeForUser,
  logVerification,
  requireFaceAdmin,
  requireFaceFeatureEnabled,
  requireFaceSession,
  sendFaceError,
} from "@/server/faceVerification";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    requireFaceFeatureEnabled();
    const user = await requireFaceSession(req, res);
    const purpose = assertPurpose(req.body?.purpose);
    const isAdminPurpose = purpose === "manual_admin_check";
    if (isAdminPurpose) requireFaceAdmin(user);

    const employee = isAdminPurpose
      ? await findEmployeeForRequest({
          employeeRecordId: req.body?.employeeRecordId,
          employeeId: req.body?.employeeId,
          companyProfileId: req.body?.companyProfileId || user.company_profile_id || null,
        })
      : await findEmployeeForUser(user);

    if (!employee) {
      return res.status(404).json({ result: "no profile", error: "Employee face profile owner not found." });
    }

    const profile = await prisma.employeeFaceProfile.findFirst({
      where: { employeeId: employee.employee_id, companyProfileId: employee.company_profile_id || null },
      orderBy: { updatedAt: "desc" },
    });
    if (!profile || profile.status !== "active") {
      const result = profile ? "failed" : "no profile";
      const log = await logVerification({
        profile,
        employee,
        purpose,
        result,
        livenessResult: "not_run",
        livenessMessage: profile ? `Profile status is ${profile.status}.` : "No enrolled active profile.",
        user,
        req,
      });
      return res.status(200).json({ result, log });
    }

    if (!req.body?.livenessConfirmed) {
      const log = await logVerification({
        profile,
        employee,
        purpose,
        result: "liveness failed",
        livenessResult: "failed",
        livenessMessage: "User did not confirm fresh blink/head-turn challenge.",
        user,
        req,
      });
      return res.status(200).json({ result: "liveness failed", log });
    }

    const candidateTemplate = faceTemplateFromImage(req.body.imageBase64);
    const referenceTemplate = JSON.parse(decryptText(
      profile.encryptedTemplate,
      profile.templateIv,
      profile.templateAuthTag,
    ));
    const confidenceScore = compareTemplates(referenceTemplate, candidateTemplate);
    const setting = await faceSetting(employee.company_profile_id || null);
    const minimumConfidence = Number(setting.minimumConfidence || 0.82);
    const result = confidenceScore >= minimumConfidence ? "verified" : "failed";
    const photoEvidence = setting.storePhotoEvidence ? req.body.imageBase64 : null;
    const log = await logVerification({
      profile,
      employee,
      purpose,
      result,
      confidenceScore,
      livenessResult: "passed",
      livenessMessage: "Fresh camera capture challenge confirmed.",
      photoEvidence,
      user,
      req,
    });

    return res.status(200).json({
      result,
      confidenceScore,
      minimumConfidence,
      log,
    });
  } catch (error) {
    return sendFaceError(res, error);
  }
}
