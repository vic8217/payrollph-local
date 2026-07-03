// @ts-nocheck
import crypto from "crypto";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../pages/api/auth/[...nextauth]";
import { prisma } from "@/server/prisma";
import {
  clientIp,
  compareTemplates,
  decryptText,
  encryptText,
  faceSetting,
  faceTemplateFromImage,
} from "@/server/faceVerification";

const ADMIN_ROLES = new Set(["super_admin", "admin", "user"]);
const VERIFIED_MAX_AGE_MS = 10 * 60 * 1000;
const HIGH_RISK_MAX_AGE_MS = 2 * 60 * 1000;
const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const FAILED_RESULTS = new Set(["failed", "liveness failed", "no profile"]);

export function isUserPresenceEnabled() {
  const explicit = process.env.PAYROLLPH_ACCURA_FACE_VERIFICATION_ENABLED;
  if (explicit != null) return String(explicit).toLowerCase() === "true";
  return String(process.env.PAYROLLPH_FACE_VERIFICATION_ENABLED || "false").toLowerCase() === "true";
}

export async function requireUserPresenceSession(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    const error = new Error("Not authenticated");
    error.statusCode = 401;
    throw error;
  }
  return session.user;
}

export function requireUserPresenceAdmin(user) {
  if (!ADMIN_ROLES.has(user?.role)) {
    const error = new Error("Not authorized to view face verification status.");
    error.statusCode = 403;
    throw error;
  }
}

export function sanitizeUserFaceProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    userId: profile.userId,
    companyProfileId: profile.companyProfileId,
    status: profile.status,
    consentAt: profile.consentAt,
    enrolledAt: profile.enrolledAt,
    enrolledByUserId: profile.enrolledByUserId,
    enrolledByUserEmail: profile.enrolledByUserEmail,
    revokedAt: profile.revokedAt,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export function sanitizeUserFaceLog(log) {
  if (!log) return null;
  return {
    id: log.id,
    userId: log.userId,
    companyProfileId: log.companyProfileId,
    userFaceProfileId: log.userFaceProfileId,
    purpose: log.purpose,
    result: log.result,
    similarityScore: log.similarityScore,
    livenessResult: log.livenessResult,
    livenessMessage: log.livenessMessage,
    deviceUserAgent: log.deviceUserAgent,
    ipAddress: log.ipAddress,
    requestedByUserEmail: log.requestedByUserEmail,
    repeatedAttempt: Boolean(log.auditLog?.repeatedAttempt),
    createdAt: log.createdAt,
  };
}

function hashNonce(nonce) {
  return crypto.createHash("sha256").update(String(nonce || "")).digest("hex");
}

function sameClient(req, challenge) {
  const currentUa = req?.headers?.["user-agent"] || null;
  const currentIp = clientIp(req);
  return (
    (!challenge.deviceUserAgent || challenge.deviceUserAgent === currentUa) &&
    (!challenge.ipAddress || challenge.ipAddress === currentIp)
  );
}

function assertFreshWebcamCapture({ challenge, challengeNonce, captureMetadata, req }) {
  if (!challenge?.id || !challengeNonce) {
    const error = new Error("Fresh webcam verification challenge is required.");
    error.statusCode = 400;
    throw error;
  }
  if (challenge.consumedAt || new Date(challenge.expiresAt).getTime() < Date.now()) {
    const error = new Error("Face verification challenge expired. Please retake the live capture.");
    error.statusCode = 400;
    throw error;
  }
  if (challenge.nonceHash !== hashNonce(challengeNonce) || !sameClient(req, challenge)) {
    const error = new Error("Face verification challenge does not match this device session.");
    error.statusCode = 403;
    throw error;
  }

  const metadata = captureMetadata || {};
  const cameraStartedAt = Number(metadata.cameraStartedAt || 0);
  const livenessDetectedAt = Number(metadata.livenessDetectedAt || 0);
  const capturedAt = Number(metadata.capturedAt || 0);
  const issuedAt = new Date(challenge.issuedAt).getTime();
  if (
    metadata.source !== "webcam" ||
    !Number.isFinite(cameraStartedAt) ||
    !Number.isFinite(livenessDetectedAt) ||
    !Number.isFinite(capturedAt) ||
    cameraStartedAt < issuedAt - 1000 ||
    livenessDetectedAt - cameraStartedAt < 1000 ||
    capturedAt < livenessDetectedAt ||
    capturedAt - livenessDetectedAt > 7000 ||
    Date.now() - capturedAt > 30000
  ) {
    const error = new Error("Fresh live webcam capture metadata is required. Uploaded or stale images are not accepted.");
    error.statusCode = 400;
    throw error;
  }
}

export async function createUserPresenceChallenge({ user, purpose = "post_login", req }) {
  if (!isUserPresenceEnabled()) {
    return { enabled: false, result: "disabled" };
  }
  const nonce = crypto.randomBytes(24).toString("base64url");
  const challenge = await prisma.userFaceVerificationChallenge.create({
    data: {
      userId: user.id,
      companyProfileId: user.company_profile_id || null,
      purpose,
      nonceHash: hashNonce(nonce),
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      deviceUserAgent: req?.headers?.["user-agent"] || null,
      ipAddress: clientIp(req),
    },
  });
  return {
    enabled: true,
    challenge: {
      id: challenge.id,
      nonce,
      purpose: challenge.purpose,
      issuedAt: challenge.issuedAt,
      expiresAt: challenge.expiresAt,
    },
  };
}

async function consumeChallenge({ user, purpose, challengeId, challengeNonce, captureMetadata, req }) {
  const challenge = await prisma.userFaceVerificationChallenge.findFirst({
    where: {
      id: String(challengeId || ""),
      userId: user.id,
      purpose,
    },
  });
  assertFreshWebcamCapture({ challenge, challengeNonce, captureMetadata, req });
  await prisma.userFaceVerificationChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });
  return challenge;
}

async function repeatedAttemptCount({ user, purpose }) {
  const since = new Date(Date.now() - 15 * 60 * 1000);
  return prisma.userFaceVerificationLog.count({
    where: {
      userId: user.id,
      purpose,
      result: { in: Array.from(FAILED_RESULTS) },
      createdAt: { gte: since },
    },
  });
}

export async function logUserPresence({
  user,
  profile = null,
  purpose,
  result,
  similarityScore = null,
  livenessResult,
  livenessMessage = null,
  req,
}) {
  const log = await prisma.userFaceVerificationLog.create({
    data: {
      userId: user.id,
      companyProfileId: user.company_profile_id || profile?.companyProfileId || null,
      userFaceProfileId: profile?.id || null,
      purpose,
      result,
      similarityScore,
      livenessResult,
      livenessMessage,
      deviceUserAgent: req?.headers?.["user-agent"] || null,
      ipAddress: clientIp(req),
      requestedByUserEmail: user.email || null,
      auditLog: {
        action: "user_presence_verification",
        purpose,
        result,
        repeatedAttempt: FAILED_RESULTS.has(result)
          ? (await repeatedAttemptCount({ user, purpose })) + 1 >= 3
          : false,
        at: new Date().toISOString(),
      },
    },
  });
  return sanitizeUserFaceLog(log);
}

export async function enrollUserFace({
  user,
  imageBase64,
  consentAccepted,
  challengeId,
  challengeNonce,
  captureMetadata,
  req,
}) {
  if (!consentAccepted) {
    const error = new Error("Consent is required for user face enrollment.");
    error.statusCode = 400;
    throw error;
  }
  await consumeChallenge({
    user,
    purpose: "user_enrollment",
    challengeId,
    challengeNonce,
    captureMetadata,
    req,
  });
  const embedding = faceTemplateFromImage(imageBase64);
  const encryptedEmbedding = encryptText(JSON.stringify(embedding));
  const encryptedImage = encryptText(imageBase64);
  const data = {
    companyProfileId: user.company_profile_id || null,
    encryptedReferenceImage: encryptedImage.encrypted,
    encryptedEmbedding: encryptedEmbedding.encrypted,
    referenceImageIv: encryptedImage.iv,
    referenceImageAuthTag: encryptedImage.authTag,
    embeddingIv: encryptedEmbedding.iv,
    embeddingAuthTag: encryptedEmbedding.authTag,
    status: "active",
    consentAt: new Date(),
    enrolledByUserId: user.id,
    enrolledByUserEmail: user.email || null,
    revokedAt: null,
    revokedByUserId: null,
    auditLog: {
      action: "user_face_enrolled",
      at: new Date().toISOString(),
      by: user.email || user.id,
    },
  };

  const profile = await prisma.userFaceProfile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  });

  await logUserPresence({
    user,
    profile,
    purpose: "user_enrollment",
    result: "enrolled",
    livenessResult: "passed",
    livenessMessage: "Fresh camera capture used for enrollment.",
    req,
  });

  return sanitizeUserFaceProfile(profile);
}

export async function verifyUserPresence({
  user,
  imageBase64,
  livenessConfirmed,
  purpose = "post_login",
  challengeId,
  challengeNonce,
  captureMetadata,
  req,
}) {
  if (!isUserPresenceEnabled()) {
    return { enabled: false, result: "disabled" };
  }

  await consumeChallenge({
    user,
    purpose,
    challengeId,
    challengeNonce,
    captureMetadata,
    req,
  });

  const profile = await prisma.userFaceProfile.findUnique({ where: { userId: user.id } });
  if (!profile || profile.status !== "active") {
    const result = profile ? "failed" : "no profile";
    const log = await logUserPresence({
      user,
      profile,
      purpose,
      result,
      livenessResult: "not_run",
      livenessMessage: profile ? `Profile status is ${profile.status}.` : "No enrolled active user face profile.",
      req,
    });
    return { enabled: true, result, log };
  }

  if (!livenessConfirmed) {
    const log = await logUserPresence({
      user,
      profile,
      purpose,
      result: "liveness failed",
      livenessResult: "failed",
      livenessMessage: "Live webcam blink/head-turn challenge was not completed.",
      req,
    });
    return { enabled: true, result: "liveness failed", log };
  }

  const candidateEmbedding = faceTemplateFromImage(imageBase64);
  const referenceEmbedding = JSON.parse(decryptText(
    profile.encryptedEmbedding,
    profile.embeddingIv,
    profile.embeddingAuthTag,
  ));
  const setting = await faceSetting(user.company_profile_id || null);
  const minimumConfidence = Number(setting.minimumConfidence || 0.82);
  const similarityScore = compareTemplates(referenceEmbedding, candidateEmbedding);
  const result = similarityScore >= minimumConfidence ? "verified" : "failed";
  const log = await logUserPresence({
    user,
    profile,
    purpose,
    result,
    similarityScore,
    livenessResult: "passed",
    livenessMessage: "Fresh webcam liveness challenge completed.",
    req,
  });

  return {
    enabled: true,
    result,
    similarityScore,
    minimumConfidence,
    profile: sanitizeUserFaceProfile(profile),
    log,
  };
}

export async function hasRecentUserPresence(userId, { maxAgeMs = VERIFIED_MAX_AGE_MS, purpose } = {}) {
  const since = new Date(Date.now() - maxAgeMs);
  const log = await prisma.userFaceVerificationLog.findFirst({
    where: {
      userId,
      result: "verified",
      livenessResult: "passed",
      createdAt: { gte: since },
      ...(purpose ? { purpose } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return sanitizeUserFaceLog(log);
}

export async function requireRecentUserPresence(user, options = {}) {
  if (!isUserPresenceEnabled()) return null;
  const log = await hasRecentUserPresence(user.id, {
    maxAgeMs: options.purpose === "high_risk_action" ? HIGH_RISK_MAX_AGE_MS : options.maxAgeMs,
    ...options,
  });
  if (!log) {
    const error = new Error("Face verification is required for this high-risk action.");
    error.statusCode = 403;
    throw error;
  }
  return log;
}
