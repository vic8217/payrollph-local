// @ts-nocheck
import NextAuthImport from "next-auth";
import CredentialsImport from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { prisma } from "@/server/prisma";
import { isWithinAccessSchedule } from "@/lib/accessSchedule";
import { isMaintenanceMode } from "@/server/maintenance";

/** Webpack + CJS interop: default export may be nested as `{ default: fn }`. */
function unwrapDefault(m) {
  let cur = m;
  for (let i = 0; i < 3 && cur != null && typeof cur !== "function"; i += 1) {
    cur = cur?.default;
  }
  return typeof cur === "function" ? cur : m;
}

const NextAuth = unwrapDefault(NextAuthImport);
const CredentialsProvider = unwrapDefault(CredentialsImport);

const SESSION_MAX_AGE_SECONDS = 60 * 60;
export const SESSION_IDLE_TIMEOUT_SECONDS = 5 * 60;

function parseCompanyProfileIds(value) {
  return String(value || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

async function createAccessLog(user, eventType, req, sessionId = null) {
  try {
    await prisma.userAccessLog.create({
      data: {
        userId: user.id,
        email: user.email,
        name: user.name || null,
        role: user.role,
        eventType,
        sessionId,
        ipAddress:
          req?.headers?.["x-forwarded-for"]?.split(",")?.[0]?.trim() ||
          req?.socket?.remoteAddress ||
          null,
        userAgent: req?.headers?.["user-agent"] || null,
      },
    });
  } catch {
    // Access logging should not block authentication.
  }
}

export const authOptions = {
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        const email = credentials?.email?.toLowerCase().trim();
        const password = credentials?.password;

        if (!email || !password) {
          return null;
        }

        const user = await prisma.appUser.findUnique({ where: { email } });
        if (!user?.passwordHash) {
          return null;
        }
        if (user.approvalStatus !== "approved") {
          return null;
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
          await createAccessLog(user, "login_failed", req);
          return null;
        }
        // Check the database record before a session is created. This prevents a
        // non-super-admin from obtaining a usable session during maintenance.
        if (isMaintenanceMode() && user.role !== "super_admin") {
          throw new Error("MAINTENANCE_MODE");
        }
        if (user.role !== "super_admin" && !isWithinAccessSchedule(user.accessSchedule)) {
          throw new Error("ACCESS_SCHEDULE_BLOCKED");
        }

        const sessionId = randomUUID();
        // JWTs may live for the configured maximum age, but their persisted
        // active-session record expires after five idle minutes.
        const sessionExpiresAt = new Date(Date.now() + SESSION_IDLE_TIMEOUT_SECONDS * 1000);
        const activeSession =
          user.role === "super_admin"
            ? await prisma.appUser.updateMany({
                where: { id: user.id },
                data: {
                  activeSessionId: sessionId,
                  activeSessionExpiresAt: sessionExpiresAt,
                },
              })
            : await prisma.appUser.updateMany({
                where: {
                  id: user.id,
                  OR: [
                    { activeSessionId: null },
                    { activeSessionExpiresAt: null },
                    { activeSessionExpiresAt: { lt: new Date() } },
                  ],
                },
                data: {
                  activeSessionId: sessionId,
                  activeSessionExpiresAt: sessionExpiresAt,
                },
              });

        if (activeSession.count === 0) {
          throw new Error("ACCOUNT_ALREADY_ACTIVE");
        }

        await createAccessLog(user, "login", req, sessionId);

        return {
          id: user.id,
          email: user.email,
          name: user.name || user.email,
          role: user.role,
          company_profile_id: parseCompanyProfileIds(user.companyProfileId)[0] || null,
          company_profile_ids: parseCompanyProfileIds(user.companyProfileId),
          active_session_id: sessionId,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.company_profile_id = user.company_profile_id;
        token.company_profile_ids = user.company_profile_ids || [];
        token.active_session_id = user.active_session_id;
      }

      if (token.sub && token.active_session_id) {
        const activeUser = await prisma.appUser.findFirst({
          where: {
            id: token.sub,
            activeSessionId: token.active_session_id,
            activeSessionExpiresAt: { gt: new Date() },
          },
          select: { id: true },
        });

        token.active_session_valid = Boolean(activeUser);
        if (activeUser) {
          const scheduleUser = await prisma.appUser.findUnique({
            where: { id: token.sub },
            select: { role: true, accessSchedule: true, companyProfileId: true },
          });
          token.active_session_valid =
            scheduleUser?.role === "super_admin" ||
            isWithinAccessSchedule(scheduleUser?.accessSchedule);
          if (isMaintenanceMode() && scheduleUser?.role !== "super_admin") {
            token.active_session_valid = false;
          }
          token.role = scheduleUser?.role || token.role || "user";
          const companyProfileIds = parseCompanyProfileIds(scheduleUser?.companyProfileId);
          token.company_profile_id = companyProfileIds[0] || null;
          token.company_profile_ids = companyProfileIds;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (!token.active_session_valid) {
        return null;
      }

      if (session.user) {
        session.user.id = token.sub;
        session.user.role = token.role || "user";
        session.user.company_profile_id = token.company_profile_id || null;
        session.user.company_profile_ids = token.company_profile_ids || [];
        session.user.active_session_id = token.active_session_id || null;
      }
      return session;
    },
  },
  events: {
    async signOut({ token }) {
      if (!token?.sub || !token?.active_session_id) {
        return;
      }

      await prisma.appUser.updateMany({
        where: {
          id: token.sub,
          activeSessionId: token.active_session_id,
        },
        data: {
          activeSessionId: null,
          activeSessionExpiresAt: null,
        },
      });

      try {
        await prisma.userAccessLog.create({
          data: {
            userId: token.sub,
            email: token.email || "",
            name: token.name || null,
            role: token.role || "user",
            eventType: "logout",
            sessionId: token.active_session_id,
          },
        });
      } catch {
        // Access logging should not block sign out cleanup.
      }
    },
  },
};

export default NextAuth(authOptions);
