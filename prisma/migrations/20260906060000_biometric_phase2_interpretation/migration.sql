ALTER TABLE "BiometricTimeLog" ADD COLUMN IF NOT EXISTS "interpretedAt" TIMESTAMP(3);
ALTER TABLE "BiometricTimeLog" ADD COLUMN IF NOT EXISTS "interpretationCode" TEXT;
ALTER TABLE "BiometricTimeLog" ADD COLUMN IF NOT EXISTS "interpretationMessage" TEXT;
ALTER TABLE "BiometricTimeLog" ADD COLUMN IF NOT EXISTS "reviewReason" TEXT;
ALTER TABLE "BiometricTimeLog" ADD COLUMN IF NOT EXISTS "interpretationSnapshot" JSONB;
