import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/server/prisma";
import { isMaintenanceMode, MAINTENANCE_UNAVAILABLE_MESSAGE } from "@/server/maintenance";
import { hasPermission, permissionForPath } from "@/lib/permissions";

const PUBLIC_PAGE_PATHS = new Set(["/", "/landing", "/maintenance"]);
const LOGIN_API_PATHS = new Set([
  "/api/auth/csrf",
  "/api/auth/callback/credentials",
  "/api/auth/signin",
  "/api/auth/signout",
  "/api/auth/maintenance-status",
]);
const DEVICE_API_PREFIX = "/api/device/";

function unavailableApiResponse() {
  return NextResponse.json({ error: MAINTENANCE_UNAVAILABLE_MESSAGE }, { status: 503 });
}

/**
 * This proxy runs on Node.js in Next 16, so the bypass is checked against the
 * persisted AppUser row rather than the role claim in a browser cookie/JWT.
 *
 * Biometric device ingress is intentionally allowed through maintenance mode.
 * These endpoints use device registration/login credentials rather than a
 * browser NextAuth session, and attendance hardware must be able to reconnect
 * and replay locally buffered logs while the interactive application is under
 * maintenance.
 */
export async function proxy(request) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (
    pathname.startsWith(DEVICE_API_PREFIX) ||
    LOGIN_API_PATHS.has(pathname) ||
    (!isApi && PUBLIC_PAGE_PATHS.has(pathname))
  ) {
    return NextResponse.next();
  }

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (token?.sub && token.active_session_id) {
    const user = await prisma.appUser.findFirst({
      where: {
        id: token.sub,
        activeSessionId: token.active_session_id,
        activeSessionExpiresAt: { gt: new Date() },
      },
      select: { role: true },
    });
    if (isMaintenanceMode() && user?.role === "super_admin") return NextResponse.next();
    if (!isMaintenanceMode() && !isApi) {
      const permission = permissionForPath(pathname);
      if (!permission || hasPermission(user?.role, permission)) return NextResponse.next();
      return NextResponse.redirect(new URL("/landing", request.url));
    }
    if (!isMaintenanceMode() && isApi && user?.role === "attendance_staff") {
      const allowedFunctionApis = new Set([
        "/api/functions/reviewTimeInAdjustment",
        "/api/functions/changeEmployeeWorkSchedule",
      ]);
      if (pathname.startsWith("/api/functions/") && !allowedFunctionApis.has(pathname)) {
        return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      }
      if (pathname.startsWith("/api/users") || pathname.startsWith("/api/payroll-") || pathname.startsWith("/api/benefits")) {
        return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      }
      return NextResponse.next();
    }
  }
  if (isMaintenanceMode()) return isApi ? unavailableApiResponse() : NextResponse.redirect(new URL("/maintenance", request.url));
  if (isApi) return NextResponse.next();
  return NextResponse.redirect(new URL("/landing", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json|icons/).*)"],
};
