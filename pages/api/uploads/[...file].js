// @ts-nocheck
import fs from "node:fs/promises";
import path from "node:path";

const MIME_TYPES = {
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function uploadDir() {
  return process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(process.cwd(), "public", "uploads");
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET,HEAD");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const requested = Array.isArray(req.query.file) ? req.query.file.join("/") : req.query.file;
  const fileName = path.basename(String(requested || ""));

  if (!fileName || fileName !== requested) {
    return res.status(400).json({ error: "Invalid upload path" });
  }

  const filePath = path.join(uploadDir(), fileName);

  try {
    const content = await fs.readFile(filePath);
    const contentType = MIME_TYPES[path.extname(fileName).toLowerCase()] || "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Content-Length", content.length);

    if (req.method === "HEAD") {
      return res.status(200).end();
    }

    return res.status(200).send(content);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return res.status(404).json({ error: "Upload not found" });
    }
    return res.status(500).json({ error: "Unable to read upload" });
  }
}
