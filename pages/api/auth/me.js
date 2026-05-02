// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "./[...nextauth]/index";

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);

  if (!session?.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  return res.status(200).json(session.user);
}
