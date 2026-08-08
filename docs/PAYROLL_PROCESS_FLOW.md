# Payroll Process Flow

## Audience

This guide is for Payroll Officers and Admin Managers who prepare, verify, approve, regenerate, and release payroll in PayrollPH.

## Roles and responsibilities

### Payroll Officer

- Reviews attendance completeness and correctness.
- Confirms attendance records are approved.
- Reviews overtime requests and coordinates missing corrections.
- Verifies day types, work hours, late time, undertime, night differential, and approved overtime.
- Generates payroll and completes payroll reconciliation.
- Reports variances to the Admin Manager before release.

### Admin Manager

- Provides final approval for overtime and other protected adjustments when required.
- Reviews payroll totals, reconciliation results, deductions, and exceptions.
- Changes a completed payroll period from **Processing** to **Approved** when it is ready for final regeneration or release.
- Releases payroll to employees only after final verification.

> Approval and release are different actions. **Approved** payroll can still be regenerated. **Released** payroll is final and cannot be regenerated.

## End-to-end process

```text
Attendance capture
      ↓
Attendance review and approval
      ↓
OT request review and approval
      ↓
Cash advance and deduction review
      ↓
Payroll generation
      ↓
Payroll reconciliation
      ↓
Resolve variances
      ↓
Approve period
      ↓
Final regeneration, if required
      ↓
Final reconciliation and management review
      ↓
Release to employees
```

## 1. Prepare attendance

The Payroll Officer must review every employee and date covered by the payroll period.

Check the following:

- Time In, break punches, and final Time Out are complete.
- Attendance status is **Approved**.
- Shift and day type are correct.
- Cross-midnight Time Out is assigned to the correct work date.
- Late and undertime values are reasonable.
- Night differential hours match work performed during the configured night window.
- Employees with no attendance are correctly recorded as absent, on leave, rest day, holiday, or no record.

Payroll generation can be blocked by pending attendance, incomplete punches, or unresolved overtime requests.

## 2. Review overtime

An OT request must be approved before it can be credited to payroll.

1. Open **Attendance** and locate the employee's OT request.
2. Confirm that the final Time Out exists and supports the requested OT.
3. Correct the Time Out first if authorized and necessary.
4. Enter the approved OT hours.
5. Complete the required HR Officer and Admin confirmation.
6. Approve or deny the request.

The system credits the lower of:

- actual OT supported by attendance; or
- approved OT hours.

Example:

| Date | Requested | Approved | Credited |
|---|---:|---:|---:|
| Aug 4 | 10.00 h | 9.67 h | 9.67 h |
| Aug 5 | 6.00 h | 5.33 h | 5.33 h |
| **Period total** | **16.00 h** | **15.00 h** | **15.00 h** |

Requested hours are not automatically payable. Payroll uses approved credited hours.

## 3. Review deductions and cash advances

Before generation, verify:

- SSS, PhilHealth, Pag-IBIG, and withholding-tax settings.
- Cash advances with an outstanding balance.
- Scheduled cash-advance deductions for the period.
- Beginning balances and manual adjustments.
- Any authorized suspension of a cash-advance deduction.

Use **Cash Advance → Check Deductions** to identify inconsistencies. The cash-advance ledger balance should agree with the cash-advance record before payroll is finalized.

## 4. Generate payroll

1. Open **Payroll**.
2. Select the intended payroll period.
3. Review the mandatory-deduction status.
4. Click **Generate [period]** at the top of the page.
5. Complete the generation review confirmation.
6. Resolve any blocking attendance or OT messages, then generate again.

Generation computes and stores the payroll record, including:

- regular days and basic pay;
- approved OT hours and OT pay;
- night differential hours and pay;
- holiday and rest-day pay;
- incentives and adjustments;
- government deductions;
- cash-advance deductions;
- gross pay, total deductions, and net pay.

### OT pay

OT pay is computed during payroll generation:

```text
Approved credited OT hours × hourly rate × applicable OT multiplier
```

Approving an OT request after payroll was generated does not automatically rewrite the existing payroll record. The period must be regenerated.

### Night differential

Night differential is automatically computed from attendance punches within the configured night window:

```text
Night differential hours × hourly rate × applicable ND percentage/multiplier
```

## 5. Reconcile payroll

1. Open **Payroll → Payroll Recon**.
2. Select the payroll period and employee.
3. Compare the **System**, **Manual**, and **Difference** rows.
4. Review each date under **Daily Attendance Inputs**.
5. Enter or verify the manual calculation.
6. Add a variance note for any unresolved difference.
7. Click **Save Reconciliation**.

Review at minimum:

- regular days and rate;
- basic pay;
- OT hours and OT pay;
- night differential hours and pay;
- government and cash-advance deductions;
- gross and net pay;
- daily attendance punches and computed hours.

If reconciliation detects approved OT that is missing from the generated payroll, it displays the approved OT hours and warns that the payroll must be regenerated to update OT Pay and the final payroll record.

## 6. Resolve variances

| Variance | Action |
|---|---|
| Approved OT hours appear but OT Pay is zero | Regenerate payroll. |
| Requested and approved OT differ | Use approved hours; no correction is needed unless approval was entered incorrectly. |
| Attendance OT and reconciliation OT differ | Confirm the approved request, final Time Out, and attendance log; regenerate after correction. |
| Night differential appears incorrect | Verify punches, shift configuration, day type, and the night window. |
| Cash-advance balance is incorrect | Review the ledger, original established date, deductions, and authorized adjustments. |
| Manual and system totals differ | Correct the source record or document the accepted variance before release. |

## 7. Approve and regenerate when necessary

For a payroll period already marked **Processing – Not Released**, the current system requires approval before regenerating a completed period.

1. Confirm all attendance and OT approvals are complete.
2. Click **Approve** on the payroll-period card.
3. The period changes to **Approved**, but is not yet released.
4. Scroll to the top of Payroll.
5. Click **Generate [period]** to regenerate using the latest approved data.
6. Reopen Payroll Reconciliation and verify the new totals.

Do not release the period merely to enable regeneration.

## 8. Final Admin Manager review

Before release, the Admin Manager should confirm:

- All employees expected in the period have payroll records.
- Attendance and OT approvals are complete.
- Approved OT hours and OT Pay agree.
- Night differential is reasonable.
- Mandatory and cash-advance deductions are correct.
- Gross, deductions, and net totals are reasonable.
- Reconciliation variances are zero or adequately explained.
- Any regeneration required after late changes has been completed.

## 9. Release payroll

Release only after the final reconciliation is complete.

1. Select the **Approved** payroll period.
2. Perform the final management review.
3. Click **Release**.
4. Confirm that the status changes to **Released**.

After release, payroll is visible to employees and cannot be regenerated through the normal workflow. Corrections should therefore be completed before release.

## Change-control rules

- Never use requested OT as payable OT unless it was approved for the same amount.
- Never release payroll with unresolved blocking errors.
- Never create a financial adjustment solely to correct an established date; use the date-only correction option.
- Every manual correction must include a clear reason and the required authorization.
- Regenerate and reconcile again after any change affecting pay.

## Quick checklist

### Payroll Officer

- [ ] Attendance punches complete
- [ ] Attendance approved
- [ ] OT requests resolved
- [ ] Day types and shifts verified
- [ ] Deductions and cash advances reviewed
- [ ] Payroll generated
- [ ] Reconciliation saved
- [ ] Variances corrected or documented
- [ ] Final regeneration completed after changes

### Admin Manager

- [ ] OT and protected adjustments authorized
- [ ] Payroll totals reviewed
- [ ] Reconciliation reviewed
- [ ] Period approved
- [ ] Regenerated payroll rechecked, if applicable
- [ ] Payroll released only after final verification
