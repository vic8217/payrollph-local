export const MAINTENANCE_UNAVAILABLE_MESSAGE = "PayrollPH is temporarily unavailable.";

/** Maintenance is deliberately opt-in: only the literal string `true` enables it. */
export function isMaintenanceMode() {
  return process.env.PAYROLLPH_MAINTENANCE_MODE === "true";
}

export function sendMaintenanceUnavailable(res) {
  return res.status(503).json({ error: MAINTENANCE_UNAVAILABLE_MESSAGE });
}
