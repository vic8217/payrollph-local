// @ts-nocheck
import { prisma } from "@/server/prisma";
import {
  assertFreshWebcamCaptureMetadata,
  assertNoDuplicateEmployeeFaceEnrollment,
  encryptText,
  employeeName,
  faceTemplateFromImage,
  findEmployeeForRequest,
  requireFaceAdmin,
  requireFaceFeatureEnabled,
  requireFaceSession,
  sanitizeProfile,
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
    requireFaceAdmin(user);

    const employee = await findEmployeeForRequest({
      employeeRecordId: req.body?.employeeRecordId,
      employeeId: req.body?.employeeId,
      companyProfileId: req.body?.companyProfileId || user.company_profile_id || null,
    });
    if (!employee) {
      return res.status(404).json({ error: "Employee not found." });
    }
    if (!req.body?.consentAccepted) {
      return res.status(400).json({ error: "Employee biometric consent is required before enrollment." });
    }
    if (!req.body?.livenessConfirmed) {
      return res.status(400).json({ error: "Live blink/head-turn confirmation is required before enrollment." });
    }
    assertFreshWebcamCaptureMetadata(req.body?.captureMetadata);

    const template = faceTemplateFromImage(req.body.imageBase64);
    const existing = await prisma.employeeFaceProfile.findFirst({
      where: { employeeId: employee.employee_id, companyProfileId: employee.company_profile_id || null },
    });
    await assertNoDuplicateEmployeeFaceEnrollment({
      candidateTemplate: template,
      companyProfileId: employee.company_profile_id || null,
      employeeId: employee.employee_id,
      excludeProfileId: existing?.id || null,
    });

    const encryptedImage = encryptText(req.body.imageBase64);
    const encryptedTemplate = encryptText(JSON.stringify(template));
    const now = new Date();
    const data = {
      companyProfileId: employee.company_profile_id || null,
      employeeRecordId: employee.id,
      employeeId: employee.employee_id,
      employeeName: employeeName(employee),
      encryptedReferenceImage: encryptedImage.encrypted,
      encryptedTemplate: encryptedTemplate.encrypted,
      referenceImageIv: encryptedImage.iv,
      referenceImageAuthTag: encryptedImage.authTag,
      templateIv: encryptedTemplate.iv,
      templateAuthTag: encryptedTemplate.authTag,
      status: "active",
      consentAt: now,
      enrolledAt: now,
      enrolledByUserId: user.id || null,
      enrolledByUserEmail: user.email || null,
      suspendedAt: null,
      suspendedByUserId: null,
      revokedAt: null,
      revokedByUserId: null,
      auditLog: {
        action: "enroll",
        livenessResult: "passed",
        at: now.toISOString(),
        by: user.email || user.id || null,
      },
    };

    const profile = existing
      ? await prisma.employeeFaceProfile.update({ where: { id: existing.id }, data })
      : await prisma.employeeFaceProfile.create({ data });

    return res.status(200).json({ profile: sanitizeProfile(profile) });
  } catch (error) {
    return sendFaceError(res, error);
  }
}
