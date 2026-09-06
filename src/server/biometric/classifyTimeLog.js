// @ts-nocheck

export const PROCESSING = Object.freeze({
  UNMAPPED_USER: "unmapped_user",
  MAPPED_PENDING_ATTENDANCE: "mapped_pending_attendance",
  COMPANY_NOT_AUTHORIZED: "company_not_authorized",
});

/**
 * Phase 1: one device → one company. A mapping whose company does not match
 * the device assignment is quarantined and never attached to an employee.
 */
export function assignedCompanyId(device) {
  if (device?.companyProfileId) return String(device.companyProfileId);
  const active = (device?.allowedCompanies || []).filter((link) => link.status === "active");
  if (active.length === 1) return String(active[0].companyProfileId);
  return null;
}

export function classifyTimeLog({ mapping = null, assignedCompanyId: companyId = null } = {}) {
  if (!mapping) {
    return {
      processingStatus: PROCESSING.UNMAPPED_USER,
      attachEmployee: false,
      securityEvent: false,
    };
  }

  if (!companyId || String(mapping.companyProfileId) !== String(companyId)) {
    return {
      processingStatus: PROCESSING.COMPANY_NOT_AUTHORIZED,
      attachEmployee: false,
      securityEvent: true,
    };
  }

  return {
    processingStatus: PROCESSING.MAPPED_PENDING_ATTENDANCE,
    attachEmployee: true,
    securityEvent: false,
  };
}

export function shouldAutoReprocessOnMapping(processingStatus) {
  return processingStatus === PROCESSING.UNMAPPED_USER;
}

export function canExplicitlyReprocess(processingStatus) {
  return (
    processingStatus === PROCESSING.UNMAPPED_USER
    || processingStatus === PROCESSING.COMPANY_NOT_AUTHORIZED
  );
}

export function applyReprocessDecision({
  processingStatus,
  mapping = null,
  assignedCompanyId: companyId = null,
  explicitQuarantine = false,
} = {}) {
  if (processingStatus === PROCESSING.UNMAPPED_USER) {
    return classifyTimeLog({ mapping, assignedCompanyId: companyId });
  }

  if (processingStatus === PROCESSING.COMPANY_NOT_AUTHORIZED) {
    if (!explicitQuarantine) {
      return {
        processingStatus,
        attachEmployee: false,
        securityEvent: false,
        skipped: true,
      };
    }
    return classifyTimeLog({ mapping, assignedCompanyId: companyId });
  }

  return {
    processingStatus,
    attachEmployee: false,
    securityEvent: false,
    skipped: true,
  };
}
