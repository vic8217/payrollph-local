# Authentication Template

This document summarizes the authentication and user-access pattern used in this app. It can be reused as a template for internal business applications that need controlled registration, role-based access, password recovery, access schedules, and login/logout auditing.

## Roles

The app uses three roles.

| Role | Purpose |
| --- | --- |
| `super_admin` | Full system access. Can manage users, reset passwords, view logs, assign schedules, and access all companies. |
| `admin` | Management/Admin role. Can access business modules but not super-admin-only controls unless explicitly allowed. |
| `user` | HR Officer role. Can access HR/payroll operations based on assigned permissions and access schedule. |

## Registration

Users can register from the login page.

### Normal Registration

1. User selects `Management` or `HR Officer`.
2. Account is created with `approvalStatus: pending`.
3. Super admin must approve the account in User Management before login works.

### Super Admin Registration

1. User selects `Super Admin`.
2. User enters the `SUPER_ADMIN_RECOVERY_KEY` from `.env`.
3. If the key matches, the account is created as `super_admin` and immediately approved.
4. If the key is wrong, registration is rejected.

## Login

Login uses NextAuth Credentials Provider.

Login checks:

1. Email and password are provided.
2. User exists.
3. Password hash matches.
4. Account approval status is `approved`.
5. If not `super_admin`, user must be within the allowed access schedule.
6. Single-session rule is enforced for non-super-admin users.
7. Successful login writes a `login` row to `UserAccessLog`.

## Session Rules

Sessions use JWT strategy with a one-hour max age.

The app stores active session info on `AppUser`:

```text
activeSessionId
activeSessionExpiresAt
```

Non-super-admin users can only have one active session at a time.

Super admin can sign in without being blocked by an existing session.

## Access Schedule

Admin and HR Officer accounts can have restricted access windows.

The schedule is stored on the user as:

```text
accessSchedule Json?
```

Example:

```json
{
  "enabled": true,
  "days": [1, 2, 3, 4, 5, 6],
  "start_time": "08:00",
  "end_time": "20:00",
  "timezone": "Asia/Manila"
}
```

Rules:

- `null` or disabled means no schedule restriction.
- Days use JavaScript weekday numbers: Sunday is `0`, Monday is `1`, Saturday is `6`.
- Time is checked in `Asia/Manila`.
- Overnight windows are allowed, such as `20:00` to `02:00`.

## Password Reset

Super admin can generate a reset passcode from User Management.

The reset passcode:

- Is temporary.
- Can be used once.
- Expires in 30 minutes.
- Works for super admin, management/admin, and HR officer accounts.

Reset flow:

1. Super admin clicks `Reset Code`.
2. User opens `Forgot Password`.
3. User enters email, reset passcode, new password, and confirm password.
4. Password is updated.
5. Existing active sessions are cleared.

## Super Admin Recovery

The `.env` key is a backup recovery method:

```env
SUPER_ADMIN_RECOVERY_KEY="..."
```

It can be used to:

- Register a new super admin.
- Recover or reset a super admin password when no temporary reset code is available.

## User Management

Super admin can:

- Approve pending users.
- Deny users.
- Suspend users.
- Remove users.
- Assign role.
- Assign company access.
- Configure system access schedule.
- Generate reset passcodes.

## Users Log

The app records login/logout history in `UserAccessLog`.

Logged fields:

```text
userId
email
name
role
eventType: login/logout
sessionId
ipAddress
userAgent
occurredAt
```

Users Log page shows:

- Currently logged-in users.
- Logged-out users.
- Active session expiry.
- Recent login/logout history.

## Recommended Files To Reuse

Core files:

```text
pages/api/auth/[...nextauth].js
pages/api/auth/register.js
pages/api/auth/password-reset/confirm.js
pages/api/auth/super-admin-recovery.js
pages/api/users/index.js
pages/api/users/reset-passcode.js
pages/api/users/logs.js
src/lib/AuthContext.jsx
src/lib/accessSchedule.js
src/pages/Landing.jsx
src/pages/UserManagement.jsx
src/pages/UsersLog.jsx
```

Core Prisma models:

```prisma
model AppUser
model PasswordResetToken
model UserAccessLog
```

## Environment Variables

Minimum required variables:

```env
DATABASE_URL="postgresql://..."
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="..."
SUPER_ADMIN_RECOVERY_KEY="..."
```

## Implementation Notes

- Keep recovery keys server-side only.
- Never expose `SUPER_ADMIN_RECOVERY_KEY` to frontend code.
- Store passwords only as hashes.
- Clear active sessions after password reset.
- Treat audit logging as non-blocking so login/logout is not interrupted if logging fails.
- Restrict user management and users log pages to `super_admin`.

## Template Summary

This is a reusable auth pattern for internal business apps:

- Controlled registration.
- Super-admin recovery.
- Role-based access.
- One-session enforcement.
- Access schedules by day and time.
- Temporary reset passcodes.
- Login/logout auditing.
