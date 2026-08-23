import { isMaintenanceMode } from "@/server/maintenance";

/** This is intentionally the only public maintenance configuration exposed to the browser. */
export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  return res.status(200).json({ maintenance: isMaintenanceMode() });
}
