// @ts-nocheck
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { prisma } from "@/server/prisma";

const SESSION_MAX_AGE_SECONDS = 60 * 60;

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
      async authorize(credentials) {
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
          return null;
        }

        const sessionId = randomUUID();
        const sessionExpiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
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

        return {
          id: user.id,
          email: user.email,
          name: user.name || user.email,
          role: user.role,
          company_profile_id: user.companyProfileId,
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
    },
  },
};

export default NextAuth(authOptions);
