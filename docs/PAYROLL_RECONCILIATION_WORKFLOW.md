# Payroll Reconciliation UI workflow

The reconciliation screen presents the existing reconciliation data through a four-step review workflow:

1. **Reconcile** – select the payroll period, use the KPI queue, review System / Manual / Variance values, enter manual punches, and save Admin/HR variance notes.
2. **Submit for Review** – becomes available only when every employee is reconciled and each material variance has an Admin/HR note. Submission is recorded on the existing reconciliation records.
3. **Resolve Variance** – becomes available after submission when reviewer notes need an Admin/HR response. Existing Reviewer Notes, response, resolve, reopen, and audit history are reused.
4. **Final Review** – becomes available only after all reviewer notes are resolved. Completion is recorded on the existing reconciliation records.

The upper Reconcile view contains one authoritative summary row: Total Employees, Reconciled, Pending, With Variance, System Net Payroll, and Review Status. Payroll period and employee selectors sit below the stepper with a client-side Refresh action. Pending, With Variance, and Review Status are keyboard-accessible cards that apply the corresponding queue filter. No duplicate KPI row is rendered.

The Pending and With Variance KPI cards open drilldown summaries. Each summary can select an employee and move to the relevant step, or filter the queue to the matching employees. The queue remains the source of the existing employee and reconciliation data.

This redesign does not modify payroll, attendance, manual payroll, variance, or calculation rules. The stepper adds workflow metadata only (`submitted_for_review_*` and `final_reviewed_*`) to existing reconciliation records; it requires no Prisma schema change or migration. The stepper, cards, filters, and layout do not alter computed values.

## Management Notes

Management Notes are intended to carry instructions or observations from Management to the Admin/HR Officer. They are distinct from the existing Admin/HR Variance Note, Resolution Reason, and audited Reviewer Notes, and must never affect payroll, attendance, manual payroll, reconciliation, or variance computations.

The current Prisma schema provides `PayrollReconciliationReviewerNote` and its event history for reviewer questions, responses, and resolutions. That model is intentionally not reused for Management Notes because doing so would change the meaning, permissions, and audit semantics of reviewer notes. The UI therefore shows a distinct Management Notes section with an honest empty state, but persistent add/history actions are blocked pending approval of a separate data model.

Required future persistence change (not implemented): a tenant-scoped management-note table linked to company, payroll period, employee, and optionally reconciliation, with note text, author user/role, created/updated timestamps, and an audit event/API endpoint with server-side company and role authorization. No Prisma schema or migration was changed for this request.

## Daily Admin/HR Variance Notes

`PayrollReconciliationDailyVarianceNote` stores one Admin/HR explanation per company, payroll period, employee, and attendance date. A unique constraint prevents duplicate notes for the same date. In Daily Attendance Inputs, a non-zero existing daily variance displays **Note Required** until the authorized Admin/HR user saves an explanation; reviewers can read the saved note. These date-level notes are separate from Reviewer Notes, Resolution Reason, and the employee-level Admin/HR Variance Note. They do not affect attendance, payroll, reconciliation, or variance computations.
