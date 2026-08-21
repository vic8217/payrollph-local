-- Proposed migration only. Do not apply until reviewed.
CREATE TABLE "PayrollReconciliationReviewerNote" (
    "id" TEXT NOT NULL,
    "companyProfileId" TEXT NOT NULL,
    "payrollPeriodId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "reconciliationId" TEXT,
    "category" TEXT NOT NULL,
    "reviewerNote" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'needs_response',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "response" TEXT,
    "respondedByUserId" TEXT,
    "respondedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayrollReconciliationReviewerNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PayrollReconciliationReviewerNoteEvent" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "previousStatus" TEXT,
    "newStatus" TEXT,
    "remarks" TEXT,
    "actorUserId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "snapshotCategory" TEXT,
    "snapshotSystemValue" DECIMAL(18,4),
    "snapshotManualValue" DECIMAL(18,4),
    "snapshotDifferenceValue" DECIMAL(18,4),
    "snapshotValueType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayrollReconciliationReviewerNoteEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReviewerNote_company_period_idx" ON "PayrollReconciliationReviewerNote"("companyProfileId", "payrollPeriodId");
CREATE INDEX "ReviewerNote_company_period_status_idx" ON "PayrollReconciliationReviewerNote"("companyProfileId", "payrollPeriodId", "status");
CREATE INDEX "ReviewerNote_company_employee_period_idx" ON "PayrollReconciliationReviewerNote"("companyProfileId", "employeeId", "payrollPeriodId");
CREATE INDEX "PayrollReconciliationReviewerNote_employeeId_payrollPeriodId_idx" ON "PayrollReconciliationReviewerNote"("employeeId", "payrollPeriodId");
CREATE INDEX "PayrollReconciliationReviewerNote_status_idx" ON "PayrollReconciliationReviewerNote"("status");
CREATE INDEX "PayrollReconciliationReviewerNote_reconciliationId_idx" ON "PayrollReconciliationReviewerNote"("reconciliationId");
CREATE INDEX "PayrollReconciliationReviewerNoteEvent_noteId_createdAt_idx" ON "PayrollReconciliationReviewerNoteEvent"("noteId", "createdAt");
CREATE INDEX "PayrollReconciliationReviewerNoteEvent_actorUserId_idx" ON "PayrollReconciliationReviewerNoteEvent"("actorUserId");

ALTER TABLE "PayrollReconciliationReviewerNote" ADD CONSTRAINT "PayrollReconciliationReviewerNote_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollReconciliationReviewerNote" ADD CONSTRAINT "PayrollReconciliationReviewerNote_respondedByUserId_fkey" FOREIGN KEY ("respondedByUserId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollReconciliationReviewerNote" ADD CONSTRAINT "PayrollReconciliationReviewerNote_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollReconciliationReviewerNoteEvent" ADD CONSTRAINT "PayrollReconciliationReviewerNoteEvent_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "PayrollReconciliationReviewerNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollReconciliationReviewerNoteEvent" ADD CONSTRAINT "PayrollReconciliationReviewerNoteEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
