// @ts-nocheck
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

function extensionFor(name) {
  const ext = path.extname(name || "").toLowerCase();
  return ext && ext.length <= 12 ? ext : "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { name, dataUrl } = req.body || {};
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
  if (!match) {
    return res.status(400).json({ error: "Invalid upload payload" });
  }

  const fileName = `${Date.now()}-${crypto.randomUUID()}${extensionFor(name)}`;
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  const filePath = path.join(uploadDir, fileName);

  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(filePath, Buffer.from(match[2], "base64"));

  return res.status(201).json({
    file_url: `/uploads/${fileName}`,
  });
}
