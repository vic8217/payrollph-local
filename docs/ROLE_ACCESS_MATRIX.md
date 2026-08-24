# PayrollPH role access matrix

Stored roles are strings: `super_admin`, `admin`, legacy `user`, `hr_staff`, and `attendance_staff`. No Prisma enum is used, so no database migration is required. Legacy `user` remains an HR-level role for compatibility.

| Group / module | Super admin | Admin | HR staff / legacy user | Attendance staff |
| --- | --- | --- | --- | --- |
| Overview (Dashboard, Management Reports) | Yes | No | No | No |
| People & Attendance | Yes | Yes | Yes | Attendance, Time In Reviews, Work Schedule, Personal Leave, Holidays, No-Work Days only |
| Payroll / Compliance | Yes | Yes | No | No |
| Security & Access | Yes | Limited user management / passcode audit | Payslip receipts | No |
| Settings / Employee Portal | Yes | Company operational settings / portal | No | No |

`super_admin` has the system boundary and remains the only role allowed during maintenance mode. `admin` is explicitly denied Overview routes. `attendance_staff` is restricted both by route checks and the entity API permission map; it cannot request payroll, employee, user, or financial entities.

To add a role safely, add the canonical value to `ROLE_PERMISSIONS`, associate every route with a permission in `ROUTE_PERMISSIONS`, add entity/API checks, then expose the role only in authorized User Management controls.
