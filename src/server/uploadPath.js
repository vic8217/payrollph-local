import path from "node:path";

export function getUploadDir() {
  const configuredDir = String(process.env.UPLOAD_DIR || "").trim();

  if (!configuredDir) {
    throw new Error("UPLOAD_DIR environment variable is not configured");
  }
  if (!path.isAbsolute(configuredDir)) {
    throw new Error("UPLOAD_DIR must be an absolute path");
  }

  return path.resolve(configuredDir);
}

/**
 * @param {string} fileName
 */
export function getUploadFilePath(fileName) {
  const requestedName = String(fileName || "");
  const safeFileName = path.basename(requestedName);

  if (!safeFileName || safeFileName !== requestedName) {
    throw new Error("Invalid upload file name");
  }

  return path.join(getUploadDir(), safeFileName);
}
