// @ts-nocheck
import { listRecords } from "@/server/entityStore";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const code = String(req.body?.code || "").trim();
  if (!code) {
    return res.status(400).json({ error: "Employee code is required" });
  }

  const normalizedCode = code.replace(/-PayrollPH$/i, "");

  const [byEmployeeId] = await listRecords("Employee", {
    filter: { employee_id: normalizedCode, status: "active" },
    limit: 1,
  });

  if (byEmployeeId) {
    return res.status(200).json({ employee: byEmployeeId });
  }

  const [byQrCode] = await listRecords("Employee", {
    filter: { qr_code: code, status: "active" },
    limit: 1,
  });

  if (byQrCode) {
    return res.status(200).json({ employee: byQrCode });
  }

  const [byNormalizedQrCode] = await listRecords("Employee", {
    filter: { qr_code: normalizedCode, status: "active" },
    limit: 1,
  });

  if (byNormalizedQrCode) {
    return res.status(200).json({ employee: byNormalizedQrCode });
  }

  return res.status(404).json({ error: "Employee not found" });
}
