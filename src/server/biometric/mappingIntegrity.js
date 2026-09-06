export const MAPPING_CODES = Object.freeze({
  EMPLOYEE_RECORD_NOT_FOUND: "EMPLOYEE_RECORD_NOT_FOUND",
  EMPLOYEE_RECORD_ID_MISMATCH: "EMPLOYEE_RECORD_ID_MISMATCH",
  EMPLOYEE_COMPANY_MISMATCH: "EMPLOYEE_COMPANY_MISMATCH",
  EMPLOYEE_INACTIVE: "EMPLOYEE_INACTIVE",
  DEVICE_COMPANY_MISMATCH: "DEVICE_COMPANY_MISMATCH",
});

export function normalizeEmployeeCode(value) {
  return String(value || "").trim().toLowerCase();
}

export function employeeAcceptedCodes(employee) {
  const primary = String(employee?.employee_id || "").trim();
  const aliases = Array.isArray(employee?.employee_id_aliases)
    ? employee.employee_id_aliases.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  return {
    primary,
    aliases,
    allNormalized: [primary, ...aliases].map(normalizeEmployeeCode).filter(Boolean),
  };
}

export function employeeMatchesDeclaredCode(employee, declaredEmployeeId) {
  const normalized = normalizeEmployeeCode(declaredEmployeeId);
  if (!normalized) return false;
  return employeeAcceptedCodes(employee).allNormalized.includes(normalized);
}

export function findEmployeeByRecordId(employees, employeeRecordId) {
  const id = String(employeeRecordId || "").trim();
  if (!id) return null;
  return (employees || []).find((item) => String(item.id) === id) || null;
}

export function findEmployeeByCode(employees, declaredEmployeeId, companyProfileId = null) {
  return (employees || []).find((item) => {
    if (!employeeMatchesDeclaredCode(item, declaredEmployeeId)) return false;
    if (companyProfileId && String(item.company_profile_id) !== String(companyProfileId)) return false;
    return true;
  }) || null;
}

export function validateMappingIdentity({
  employees = [],
  declaredEmployeeId = "",
  declaredEmployeeRecordId = "",
  companyProfileId,
  deviceCompanyId,
} = {}) {
  if (!companyProfileId || !deviceCompanyId || String(companyProfileId) !== String(deviceCompanyId)) {
    return {
      ok: false,
      code: MAPPING_CODES.DEVICE_COMPANY_MISMATCH,
      error: "Mapping company does not match the biometric device company.",
    };
  }

  const recordId = String(declaredEmployeeRecordId || "").trim();
  const declaredCode = String(declaredEmployeeId || "").trim();

  if (recordId) {
    const byId = findEmployeeByRecordId(employees, recordId);
    if (!byId) {
      return {
        ok: false,
        code: MAPPING_CODES.EMPLOYEE_RECORD_NOT_FOUND,
        error: "Employee record id does not exist. A matching employee code is not enough.",
      };
    }
    if (String(byId.company_profile_id) !== String(companyProfileId)) {
      return {
        ok: false,
        code: MAPPING_CODES.EMPLOYEE_COMPANY_MISMATCH,
        error: "Employee does not belong to the biometric device company.",
      };
    }
    if (String(byId.status || "active").toLowerCase() !== "active") {
      return {
        ok: false,
        code: MAPPING_CODES.EMPLOYEE_INACTIVE,
        error: "Employee is not active.",
      };
    }
    if (declaredCode && !employeeMatchesDeclaredCode(byId, declaredCode)) {
      return {
        ok: false,
        code: MAPPING_CODES.EMPLOYEE_RECORD_ID_MISMATCH,
        error: "Employee record id does not match the declared employee code or aliases.",
      };
    }
    return { ok: true, employee: byId, code: null };
  }

  if (!declaredCode) {
    return {
      ok: false,
      code: MAPPING_CODES.EMPLOYEE_RECORD_NOT_FOUND,
      error: "employee_id is required.",
    };
  }

  const sameCompany = findEmployeeByCode(employees, declaredCode, companyProfileId);
  if (sameCompany) {
    if (String(sameCompany.status || "active").toLowerCase() !== "active") {
      return {
        ok: false,
        code: MAPPING_CODES.EMPLOYEE_INACTIVE,
        error: "Employee is not active.",
      };
    }
    return { ok: true, employee: sameCompany, code: null };
  }

  const otherCompany = findEmployeeByCode(employees, declaredCode);
  if (otherCompany) {
    return {
      ok: false,
      code: MAPPING_CODES.EMPLOYEE_COMPANY_MISMATCH,
      error: "Employee does not belong to the biometric device company.",
    };
  }

  return {
    ok: false,
    code: MAPPING_CODES.EMPLOYEE_RECORD_NOT_FOUND,
    error: `Employee "${declaredCode}" was not found.`,
  };
}

export function inspectMappingIntegrity(mapping, employees, deviceCompanyId) {
  const result = validateMappingIdentity({
    employees,
    declaredEmployeeId: mapping.employeeId || mapping.employee_id,
    declaredEmployeeRecordId: mapping.employeeRecordId || mapping.employee_record_id,
    companyProfileId: mapping.companyProfileId || mapping.company_profile_id,
    deviceCompanyId,
  });
  return {
    stale: !result.ok,
    code: result.code || null,
    error: result.error || null,
    resolvedEmployee: result.employee || null,
  };
}

export function resolveRepairEmployee(mapping, employees, deviceCompanyId) {
  return validateMappingIdentity({
    employees,
    declaredEmployeeId: mapping.employeeId || mapping.employee_id,
    declaredEmployeeRecordId: "",
    companyProfileId: mapping.companyProfileId || mapping.company_profile_id,
    deviceCompanyId,
  });
}

export function planMappingRepair(mapping, employees, deviceCompanyId) {
  const resolved = resolveRepairEmployee(mapping, employees, deviceCompanyId);
  if (!resolved.ok) return resolved;
  const previousEmployeeRecordId = mapping.employeeRecordId || mapping.employee_record_id || null;
  return {
    ok: true,
    employee: resolved.employee,
    events_requeued: false,
    update: {
      employeeRecordId: resolved.employee.id,
      employeeId: resolved.employee.employee_id,
    },
    audit: {
      eventType: "mapping_corrected",
      reasonCode: MAPPING_CODES.EMPLOYEE_RECORD_ID_MISMATCH,
      details: {
        device_user_id: mapping.deviceUserId || mapping.device_user_id,
        employee_id: resolved.employee.employee_id,
        previousEmployeeRecordId,
        employeeRecordId: resolved.employee.id,
        events_requeued: false,
      },
    },
  };
}
