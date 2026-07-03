// @ts-nocheck
import {
  requireUserPresenceSession,
  verifyUserPresence,
} from "@/server/userPresenceVerification";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await requireUserPresenceSession(req, res);
    const result = await verifyUserPresence({
      user,
      imageBase64: req.body?.imageBase64,
      livenessConfirmed: req.body?.livenessConfirmed,
      purpose: req.body?.purpose || "post_login",
      challengeId: req.body?.challengeId,
      challengeNonce: req.body?.challengeNonce,
      captureMetadata: req.body?.captureMetadata,
      req,
    });
    return res.status(200).json(result);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || "Unexpected verification error" });
  }
}
