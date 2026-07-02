// @ts-nocheck
import {
  enrollUserFace,
  isUserPresenceEnabled,
  requireUserPresenceSession,
} from "@/server/userPresenceVerification";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await requireUserPresenceSession(req, res);
    if (!isUserPresenceEnabled()) {
      return res.status(200).json({ enabled: false, result: "disabled" });
    }
    if (!req.body?.livenessConfirmed) {
      return res.status(400).json({ error: "Live webcam liveness challenge is required for enrollment." });
    }
    const profile = await enrollUserFace({
      user,
      imageBase64: req.body?.imageBase64,
      consentAccepted: req.body?.consentAccepted,
      challengeId: req.body?.challengeId,
      challengeNonce: req.body?.challengeNonce,
      captureMetadata: req.body?.captureMetadata,
      req,
    });
    return res.status(200).json({ enabled: true, result: "enrolled", profile });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || "Unexpected enrollment error" });
  }
}
