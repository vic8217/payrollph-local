#!/usr/bin/env node
/**
 * Server-side Automatic Shift finalization.
 *
 * Intended for DigitalOcean Droplet crontab or an App Platform scheduled job:
 *
 *   node scripts/finalize-automatic-shifts.mjs
 *   COMPANY_PROFILE_ID=demo-company node scripts/finalize-automatic-shifts.mjs
 *
 * Official Time Out (2) is always the snapshotted scheduled_time_out.
 * Do not pass a live AttendanceLog ID unless UAT has authorized that mutation.
 */
import { loadPayrollphEnv } from "./biometric-uat-env.mjs";
import { prisma } from "../src/server/prisma.js";
import { finalizeAutomaticShiftLogs } from "../src/server/attendance/finalizeAutomaticShifts.js";

loadPayrollphEnv();

const asOf = process.env.AS_OF ? new Date(process.env.AS_OF) : new Date();
if (!Number.isFinite(asOf.getTime())) {
  console.error("AS_OF must be a valid timestamp.");
  process.exit(1);
}

const companyProfileId = String(process.env.COMPANY_PROFILE_ID || "").trim() || null;
const logIds = String(process.env.LOG_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const result = await finalizeAutomaticShiftLogs({
  asOf,
  companyProfileId,
  logIds: logIds.length ? logIds : null,
});

console.log(JSON.stringify(result, null, 2));

await prisma.$disconnect();
