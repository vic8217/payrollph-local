// @ts-nocheck
import crypto from "node:crypto";

const BEARER_PREFIX = "bearer ";

export function getGatewaySecret(env = process.env) {
  return String(env.BIOMETRIC_GATEWAY_SECRET || "").trim();
}

export function extractBearerToken(req) {
  const header = req?.headers?.authorization ?? req?.headers?.Authorization;
  if (typeof header !== "string") return null;
  if (!header.toLowerCase().startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token || null;
}

export function verifyGatewaySecret(provided, expected = getGatewaySecret()) {
  if (!expected || !provided) return false;
  const supplied = Buffer.from(String(provided), "utf8");
  const secret = Buffer.from(String(expected), "utf8");
  if (supplied.length !== secret.length) return false;
  return crypto.timingSafeEqual(supplied, secret);
}

/**
 * Single machine-auth gate for manufacturer-facing /api/device/* routes.
 * Phase 1 uses BIOMETRIC_GATEWAY_SECRET bearer tokens. Later HMAC or
 * per-gateway credentials should replace only this module.
 */
export function requireGatewayAuth(req, res, env = process.env) {
  const expected = getGatewaySecret(env);
  if (!expected) {
    res.status(503).json({ reason: "GATEWAY_SECRET_NOT_CONFIGURED" });
    return false;
  }
  if (!verifyGatewaySecret(extractBearerToken(req), expected)) {
    res.status(401).json({ reason: "GATEWAY_UNAUTHORIZED" });
    return false;
  }
  return true;
}

export function requireDeviceGatewayPost(req, res, env = process.env) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ reason: "METHOD_NOT_ALLOWED" });
    return false;
  }
  return requireGatewayAuth(req, res, env);
}
