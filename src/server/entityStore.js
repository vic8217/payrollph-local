// @ts-nocheck
import { prisma } from "./prisma";
import { Prisma } from "@prisma/client";
import { normalizePagination } from "@/lib/pagination";

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
  "PayrollReconciliation",
  "PasscodeAuditLog",
  "PersonalLeave",
  "SeparationPay",
  "Settings",
  "SpecialRateAttendance",
  "SpecialRatePayrollPeriod",
  "SpecialRatePayrollRecord",
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

function matchesFilterValue(actual, expected) {
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) return actual === expected;
  if (Object.prototype.hasOwnProperty.call(expected, "$gte") && !(actual >= expected.$gte)) return false;
  if (Object.prototype.hasOwnProperty.call(expected, "$lte") && !(actual <= expected.$lte)) return false;
  if (Object.prototype.hasOwnProperty.call(expected, "$gt") && !(actual > expected.$gt)) return false;
  if (Object.prototype.hasOwnProperty.call(expected, "$lt") && !(actual < expected.$lt)) return false;
  if (Array.isArray(expected.$in) && !expected.$in.includes(actual)) return false;
  return true;
}

export async function listRecords(entity, { filter = {}, sort, limit, offset = 0, fields } = {}) {
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
      Object.entries(filter).every(([key, value]) => matchesFilterValue(record[key], value))
    );
  }

  if (parsedSort?.field) {
    publicRecords.sort((a, b) =>
      compareValues(a[parsedSort.field], b[parsedSort.field], parsedSort.direction)
    );
  }

  const start = Math.max(0, Number(offset) || 0);
  const limitedRecords = limit ? publicRecords.slice(start, start + Number(limit)) : publicRecords.slice(start);
  return fields ? limitedRecords.map((record) => pickFields(record, fields)) : limitedRecords;
}

function paginatedFieldExpression(field) {
  if (field === "id") return Prisma.sql`id`;
  if (field === "created_date") return Prisma.sql`"createdAt"`;
  if (field === "updated_date") return Prisma.sql`"updatedAt"`;
  return Prisma.sql`data ->> ${field}`;
}

function paginatedFilterCondition(field, expected) {
  const expression = paginatedFieldExpression(field);
  const comparisonValue = value => ["created_date", "updated_date"].includes(field)
    ? new Date(value)
    : String(value);
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    const conditions = [];
    if (Object.prototype.hasOwnProperty.call(expected, "$gte")) conditions.push(Prisma.sql`${expression} >= ${comparisonValue(expected.$gte)}`);
    if (Object.prototype.hasOwnProperty.call(expected, "$lte")) conditions.push(Prisma.sql`${expression} <= ${comparisonValue(expected.$lte)}`);
    if (Object.prototype.hasOwnProperty.call(expected, "$gt")) conditions.push(Prisma.sql`${expression} > ${comparisonValue(expected.$gt)}`);
    if (Object.prototype.hasOwnProperty.call(expected, "$lt")) conditions.push(Prisma.sql`${expression} < ${comparisonValue(expected.$lt)}`);
    if (Array.isArray(expected.$in)) {
      const values = expected.$in.map(value => String(value));
      conditions.push(values.length ? Prisma.sql`${expression} IN (${Prisma.join(values)})` : Prisma.sql`FALSE`);
    }
    return conditions.length ? Prisma.sql`(${Prisma.join(conditions, " AND ")})` : Prisma.sql`TRUE`;
  }
  if (expected == null) return Prisma.sql`(${expression} IS NULL OR ${expression} = '')`;
  return Prisma.sql`${expression} = ${comparisonValue(expected)}`;
}

/** Database-level pagination for high-volume append-only entity logs. */
export async function listRecordsPage(entity, { filter = {}, sort, page = 1, pageSize = 50, fields, legacyAttendanceAudit = false, search } = {}) {
  assertEntityName(entity);
  if (!["AttendanceLog", "PasscodeAuditLog"].includes(entity)) {
    const error = new Error(`Database pagination is not enabled for ${entity}`);
    error.statusCode = 400;
    throw error;
  }
  await ensureSeedData();

  const normalized = normalizePagination(page, pageSize);
  const safePage = normalized.page;
  const safePageSize = normalized.pageSize;
  const skip = (safePage - 1) * safePageSize;
  const filterConditions = Object.entries(filter || {}).map(([field, expected]) =>
    paginatedFilterCondition(field, expected));
  const searchTerm = String(search || "").trim();
  if (searchTerm) filterConditions.push(Prisma.sql`data::text ILIKE ${`%${searchTerm}%`}`);
  if (legacyAttendanceAudit && entity === "AttendanceLog") {
    filterConditions.push(Prisma.sql`(
      (data ->> 'passcode_audit_action' IS NULL OR data ->> 'passcode_audit_action' = '')
      AND (
        data ->> 'notes' ILIKE '%Attendance correction%'
        OR data ->> 'notes' ILIKE '%Manual edit%'
        OR data ->> 'notes' ILIKE '%Attendance rejected by%'
        OR data ->> 'notes' ILIKE '%OT %passcodes%'
      )
    )`);
  }
  const where = Prisma.sql`entity = ${entity}${filterConditions.length
    ? Prisma.sql` AND ${Prisma.join(filterConditions, " AND ")}`
    : Prisma.empty}`;

  const requestedSort = String(sort || (entity === "AttendanceLog" ? "-updated_date" : "-occurred_at"));
  const sortField = requestedSort.replace(/^-/, "");
  const sortExpression = paginatedFieldExpression(sortField);
  const direction = requestedSort.startsWith("-") ? Prisma.sql`DESC` : Prisma.sql`ASC`;

  const [rows, countRows] = await prisma.$transaction([
    prisma.$queryRaw(Prisma.sql`
      SELECT id, entity, data, "createdAt", "updatedAt"
      FROM "EntityRecord"
      WHERE ${where}
      ORDER BY ${sortExpression} ${direction}, id ${direction}
      OFFSET ${skip}
      LIMIT ${safePageSize}
    `),
    prisma.$queryRaw(Prisma.sql`
      SELECT COUNT(*)::int AS total
      FROM "EntityRecord"
      WHERE ${where}
    `),
  ]);

  const records = rows.map(toPublicRecord);
  const total = Number(countRows[0]?.total || 0);
  const totalPages = total === 0 ? 0 : Math.ceil(total / safePageSize);
  return {
    data: fields ? records.map(record => pickFields(record, fields)) : records,
    pagination: {
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages,
      hasNextPage: safePage < totalPages,
      hasPreviousPage: safePage > 1,
    },
  };
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
