// @ts-nocheck
import crypto from "crypto";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../pages/api/auth/[...nextauth]";
import { prisma } from "@/server/prisma";
import { listRecords } from "@/server/entityStore";

const ADMIN_ROLES = new Set(["super_admin", "admin", "user"]);
const PROFILE_STATUSES = new Set(["active", "suspended", "revoked"]);
const PURPOSES = new Set([
  "attendance_test",
  "payslip_ack_test",
  "manual_admin_check",
  "employee_self_test",
]);

export function isFaceVerificationEnabled() {
  return String(process.env.PAYROLLPH_FACE_VERIFICATION_ENABLED || "false").toLowerCase() === "true";
}

export async function requireFaceSession(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) {
    const error = new Error("Not authenticated");
    error.statusCode = 401;
    throw error;
  }
  return session.user;
}

export function requireFaceFeatureEnabled() {
  if (!isFaceVerificationEnabled()) {
    const error = new Error("Face Verification is disabled.");
    error.statusCode = 403;
    throw error;
  }
}

export function requireFaceAdmin(user) {
  if (!ADMIN_ROLES.has(user?.role)) {
    const error = new Error("Not authorized for face verification administration.");
    error.statusCode = 403;
    throw error;
  }
}

export function sendFaceError(res, error) {
  return res.status(error.statusCode || 500).json({
    error: error.message || "Unexpected face verification error",
  });
}

export function clientIp(req) {
  return (
    req.headers?.["x-forwarded-for"]?.split(",")?.[0]?.trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

function encryptionKey() {
  return crypto
    .createHash("sha256")
    .update(
      process.env.PAYROLLPH_FACE_VERIFICATION_KEY ||
        process.env.NEXTAUTH_SECRET ||
        process.env.AUTH_SECRET ||
        process.env.DATABASE_URL ||
        "payrollph-local-face-verification-development-key",
    )
    .digest();
}

export function encryptText(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return {
    encrypted: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptText(encrypted, iv, authTag) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function sanitizeProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    companyProfileId: profile.companyProfileId,
    employeeRecordId: profile.employeeRecordId,
    employeeId: profile.employeeId,
    employeeName: profile.employeeName,
    status: profile.status,
    consentAt: profile.consentAt,
    enrolledAt: profile.enrolledAt,
    enrolledByUserId: profile.enrolledByUserId,
    enrolledByUserEmail: profile.enrolledByUserEmail,
    suspendedAt: profile.suspendedAt,
    revokedAt: profile.revokedAt,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export function sanitizeLog(log) {
  if (!log) return null;
  return {
    id: log.id,
    companyProfileId: log.companyProfileId,
    employeeFaceProfileId: log.employeeFaceProfileId,
    employeeRecordId: log.employeeRecordId,
    employeeId: log.employeeId,
    employeeName: log.employeeName,
    purpose: log.purpose,
    result: log.result,
    confidenceScore: log.confidenceScore,
    livenessResult: log.livenessResult,
    livenessMessage: log.livenessMessage,
    deviceUserAgent: log.deviceUserAgent,
    ipAddress: log.ipAddress,
    requestedByUserId: log.requestedByUserId,
    requestedByUserEmail: log.requestedByUserEmail,
    createdAt: log.createdAt,
  };
}

export async function employeeRecords(companyProfileId, { activeOnly = true } = {}) {
  const filter = {
    ...(companyProfileId ? { company_profile_id: companyProfileId } : {}),
    ...(activeOnly ? { status: "active" } : {}),
  };
  return listRecords("Employee", { filter, sort: "last_name", limit: 5000 });
}

export function employeeName(employee) {
  return [employee?.first_name, employee?.middle_name, employee?.last_name]
    .filter(Boolean)
    .join(" ");
}

export async function findEmployeeForUser(user) {
  const companyIds = user.company_profile_ids?.length
    ? user.company_profile_ids
    : [user.company_profile_id].filter(Boolean);
  const candidates = [];
  for (const companyId of companyIds.length ? companyIds : [null]) {
    candidates.push(...await employeeRecords(companyId));
  }
  const email = String(user.email || "").toLowerCase();
  return candidates.find((employee) =>
    [employee.email, employee.user_email]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase())
      .includes(email)
  ) || null;
}

export async function findEmployeeForRequest({ employeeRecordId, employeeId, companyProfileId }) {
  const employees = await employeeRecords(companyProfileId);
  return employees.find((employee) =>
    String(employee.id || "") === String(employeeRecordId || "") ||
    String(employee.employee_id || "").toLowerCase() === String(employeeId || "").toLowerCase()
  ) || null;
}

export function assertDataImage(imageBase64) {
  if (
    typeof imageBase64 !== "string" ||
    !/^data:image\/(png|jpe?g|webp);base64,/i.test(imageBase64) ||
    imageBase64.length < 512
  ) {
    const error = new Error("Fresh camera image is required.");
    error.statusCode = 400;
    throw error;
  }
}

export function faceTemplateFromImage(imageBase64) {
  assertDataImage(imageBase64);
  const base64 = imageBase64.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length < 256) {
    const error = new Error("Captured image is too small for verification.");
    error.statusCode = 400;
    throw error;
  }

  const bucketCount = 32;
  const buckets = Array.from({ length: bucketCount }, () => ({ sum: 0, count: 0 }));
  const histogramBinCount = 64;
  const histogram = Array.from({ length: histogramBinCount }, () => 0);
  const transitionBuckets = Array.from({ length: bucketCount }, () => ({ sum: 0, count: 0 }));
  for (let index = 0; index < bytes.length; index += 1) {
    const bucket = buckets[index % bucketCount];
    bucket.sum += bytes[index];
    bucket.count += 1;
    histogram[Math.min(histogramBinCount - 1, Math.floor(bytes[index] / 4))] += 1;

    if (index > 0) {
      const transitionBucket = transitionBuckets[index % bucketCount];
      transitionBucket.sum += Math.abs(bytes[index] - bytes[index - 1]);
      transitionBucket.count += 1;
    }
  }

  const sampleCount = 128;
  const sampledBytes = Array.from({ length: sampleCount }, (_, index) => {
    const byteIndex = Math.min(bytes.length - 1, Math.floor(((index + 0.5) * bytes.length) / sampleCount));
    return Number((bytes[byteIndex] / 255).toFixed(6));
  });
  const totalBytes = Math.max(bytes.length, 1);

  return {
    version: 2,
    length: bytes.length,
    digest: crypto.createHash("sha256").update(bytes).digest("hex"),
    vector: buckets.map((bucket) => Number(((bucket.sum / Math.max(bucket.count, 1)) / 255).toFixed(6))),
    histogram: histogram.map((count) => Number((count / totalBytes).toFixed(6))),
    sampledBytes,
    transitions: transitionBuckets.map((bucket) => Number(((bucket.sum / Math.max(bucket.count, 1)) / 255).toFixed(6))),
  };
}

export function assertFreshWebcamCaptureMetadata(captureMetadata) {
  const metadata = captureMetadata || {};
  const cameraStartedAt = Number(metadata.cameraStartedAt || 0);
  const livenessDetectedAt = Number(metadata.livenessDetectedAt || 0);
  const capturedAt = Number(metadata.capturedAt || 0);

  if (
    metadata.source !== "webcam" ||
    !Number.isFinite(cameraStartedAt) ||
    !Number.isFinite(livenessDetectedAt) ||
    !Number.isFinite(capturedAt) ||
    cameraStartedAt <= 0 ||
    livenessDetectedAt - cameraStartedAt < 1000 ||
    capturedAt < livenessDetectedAt ||
    capturedAt - livenessDetectedAt > 7000 ||
    Date.now() - capturedAt > 30000
  ) {
    const error = new Error("Fresh live webcam capture metadata is required. Please retake the live capture.");
    error.statusCode = 400;
    throw error;
  }
}

export function compareTemplates(reference, candidate) {
  if (!reference?.vector || !candidate?.vector || reference.vector.length !== candidate.vector.length) {
    return 0;
  }

  const distance = Math.sqrt(
    reference.vector.reduce((sum, value, index) => {
      const delta = value - candidate.vector[index];
      return sum + delta * delta;
    }, 0),
  );
  const lengthPenalty = Math.min(
    Math.abs((reference.length || 0) - (candidate.length || 0)) /
      Math.max(reference.length || 1, candidate.length || 1),
    1,
  );
  return Number(Math.max(0, Math.min(1, 1 - distance / 3 - lengthPenalty * 0.15)).toFixed(4));
}

function cosineSimilarity(left = [], right = []) {
  if (!left?.length || left.length !== right?.length) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += Number(left[index] || 0) * Number(right[index] || 0);
    leftMagnitude += Number(left[index] || 0) ** 2;
    rightMagnitude += Number(right[index] || 0) ** 2;
  }
  if (!leftMagnitude || !rightMagnitude) return 0;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function meanAbsoluteSimilarity(left = [], right = []) {
  if (!left?.length || left.length !== right?.length) return 0;
  const distance = left.reduce((sum, value, index) => sum + Math.abs(Number(value || 0) - Number(right[index] || 0)), 0) / left.length;
  return Math.max(0, Math.min(1, 1 - distance));
}

function compareDuplicateTemplates(reference, candidate) {
  if (!reference || !candidate) return 0;
  if (reference.digest && candidate.digest && reference.digest === candidate.digest) return 1;

  const baseScore = compareTemplates(reference, candidate);
  const histogramScore = cosineSimilarity(reference.histogram, candidate.histogram);
  const sampleScore = meanAbsoluteSimilarity(reference.sampledBytes, candidate.sampledBytes);
  const transitionScore = meanAbsoluteSimilarity(reference.transitions, candidate.transitions);
  const referenceImageScore = Number((
    histogramScore * 0.45 +
    sampleScore * 0.35 +
    transitionScore * 0.2
  ).toFixed(4));

  return Math.max(baseScore, referenceImageScore);
}

export async function faceSetting(companyProfileId) {
  const setting = await prisma.faceVerificationSetting.findFirst({
    where: { companyProfileId: companyProfileId || null },
  }).catch(() => null);
  return setting || {
    enabled: isFaceVerificationEnabled(),
    storePhotoEvidence: false,
    minimumConfidence: 0.82,
  };
}

export async function assertNoDuplicateEmployeeFaceEnrollment({
  candidateTemplate,
  companyProfileId,
  employeeId,
  excludeProfileId = null,
}) {
  const setting = await faceSetting(companyProfileId || null);
  const minimumConfidence = Number(setting.minimumConfidence || 0.82);
  const duplicateThreshold = Number(
    process.env.PAYROLLPH_FACE_DUPLICATE_THRESHOLD ||
      Math.max(0.84, minimumConfidence + 0.02),
  );

  const profiles = await prisma.employeeFaceProfile.findMany({
    where: {
      companyProfileId: companyProfileId || null,
      status: "active",
      ...(excludeProfileId ? { id: { not: excludeProfileId } } : {}),
      ...(employeeId ? { employeeId: { not: employeeId } } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });

  let bestMatch = null;
  for (const profile of profiles) {
    try {
      const referenceTemplate = JSON.parse(decryptText(
        profile.encryptedTemplate,
        profile.templateIv,
        profile.templateAuthTag,
      ));
      let comparableTemplate = referenceTemplate;
      if (profile.encryptedReferenceImage) {
        try {
          comparableTemplate = faceTemplateFromImage(decryptText(
            profile.encryptedReferenceImage,
            profile.referenceImageIv,
            profile.referenceImageAuthTag,
          ));
        } catch {
          comparableTemplate = referenceTemplate;
        }
      }
      const confidenceScore = compareDuplicateTemplates(comparableTemplate, candidateTemplate);
      if (!bestMatch || confidenceScore > bestMatch.confidenceScore) {
        bestMatch = { profile, confidenceScore };
      }
    } catch {
      // Skip unreadable legacy/corrupt templates without blocking enrollment.
    }
  }

  if (bestMatch && bestMatch.confidenceScore >= duplicateThreshold) {
    const error = new Error(
      `This face appears to already be enrolled for ${bestMatch.profile.employeeName || bestMatch.profile.employeeId || "another employee"}.`,
    );
    error.statusCode = 409;
    error.duplicateFace = {
      profileId: bestMatch.profile.id,
      employeeId: bestMatch.profile.employeeId,
      employeeName: bestMatch.profile.employeeName,
      confidenceScore: bestMatch.confidenceScore,
      duplicateThreshold,
    };
    throw error;
  }
}

export async function logVerification({
  profile,
  employee,
  purpose,
  result,
  confidenceScore = null,
  livenessResult,
  livenessMessage = null,
  photoEvidence = null,
  user,
  req,
}) {
  const evidence = photoEvidence ? encryptText(photoEvidence) : null;
  const log = await prisma.employeeFaceVerificationLog.create({
    data: {
      companyProfileId: employee?.company_profile_id || profile?.companyProfileId || user?.company_profile_id || null,
      employeeFaceProfileId: profile?.id || null,
      employeeRecordId: employee?.id || profile?.employeeRecordId || null,
      employeeId: employee?.employee_id || profile?.employeeId || "unknown",
      employeeName: employeeName(employee) || profile?.employeeName || null,
      purpose,
      result,
      confidenceScore,
      livenessResult,
      livenessMessage,
      deviceUserAgent: req?.headers?.["user-agent"] || null,
      ipAddress: clientIp(req),
      encryptedPhotoEvidence: evidence?.encrypted || null,
      photoEvidenceIv: evidence?.iv || null,
      photoEvidenceAuthTag: evidence?.authTag || null,
      requestedByUserId: user?.id || null,
      requestedByUserEmail: user?.email || null,
      auditLog: {
        action: "verification",
        result,
        purpose,
        at: new Date().toISOString(),
      },
    },
  });
  return sanitizeLog(log);
}

export function assertPurpose(value) {
  const purpose = String(value || "employee_self_test");
  return PURPOSES.has(purpose) ? purpose : "employee_self_test";
}

export function assertProfileStatus(value) {
  const status = String(value || "active");
  return PROFILE_STATUSES.has(status) ? status : "active";
}
