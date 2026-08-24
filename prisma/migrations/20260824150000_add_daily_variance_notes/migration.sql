CREATE TABLE "PayrollReconciliationDailyVarianceNote" (
  "id" TEXT NOT NULL,
  "companyProfileId" TEXT NOT NULL,
  "payrollPeriodId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "attendanceDate" DATE NOT NULL,
  "note" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedByUserId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollReconciliationDailyVarianceNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DailyVarianceNoteCreatedBy_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DailyVarianceNoteUpdatedBy_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DailyVarianceNote_company_period_employee_date_key" ON "PayrollReconciliationDailyVarianceNote"("companyProfileId", "payrollPeriodId", "employeeId", "attendanceDate");
CREATE INDEX "DailyVarianceNote_company_period_employee_idx" ON "PayrollReconciliationDailyVarianceNote"("companyProfileId", "payrollPeriodId", "employeeId");
