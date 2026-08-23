import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/server/prisma";
import { isMaintenanceMode, MAINTENANCE_UNAVAILABLE_MESSAGE } from "@/server/maintenance";

const PUBLIC_PAGE_PATHS = new Set(["/", "/landing", "/maintenance"]);
const LOGIN_API_PATHS = new Set([
  "/api/auth/csrf",
  "/api/auth/callback/credentials",
  "/api/auth/signin",
  "/api/auth/signout",
  "/api/auth/maintenance-status",
]);

function unavailableApiResponse() {
  return NextResponse.json({ error: MAINTENANCE_UNAVAILABLE_MESSAGE }, { status: 503 });
}

/**
 * This proxy runs on Node.js in Next 16, so the bypass is checked against the
 * persisted AppUser row rather than the role claim in a browser cookie/JWT.
 */
export async function proxy(request) {
  if (!isMaintenanceMode()) return NextResponse.next();

  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (LOGIN_API_PATHS.has(pathname)) return NextResponse.next();
  if (!isApi && PUBLIC_PAGE_PATHS.has(pathname)) return NextResponse.next();

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
    if (user?.role === "super_admin") return NextResponse.next();
  }

  if (isApi) return unavailableApiResponse();
  return NextResponse.redirect(new URL("/maintenance", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json|icons/).*)"],
};
