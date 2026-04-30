export const MASTER_CASH_ADVANCE_AGREEMENT_VERSION = '2026-04-30';
export const CASH_ADVANCE_PAYMENT_DAYS = 30;

export const buildCashAdvanceAgreementText = ({
  companyName = 'Employer',
  employeeName = 'Employee',
  employeeId = '',
  paymentDays = CASH_ADVANCE_PAYMENT_DAYS,
} = {}) => `MASTER CASH ADVANCE AGREEMENT

(For PayrollPH System Use - Philippines)

1. PARTIES

This Master Cash Advance Agreement ("Agreement") is entered into between:

Employer: ${companyName}
Employee: ${employeeName}
Employee ID: ${employeeId}

2. PURPOSE

This Agreement governs all cash advances requested and received by the Employee through the PayrollPH system.

Each approved request shall constitute a valid acknowledgment of debt under this Agreement.

3. REQUEST AND APPROVAL

The Employee may request cash advances via PayrollPH.
The Employer has full discretion to approve or reject any request.
Approved requests shall be recorded with a unique reference number.

4. MODE OF RELEASE

The Employee agrees that all approved cash advances shall be:

Deposited to the Employee's registered bank/e-wallet account
Based on the details provided in PayrollPH

The Employee acknowledges that bank transfer records constitute proof of receipt of the cash advance.

5. EMPLOYEE AUTHORIZATION

By submitting a request in PayrollPH, the Employee:

Confirms the amount requested
Acknowledges receipt upon deposit
Agrees that the amount is a personal financial obligation

6. PAYROLL DEDUCTION AUTHORITY

The Employee voluntarily authorizes the Employer to deduct from salary:

Based on the selected repayment period in the system
Automatically computed and applied every payroll

The Employee agrees that:

Deductions will continue until full settlement
Adjustments may be made to ensure full repayment

7. FINAL PAY AUTHORIZATION

In case of resignation, termination, or abandonment:

The Employee authorizes the Employer to deduct any remaining unpaid balance from final pay, including:

Salary
13th month pay (pro-rated)
Leave conversions
Any other monetary benefits

8. REMAINING BALANCE

If final pay is insufficient:

The remaining balance shall remain a personal obligation of the Employee.

The Employee agrees to settle the balance within ${paymentDays} days from notice.

9. LEGAL REMEDIES

Failure to settle any unpaid balance authorizes the Employer to:

Issue formal demand
Initiate legal action for collection

Pursuant to applicable procedures under the Supreme Court of the Philippines

10. COMPLIANCE WITH LABOR LAWS

This Agreement is executed in accordance with regulations of the Department of Labor and Employment.

All deductions are made with voluntary and informed consent of the Employee.

11. DIGITAL CONSENT AND VALIDITY

The Employee agrees that:

Acceptance of this Agreement within PayrollPH
Submission of each cash advance request
System logs, timestamps, and approvals

shall constitute valid electronic consent and legally binding agreement.

12. NO WAIVER

Failure of the Employer to enforce any provision shall not constitute a waiver of rights.

13. EFFECTIVITY

This Agreement shall remain valid for the duration of employment unless revoked or replaced in writing.

14. ENTIRE AGREEMENT

This Agreement constitutes the entire understanding regarding cash advances.`;

export const buildCashAdvanceAgreementTagalogText = ({
  companyName = 'Employer',
  employeeName = 'Employee',
  employeeId = '',
  paymentDays = CASH_ADVANCE_PAYMENT_DAYS,
} = {}) => `MASTER CASH ADVANCE AGREEMENT

(Para sa Paggamit ng PayrollPH System - Pilipinas)

1. MGA PARTIDO

Ang Master Cash Advance Agreement na ito ("Kasunduan") ay pinapasok ng:

Employer: ${companyName}
Empleyado: ${employeeName}
Employee ID: ${employeeId}

2. LAYUNIN

Saklaw ng Kasunduang ito ang lahat ng cash advance na hinihiling at natatanggap ng Empleyado sa pamamagitan ng PayrollPH system.

Ang bawat aprubadong kahilingan ay ituturing na wastong pagkilala ng utang sa ilalim ng Kasunduang ito.

3. KAHILINGAN AT PAG-APRUBA

Maaaring humiling ang Empleyado ng cash advance sa pamamagitan ng PayrollPH.
May ganap na pagpapasya ang Employer na aprubahan o tanggihan ang anumang kahilingan.
Ang mga aprubadong kahilingan ay itatala gamit ang natatanging reference number.

4. PARAAN NG PAGLABAS NG PERA

Sumasang-ayon ang Empleyado na ang lahat ng aprubadong cash advance ay:

Idedeposito sa rehistradong bank/e-wallet account ng Empleyado
Batay sa mga detalyeng ibinigay sa PayrollPH

Kinikilala ng Empleyado na ang mga tala ng bank transfer ay magsisilbing patunay ng pagtanggap ng cash advance.

5. PAHINTULOT NG EMPLEYADO

Sa pagsusumite ng kahilingan sa PayrollPH, ang Empleyado ay:

Kumukumpirma sa halagang hinihiling
Kinikilala ang pagtanggap kapag nadeposito na
Sumasang-ayon na ang halaga ay personal na obligasyong pinansyal

6. PAHINTULOT SA PAGKALTAS SA PAYROLL

Kusang-loob na pinahihintulutan ng Empleyado ang Employer na magkaltas mula sa sahod:

Batay sa piniling repayment period sa system
Awtomatikong kakalkulahin at ilalapat sa bawat payroll

Sumasang-ayon ang Empleyado na:

Magpapatuloy ang mga kaltas hanggang sa ganap na mabayaran
Maaaring gumawa ng mga adjustment upang masiguro ang buong pagbabayad

7. PAHINTULOT SA FINAL PAY

Sa kaso ng resignation, termination, o abandonment:

Pinahihintulutan ng Empleyado ang Employer na ikaltas ang anumang natitirang hindi pa nababayarang balanse mula sa final pay, kabilang ang:

Sahod
13th month pay (pro-rated)
Leave conversions
Anumang iba pang monetary benefits

8. NATITIRANG BALANSE

Kung hindi sapat ang final pay:

Ang natitirang balanse ay mananatiling personal na obligasyon ng Empleyado.

Sumasang-ayon ang Empleyado na bayaran ang balanse sa loob ng ${paymentDays} araw mula sa abiso.

9. LEGAL NA REMEDYO

Ang hindi pagbabayad ng anumang natitirang balanse ay nagbibigay pahintulot sa Employer na:

Magpadala ng pormal na demand
Magsimula ng legal na aksyon para sa paniningil

Alinsunod sa naaangkop na mga pamamaraan sa ilalim ng Supreme Court of the Philippines

10. PAGSUNOD SA BATAS SA PAGGAWA

Ang Kasunduang ito ay ginawa alinsunod sa mga regulasyon ng Department of Labor and Employment.

Ang lahat ng kaltas ay ginagawa nang may kusang-loob at malinaw na pahintulot ng Empleyado.

11. DIGITAL NA PAHINTULOT AT BISA

Sumasang-ayon ang Empleyado na ang:

Pagtanggap sa Kasunduang ito sa loob ng PayrollPH
Pagsusumite ng bawat cash advance request
System logs, timestamps, at approvals

ay magsisilbing wastong electronic consent at legal na may bisang kasunduan.

12. WALANG WAIVER

Ang hindi pagpapatupad ng Employer sa anumang probisyon ay hindi nangangahulugan ng pagtalikod sa mga karapatan.

13. PAGKAKABISA

Ang Kasunduang ito ay mananatiling may bisa habang empleyado pa, maliban kung ito ay bawiin o palitan sa pamamagitan ng kasulatan.

14. BUONG KASUNDUAN

Ang Kasunduang ito ang bumubuo sa buong pag-unawa tungkol sa cash advances.`;
