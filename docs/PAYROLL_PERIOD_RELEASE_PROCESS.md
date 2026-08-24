# Payroll period release and generation process

This document describes the workflow enforced by PayrollPH when preparing a new payroll period.

## Rule enforced by the Payroll page

When the selected period has not yet been generated, PayrollPH requires the immediately preceding configured payroll period to be **released** before the selected period can be generated. This prevents a newer payroll from being produced while the prior period is still awaiting final review or employee release.

The rule applies per company and uses the company's configured payroll schedule. It is evaluated from the selected company's payroll periods, not from another company in the account.

### Super-admin exception

A `super_admin` may override this block when the previous period is intentionally blank or incomplete and a current-period payroll must be prepared immediately. The override is not available to other roles. It requires an explicit confirmation in the generation dialog and warns that the prior period must still be corrected, generated, reconciled, and released later. This exception should be used only for a documented business need; it does not bypass the normal attendance, overtime, deduction, or generation validations for the current period.

## Status flow

1. **Not generated** – no payroll period record exists for the configured date range.
2. **Processing** – payroll generation created the period and records; review is still in progress.
3. **Approved** – payroll passed internal review and is ready for release.
4. **Released** – payroll is finalized and released to employees. This is the required status before generating the next new period.

The period summary may also show **Complete** or **Incomplete**. That describes whether generation produced employee records/totals; it is separate from the workflow status. A Complete period is not necessarily released.

## Operational procedure

### 1. Select the company and period

Confirm the correct company in the company selector. Select the current payroll period. Verify the displayed start and end dates and the previous period named in the warning, if shown.

### 2. Complete attendance and approvals

Before generation, review attendance for the period. Resolve incomplete punches and approve or reject pending attendance and overtime items. Generation is also blocked when required attendance data is incomplete or still pending.

### 3. Generate the previous period

If the previous period is **Not generated**, select that period and generate it first. Review the generated employee records, deductions, cash advances, overtime, undertime, and net pay.

### 4. Reconcile and approve

Open **Payroll Recon** for the generated period. Resolve pending employee reconciliations, unresolved variances, and reviewer remarks. The period cannot be finalized while any of these readiness items remain outstanding.

### 5. Release the previous period

After reconciliation, choose **Approve**, then choose **Release**. The server validates release readiness again; changing the status directly through the UI or API cannot bypass this validation. Released payroll records and deductions are treated as final and cannot be edited through normal workflows.

### 6. Generate the current period

Return to the current period. The warning should disappear and **Generate** should become available. Review the mandatory-deduction confirmation, then generate the current period. A period that already exists may be regenerated when it is not released, subject to the normal attendance and review checks.

## When generation remains blocked

The warning remains when the previous period is missing, not generated, processing, or approved but not released. Other generation blockers include incomplete required punches, pending attendance approvals, pending overtime approvals, or an already released target period. Correct the prerequisite period first rather than creating a second overlapping period.

## Release readiness checks

The server checks reconciliation readiness before accepting a `PayrollPeriod` status change to `released`. It rejects the release if there are pending reconciliations, unresolved variances, reviewer remarks requiring a response, or reviewer responses awaiting confirmation. The error includes the outstanding counts so the reviewer can correct the specific issue.

## Roles and auditability

Payroll generation, approval, and release remain subject to the signed-in user's role and company access. Release actions should be performed by the authorized payroll/admin officer. Payroll period status changes and reconciliation actions are stored with the relevant record timestamps and reviewer information.

## Quick verification checklist

- Correct company selected
- Previous period date range matches the warning
- Previous period generation status is **Complete**
- Previous period workflow status is **Released**
- No pending attendance or overtime approvals
- No unresolved reconciliation variances or reviewer remarks
- Current period is not already released
- Mandatory deductions reviewed before generation
- If using the super-admin exception, business reason recorded and follow-up correction assigned
