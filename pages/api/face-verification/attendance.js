// @ts-nocheck
import { prisma } from "@/server/prisma";
import {
  assertFreshWebcamCaptureMetadata,
  compareTemplates,
  decryptText,
  employeeName,
  employeeRecords,
  faceSetting,
  faceTemplateFromImage,
  findEmployeeForRequest,
  isFaceVerificationEnabled,
  logVerification,
  sendFaceError,
} from "@/server/faceVerification";

function enrolledFaceImage(profile) {
  if (!profile?.encryptedReferenceImage) return null;

  try {
    return decryptText(
      profile.encryptedReferenceImage,
      profile.referenceImageIv,
      profile.referenceImageAuthTag,
    );
  } catch {
    return null;
  }
}

function faceEmployeePayload(employee, profile = null) {
  return {
    id: employee.id,
    employee_id: employee.employee_id,
    employee_name: employeeName(employee),
    first_name: employee.first_name || null,
    middle_name: employee.middle_name || null,
    last_name: employee.last_name || null,
    department: employee.department || null,
    position: employee.position || null,
    company_profile_id: employee.company_profile_id || null,
    enrolledFacePhotoUrl: enrolledFaceImage(profile),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!isFaceVerificationEnabled()) {
      return res.status(200).json({ enabled: false, result: "disabled" });
    }

    const companyProfileId = req.body?.companyProfileId || null;
    const hasSelectedEmployee = Boolean(req.body?.employeeRecordId || req.body?.employeeId);

    if (!req.body?.livenessConfirmed) {
      const log = await logVerification({
        employee: { employee_id: req.body?.employeeId || "unknown", company_profile_id: companyProfileId },
        purpose: "attendance_test",
        result: "liveness failed",
        livenessResult: "failed",
        livenessMessage: "User did not confirm fresh blink/head-turn challenge.",
        req,
      });
      return res.status(200).json({ enabled: true, result: "liveness failed", log });
    }
    assertFreshWebcamCaptureMetadata(req.body?.captureMetadata);

    const candidateTemplate = faceTemplateFromImage(req.body.imageBase64);
    const setting = await faceSetting(companyProfileId);
    const minimumConfidence = Number(setting.minimumConfidence || 0.82);
    let employee = await findEmployeeForRequest({
      employeeRecordId: req.body?.employeeRecordId,
      employeeId: req.body?.employeeId,
      companyProfileId,
    });
    let profile = null;

    if (!hasSelectedEmployee) {
      const activeEmployees = await employeeRecords(companyProfileId);
      const activeEmployeeById = new Map(activeEmployees.map((item) => [
        String(item.employee_id || "").toLowerCase(),
        item,
      ]));
      const profiles = await prisma.employeeFaceProfile.findMany({
        where: {
          companyProfileId,
          status: "active",
        },
        orderBy: { updatedAt: "desc" },
      });

      let best = null;
      for (const candidateProfile of profiles) {
        const profileEmployee = activeEmployeeById.get(String(candidateProfile.employeeId || "").toLowerCase());
        if (!profileEmployee) continue;
        try {
          const referenceTemplate = JSON.parse(decryptText(
            candidateProfile.encryptedTemplate,
            candidateProfile.templateIv,
            candidateProfile.templateAuthTag,
          ));
          const confidenceScore = compareTemplates(referenceTemplate, candidateTemplate);
          if (!best || confidenceScore > best.confidenceScore) {
            best = { profile: candidateProfile, employee: profileEmployee, confidenceScore };
          }
        } catch {
          // Skip unreadable legacy/corrupt templates without blocking attendance.
        }
      }

      if (!best) {
        const log = await logVerification({
          employee: { employee_id: "unknown", company_profile_id: companyProfileId },
          purpose: "attendance_test",
          result: "no profile",
          livenessResult: "passed",
          livenessMessage: "No active enrolled profiles were available for face-only attendance.",
          req,
        });
        return res.status(200).json({ enabled: true, result: "no profile", log });
      }

      employee = best.employee;
      profile = best.profile;
      const result = best.confidenceScore >= minimumConfidence ? "verified" : "failed";
      const log = await logVerification({
        profile,
        employee,
        purpose: "attendance_test",
        result,
        confidenceScore: best.confidenceScore,
        livenessResult: "passed",
        livenessMessage: "Fresh camera capture challenge confirmed for face-only attendance.",
        photoEvidence: setting.storePhotoEvidence ? req.body.imageBase64 : null,
        req,
      });

      return res.status(200).json({
        enabled: true,
        result,
        confidenceScore: best.confidenceScore,
        minimumConfidence,
        employee: result === "verified" ? faceEmployeePayload(employee, profile) : null,
        log,
      });
    }

    if (!employee) {
      return res.status(404).json({ enabled: true, result: "no profile", error: "Active employee not found." });
    }

    profile = await prisma.employeeFaceProfile.findFirst({
      where: {
        employeeId: employee.employee_id,
        companyProfileId: employee.company_profile_id || null,
      },
      orderBy: { updatedAt: "desc" },
    });

    if (!profile || profile.status !== "active") {
      const result = profile ? "failed" : "no profile";
      const log = await logVerification({
        profile,
        employee,
        purpose: "attendance_test",
        result,
        livenessResult: "not_run",
        livenessMessage: profile ? `Profile status is ${profile.status}.` : "No enrolled active profile.",
        req,
      });
      return res.status(200).json({ enabled: true, result, log });
    }

    const referenceTemplate = JSON.parse(decryptText(
      profile.encryptedTemplate,
      profile.templateIv,
      profile.templateAuthTag,
    ));
    const confidenceScore = compareTemplates(referenceTemplate, candidateTemplate);
    const result = confidenceScore >= minimumConfidence ? "verified" : "failed";
    const log = await logVerification({
      profile,
      employee,
      purpose: "attendance_test",
      result,
      confidenceScore,
      livenessResult: "passed",
      livenessMessage: "Fresh camera capture challenge confirmed for attendance logger.",
      photoEvidence: setting.storePhotoEvidence ? req.body.imageBase64 : null,
      req,
    });

    return res.status(200).json({
      enabled: true,
      result,
      confidenceScore,
      minimumConfidence,
      employee: result === "verified" ? faceEmployeePayload(employee, profile) : null,
      log,
    });
  } catch (error) {
    return sendFaceError(res, error);
  }
}
