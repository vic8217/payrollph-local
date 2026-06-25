export function employeeRequestMatchesLog(request, log, employee = null) {
  if (!request || !log) return false;
  if (request.company_profile_id && log.company_profile_id && request.company_profile_id !== log.company_profile_id) {
    return false;
  }
  if (request.date !== log.date) return false;

  const requestRecordId = String(request.employee_record_id || '');
  const logRecordId = String(log.employee_record_id || employee?.id || '');
  const requestEmployeeId = String(request.employee_id || '').trim().toLowerCase();
  const logEmployeeId = String(log.employee_id || employee?.employee_id || '').trim().toLowerCase();

  return Boolean(
    (requestRecordId && logRecordId && requestRecordId === logRecordId) ||
    (requestEmployeeId && logEmployeeId && requestEmployeeId === logEmployeeId)
  );
}

export function approvedOvertimeRequestForLog(log, requests = [], employee = null) {
  return requests
    .filter(request =>
      request.status === 'approved' &&
      employeeRequestMatchesLog(request, log, employee)
    )
    .sort((a, b) => String(b.reviewed_at || b.updated_date || b.created_date || '').localeCompare(String(a.reviewed_at || a.updated_date || a.created_date || '')))[0] || null;
}

export function capOvertimeByApprovedRequest(actualHours, request) {
  const actual = Math.max(0, Number(actualHours) || 0);
  const approved = Math.max(0, Number(request?.approved_hours ?? request?.requested_hours) || 0);
  return Number(Math.min(actual, approved).toFixed(2));
}

export function overtimeStatusForComputedHours(actualHours, cappedHours, request) {
  if (!request) return null;
  if ((Number(actualHours) || 0) <= 0) return null;
  return request.status === 'approved' ? 'approved' : request.status;
}
