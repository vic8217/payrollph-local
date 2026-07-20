// @ts-nocheck
import { prisma } from "./prisma";

const ENTITY_NAMES = new Set([
  "AttendanceLog",
  "CashAdvance",
  "CashAdvanceLedger",
  "CompanyPolicy",
  "CompanyProfile",
  "DailyPasscode",
  "Employee",
  "EmployeePasskey",
  "EmployeeMemo",
  "EmployeePromissoryNote",
  "EmployeeSuspension",
  "EmployeeTermination",
  "Holiday",
  "MandatoryDeductionSet",
  "NoWorkDay",
  "OvertimeRequest",
  "PayrollIncentive",
  "PayrollPeriod",
  "PayrollRecord",
  "PasscodeAuditLog",
  "PersonalLeave",
  "SeparationPay",
  "Settings",
  "ThirteenthMonthPay",
  "User",
  "VehicleTripReport",
]);

const seedRecords = [
  {
    id: "demo-company",
    entity: "CompanyProfile",
    data: {
      company_name: "PayrollPH Demo Company",
      trade_name: "PayrollPH",
      subdomain: "localhost",
      address: "Metro Manila, Philippines",
      email: "hello@payrollph.local",
      phone: "+63 900 000 0000",
      is_active: true,
    },
  },
  {
    id: "demo-shift",
    entity: "Settings",
    data: {
      company_profile_id: "demo-company",
      setting_name: "Day Shift",
      shift_start_time: "08:00",
      shift_end_time: "17:00",
      overtime_start_time: "17:30",
      grace_period_minutes: 15,
      is_default: true,
    },
  },
];

let seedPromise;

async function ensureSeedData() {
  if (!seedPromise) {
    seedPromise = (async () => {
      const companyCount = await prisma.entityRecord.count({
        where: { entity: "CompanyProfile" },
      });

      if (companyCount > 0) {
        return;
      }

      await prisma.$transaction(
        seedRecords.map((record) =>
          prisma.entityRecord.upsert({
            where: { id: record.id },
            update: {},
            create: record,
          })
        )
      );
    })();
  }

  return seedPromise;
}

export function assertEntityName(entity) {
  if (!ENTITY_NAMES.has(entity)) {
    const error = new Error(`Unknown entity: ${entity}`);
    error.statusCode = 404;
    throw error;
  }
}

export function toPublicRecord(record) {
  return {
    id: record.id,
    created_date: record.createdAt.toISOString(),
    updated_date: record.updatedAt.toISOString(),
    ...record.data,
  };
}

function normalizeFieldList(fields) {
  if (!fields) return null;
  const list = Array.isArray(fields) ? fields : String(fields).split(",");
  const normalized = list
    .map((field) => String(field || "").trim())
    .filter(Boolean);

  return normalized.length > 0 ? normalized : null;
}

function pickFields(record, fields) {
  const fieldList = normalizeFieldList(fields);
  if (!fieldList) return record;

  return fieldList.reduce((selected, field) => {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      selected[field] = record[field];
    }
    return selected;
  }, {});
}

function normalizeSort(sort) {
  if (!sort || typeof sort !== "string") {
    return null;
  }

  const direction = sort.startsWith("-") ? "desc" : "asc";
  const field = sort.replace(/^-/, "");

  if (field === "created_date") {
    return { createdAt: direction };
  }

  if (field === "updated_date") {
    return { updatedAt: direction };
  }

  return { field, direction };
}

function compareValues(a, b, direction) {
  if (a == null && b == null) return 0;
  if (a == null) return direction === "asc" ? -1 : 1;
  if (b == null) return direction === "asc" ? 1 : -1;
  if (a === b) return 0;
  return (a > b ? 1 : -1) * (direction === "asc" ? 1 : -1);
}

export async function listRecords(entity, { filter = {}, sort, limit, fields } = {}) {
  assertEntityName(entity);
  await ensureSeedData();

  const parsedSort = normalizeSort(sort);
  const records = await prisma.entityRecord.findMany({
    where: { entity },
    orderBy: parsedSort && !parsedSort.field ? parsedSort : { createdAt: "asc" },
  });

  let publicRecords = records.map(toPublicRecord);

  if (filter && Object.keys(filter).length > 0) {
    publicRecords = publicRecords.filter((record) =>
      Object.entries(filter).every(([key, value]) => record[key] === value)
    );
  }

  if (parsedSort?.field) {
    publicRecords.sort((a, b) =>
      compareValues(a[parsedSort.field], b[parsedSort.field], parsedSort.direction)
    );
  }

  const limitedRecords = limit ? publicRecords.slice(0, Number(limit)) : publicRecords;
  return fields ? limitedRecords.map((record) => pickFields(record, fields)) : limitedRecords;
}

export async function createRecord(entity, data) {
  assertEntityName(entity);
  await ensureSeedData();

  const record = await prisma.entityRecord.create({
    data: {
      entity,
      data: data || {},
    },
  });

  return toPublicRecord(record);
}

export async function updateRecord(entity, id, data) {
  assertEntityName(entity);
  await ensureSeedData();

  const existing = await prisma.entityRecord.findFirstOrThrow({
    where: { id, entity },
  });

  const record = await prisma.entityRecord.update({
    where: { id },
    data: {
      data: {
        ...existing.data,
        ...(data || {}),
      },
    },
  });

  return toPublicRecord(record);
}

export async function deleteRecord(entity, id) {
  assertEntityName(entity);
  await ensureSeedData();

  await prisma.entityRecord.deleteMany({
    where: { id, entity },
  });

  return { ok: true };
}
