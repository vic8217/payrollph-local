import test from "node:test";
import assert from "node:assert/strict";
import { isMaintenanceMode, MAINTENANCE_UNAVAILABLE_MESSAGE } from "../src/server/maintenance.js";

test("maintenance mode is enabled only by the literal true value", () => {
  const prior = process.env.PAYROLLPH_MAINTENANCE_MODE;
  try {
    for (const value of [undefined, "", "TRUE", "1", "false"]) {
      if (value === undefined) delete process.env.PAYROLLPH_MAINTENANCE_MODE;
      else process.env.PAYROLLPH_MAINTENANCE_MODE = value;
      assert.equal(isMaintenanceMode(), false);
    }
    process.env.PAYROLLPH_MAINTENANCE_MODE = "true";
    assert.equal(isMaintenanceMode(), true);
    assert.equal(MAINTENANCE_UNAVAILABLE_MESSAGE, "PayrollPH is temporarily unavailable.");
  } finally {
    if (prior === undefined) delete process.env.PAYROLLPH_MAINTENANCE_MODE;
    else process.env.PAYROLLPH_MAINTENANCE_MODE = prior;
  }
});
