// @ts-nocheck
import {
  createUserPresenceChallenge,
  requireUserPresenceSession,
} from "@/server/userPresenceVerification";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await requireUserPresenceSession(req, res);
    const result = await createUserPresenceChallenge({
      user,
      purpose: req.body?.purpose || "post_login",
      req,
    });
    return res.status(200).json(result);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || "Unexpected challenge error" });
  }
}
