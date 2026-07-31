// @ts-nocheck
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getUploadDir, getUploadFilePath } from "@/server/uploadPath";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);
const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".pdf", ".doc", ".docx", ".txt"]);

function extensionFor(name) {
  const ext = path.extname(name || "").toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext) ? ext : "";
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

  const mimeType = match[1].toLowerCase();
  const ext = extensionFor(name);
  if (!ALLOWED_MIME_TYPES.has(mimeType) || !ext) {
    return res.status(400).json({ error: "Only PNG, JPG, JPEG, PDF, DOC, DOCX, and TXT files are supported" });
  }

  const fileName = `${Date.now()}-${crypto.randomUUID()}${extensionFor(name)}`;
  const dir = getUploadDir();
  const filePath = getUploadFilePath(fileName);

  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, Buffer.from(match[2], "base64"));
  } catch {
    return res.status(500).json({ error: "Unable to save uploaded file" });
  }

  return res.status(201).json({
    file_url: `/api/uploads/${fileName}`,
  });
}
