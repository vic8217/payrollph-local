import { applyAttendancePunch } from "./applyAttendancePunch.js";

const SLOT_LABELS = {
  time_in: "Time In (1)",
  break_time_out: "Time Out (1)",
  break_time_in: "Time In (2)",
  time_out: "Time Out (2)",
  duplicate_scan: "Duplicate scan",
};

function matchesFilter(record, filter = {}) {
  return Object.entries(filter).every(([key, value]) => record[key] === value);
}

export function createPreviewStore(seed = {}) {
  const records = {
    AttendanceLog: (seed.AttendanceLog || []).map((row) => ({ ...row })),
    Settings: [...(seed.Settings || [])],
    OvertimeRequest: [...(seed.OvertimeRequest || [])],
    PasscodeAuditLog: [],
  };
  let seq = 1;
  return {
    records,
    async listRecords(entity, { filter } = {}) {
      return (records[entity] || []).filter((record) => matchesFilter(record, filter));
    },
    async createRecord(entity, data) {
      const row = { id: `preview-${entity}-${seq++}`, ...data };
      records[entity].push(row);
      return row;
    },
    async updateRecord(entity, id, data) {
      const row = (records[entity] || []).find((record) => record.id === id);
      if (!row) return { id, ...data };
      Object.assign(row, data);
      return row;
    },
  };
}

export async function previewAttendancePunch(args, store) {
  const employee = args.employee;
  const [logs, settings, overtime] = await Promise.all([
    store.listRecords("AttendanceLog", {
      filter: {
        employee_id: employee.employee_id,
        company_profile_id: employee.company_profile_id,
      },
      sort: "-created_date",
      limit: 20,
    }),
    args.shiftSettings
      ? Promise.resolve(args.shiftSettings)
      : store.listRecords("Settings", { filter: { company_profile_id: employee.company_profile_id } }),
    args.overtimeRequests
      ? Promise.resolve(args.overtimeRequests)
      : store.listRecords("OvertimeRequest", { filter: { company_profile_id: employee.company_profile_id }, limit: 1000 }),
  ]);

  const previewStore = createPreviewStore({
    AttendanceLog: logs,
    Settings: settings,
    OvertimeRequest: overtime,
  });

  const result = await applyAttendancePunch({
    ...args,
    shiftSettings: settings,
    overtimeRequests: overtime,
  }, previewStore);

  const resolvedShift = result.resolvedShift || null;
  return {
    ...result,
    label: SLOT_LABELS[result.action] || result.action || result.code || result.outcome,
    preview: true,
    resolved_shift: resolvedShift,
    work_date: resolvedShift?.work_date || null,
    shift_name: resolvedShift?.name || null,
    shift_start_manila: resolvedShift?.shift_start_manila || null,
    shift_end_manila: resolvedShift?.shift_end_manila || null,
    break_window_manila: resolvedShift?.has_valid_break
      ? { start: resolvedShift.break_start_manila, end: resolvedShift.break_end_manila }
      : null,
    is_overnight: Boolean(resolvedShift?.is_overnight),
    punch_mode: resolvedShift?.punch_mode || null,
    scheduled_time_out: resolvedShift?.scheduled_time_out || result.log?.scheduled_time_out || null,
    scheduled_time_out_manila: resolvedShift?.scheduled_time_out_manila || null,
    time_out_is_official: Boolean(result.log?.time_out),
    expected_slot: result.action || null,
  };
}

export { SLOT_LABELS };
