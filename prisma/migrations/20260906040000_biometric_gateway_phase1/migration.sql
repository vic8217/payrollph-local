-- PayrollPH biometric gateway Phase 1.
-- Idempotent so environments that already used `db:push` can apply it safely.

CREATE TABLE IF NOT EXISTS "BiometricDevice" (
    "id" TEXT NOT NULL,
    "companyProfileId" TEXT,
    "deviceSerial" TEXT NOT NULL,
    "cloudId" TEXT,
    "terminalType" TEXT,
    "productName" TEXT,
    "siteCode" TEXT,
    "siteName" TEXT,
    "registrationSecretHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastSeenAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "lastOnlineAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BiometricDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BiometricDevice_deviceSerial_key" ON "BiometricDevice"("deviceSerial");
CREATE INDEX IF NOT EXISTS "BiometricDevice_companyProfileId_idx" ON "BiometricDevice"("companyProfileId");
CREATE INDEX IF NOT EXISTS "BiometricDevice_status_idx" ON "BiometricDevice"("status");
CREATE INDEX IF NOT EXISTS "BiometricDevice_cloudId_idx" ON "BiometricDevice"("cloudId");

ALTER TABLE "BiometricDevice" ADD COLUMN IF NOT EXISTS "lastOnlineAt" TIMESTAMP(3);
ALTER TABLE "BiometricDevice" ALTER COLUMN "status" SET DEFAULT 'pending';

CREATE TABLE IF NOT EXISTS "BiometricDeviceCompany" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "companyProfileId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BiometricDeviceCompany_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BiometricDeviceCompany_deviceId_companyProfileId_key" ON "BiometricDeviceCompany"("deviceId", "companyProfileId");
CREATE INDEX IF NOT EXISTS "BiometricDeviceCompany_companyProfileId_status_idx" ON "BiometricDeviceCompany"("companyProfileId", "status");
CREATE INDEX IF NOT EXISTS "BiometricDeviceCompany_deviceId_status_idx" ON "BiometricDeviceCompany"("deviceId", "status");

CREATE TABLE IF NOT EXISTS "BiometricUserMapping" (
    "id" TEXT NOT NULL,
    "companyProfileId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "employeeRecordId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "deviceUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BiometricUserMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BiometricUserMapping_deviceId_deviceUserId_key" ON "BiometricUserMapping"("deviceId", "deviceUserId");
CREATE UNIQUE INDEX IF NOT EXISTS "BiometricUserMapping_deviceId_employeeRecordId_key" ON "BiometricUserMapping"("deviceId", "employeeRecordId");
CREATE INDEX IF NOT EXISTS "BiometricUserMapping_companyProfileId_employeeId_idx" ON "BiometricUserMapping"("companyProfileId", "employeeId");
CREATE INDEX IF NOT EXISTS "BiometricUserMapping_companyProfileId_status_idx" ON "BiometricUserMapping"("companyProfileId", "status");

CREATE TABLE IF NOT EXISTS "BiometricTimeLog" (
    "id" TEXT NOT NULL,
    "companyProfileId" TEXT,
    "deviceId" TEXT NOT NULL,
    "deviceSerial" TEXT NOT NULL,
    "logId" TEXT NOT NULL,
    "deviceUserId" TEXT,
    "occurredAt" TIMESTAMP(3),
    "occurredAtLocal" TEXT,
    "utcTimezoneMinutes" INTEGER,
    "attendStatus" TEXT,
    "verifyMethod" TEXT,
    "verifyMethodNormalized" TEXT,
    "jobCode" TEXT,
    "transId" TEXT,
    "rawPayload" JSONB NOT NULL,
    "payloadSanitized" BOOLEAN NOT NULL DEFAULT true,
    "discardedFieldNames" JSONB,
    "ingestSource" TEXT NOT NULL DEFAULT 'push',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceIp" TEXT,
    "processingStatus" TEXT NOT NULL DEFAULT 'received',
    "employeeRecordId" TEXT,
    "employeeId" TEXT,
    "attendanceLogId" TEXT,
    "mappedSlot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BiometricTimeLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BiometricTimeLog_deviceSerial_logId_key" ON "BiometricTimeLog"("deviceSerial", "logId");
CREATE INDEX IF NOT EXISTS "BiometricTimeLog_companyProfileId_occurredAt_idx" ON "BiometricTimeLog"("companyProfileId", "occurredAt");
CREATE INDEX IF NOT EXISTS "BiometricTimeLog_deviceId_occurredAt_idx" ON "BiometricTimeLog"("deviceId", "occurredAt");
CREATE INDEX IF NOT EXISTS "BiometricTimeLog_companyProfileId_deviceUserId_occurredAt_idx" ON "BiometricTimeLog"("companyProfileId", "deviceUserId", "occurredAt");
CREATE INDEX IF NOT EXISTS "BiometricTimeLog_processingStatus_idx" ON "BiometricTimeLog"("processingStatus");
CREATE INDEX IF NOT EXISTS "BiometricTimeLog_ingestSource_idx" ON "BiometricTimeLog"("ingestSource");

ALTER TABLE "BiometricTimeLog" ADD COLUMN IF NOT EXISTS "verifyMethodNormalized" TEXT;
ALTER TABLE "BiometricTimeLog" ADD COLUMN IF NOT EXISTS "payloadSanitized" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "BiometricTimeLog" ADD COLUMN IF NOT EXISTS "discardedFieldNames" JSONB;
ALTER TABLE "BiometricTimeLog" ADD COLUMN IF NOT EXISTS "ingestSource" TEXT NOT NULL DEFAULT 'push';

CREATE TABLE IF NOT EXISTS "BiometricAdminLog" (
    "id" TEXT NOT NULL,
    "companyProfileId" TEXT,
    "deviceId" TEXT NOT NULL,
    "deviceSerial" TEXT NOT NULL,
    "logId" TEXT NOT NULL,
    "adminId" TEXT,
    "deviceUserId" TEXT,
    "occurredAt" TIMESTAMP(3),
    "occurredAtLocal" TEXT,
    "action" TEXT,
    "stat" TEXT,
    "transId" TEXT,
    "rawPayload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceIp" TEXT,
    "processingStatus" TEXT NOT NULL DEFAULT 'received',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BiometricAdminLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BiometricAdminLog_deviceSerial_logId_key" ON "BiometricAdminLog"("deviceSerial", "logId");
CREATE INDEX IF NOT EXISTS "BiometricAdminLog_companyProfileId_occurredAt_idx" ON "BiometricAdminLog"("companyProfileId", "occurredAt");
CREATE INDEX IF NOT EXISTS "BiometricAdminLog_deviceId_occurredAt_idx" ON "BiometricAdminLog"("deviceId", "occurredAt");
CREATE INDEX IF NOT EXISTS "BiometricAdminLog_processingStatus_idx" ON "BiometricAdminLog"("processingStatus");

CREATE TABLE IF NOT EXISTS "BiometricAuditEvent" (
    "id" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "companyProfileId" TEXT,
    "deviceId" TEXT,
    "deviceSerial" TEXT,
    "eventType" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "reasonCode" TEXT,
    "biometricTimeLogId" TEXT,
    "mappingId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BiometricAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BiometricAuditEvent_deviceId_occurredAt_idx" ON "BiometricAuditEvent"("deviceId", "occurredAt");
CREATE INDEX IF NOT EXISTS "BiometricAuditEvent_companyProfileId_occurredAt_idx" ON "BiometricAuditEvent"("companyProfileId", "occurredAt");
CREATE INDEX IF NOT EXISTS "BiometricAuditEvent_eventType_occurredAt_idx" ON "BiometricAuditEvent"("eventType", "occurredAt");
CREATE INDEX IF NOT EXISTS "BiometricAuditEvent_result_idx" ON "BiometricAuditEvent"("result");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BiometricDeviceCompany_deviceId_fkey'
  ) THEN
    ALTER TABLE "BiometricDeviceCompany"
      ADD CONSTRAINT "BiometricDeviceCompany_deviceId_fkey"
      FOREIGN KEY ("deviceId") REFERENCES "BiometricDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BiometricUserMapping_deviceId_fkey'
  ) THEN
    ALTER TABLE "BiometricUserMapping"
      ADD CONSTRAINT "BiometricUserMapping_deviceId_fkey"
      FOREIGN KEY ("deviceId") REFERENCES "BiometricDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BiometricTimeLog_deviceId_fkey'
  ) THEN
    ALTER TABLE "BiometricTimeLog"
      ADD CONSTRAINT "BiometricTimeLog_deviceId_fkey"
      FOREIGN KEY ("deviceId") REFERENCES "BiometricDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BiometricAdminLog_deviceId_fkey'
  ) THEN
    ALTER TABLE "BiometricAdminLog"
      ADD CONSTRAINT "BiometricAdminLog_deviceId_fkey"
      FOREIGN KEY ("deviceId") REFERENCES "BiometricDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BiometricAuditEvent_deviceId_fkey'
  ) THEN
    ALTER TABLE "BiometricAuditEvent"
      ADD CONSTRAINT "BiometricAuditEvent_deviceId_fkey"
      FOREIGN KEY ("deviceId") REFERENCES "BiometricDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

UPDATE "BiometricDevice" SET "status" = 'pending' WHERE "status" IS NULL;
UPDATE "BiometricTimeLog"
SET "verifyMethodNormalized" = 'fingerprint'
WHERE lower(coalesce("verifyMethod", '')) = 'fp'
  AND "verifyMethodNormalized" IS NULL;
UPDATE "BiometricTimeLog" SET "ingestSource" = 'push' WHERE "ingestSource" IS NULL;
