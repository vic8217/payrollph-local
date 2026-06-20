import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

function encryptionKey() {
  const secret = process.env.EMPLOYEE_PASSKEY_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('EMPLOYEE_PASSKEY_SECRET or NEXTAUTH_SECRET is required.');
  return crypto.createHash('sha256').update(secret).digest();
}

export async function protectPasskey(passkey) {
  const hash = await bcrypt.hash(passkey, 12);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(passkey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    passkey_hash: hash,
    passkey_ciphertext: Buffer.concat([iv, tag, encrypted]).toString('base64'),
  };
}

export async function verifyPasskey(passkey, hash) {
  return Boolean(hash) && bcrypt.compare(passkey, hash);
}

export function revealProtectedPasskey(payload) {
  const packed = Buffer.from(payload || '', 'base64');
  if (packed.length < 29) throw new Error('Stored passkey is invalid.');
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const encrypted = packed.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
