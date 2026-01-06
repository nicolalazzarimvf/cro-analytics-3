import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

export const config = {
  // Require auth for all pages + API routes, except NextAuth endpoints, AI endpoints, health, and static assets.
  matcher: [
    "/((?!api/auth|api/ai/query|api/ai/graph|api/ai/ask|api/health|login|_next/static|_next/image|favicon.ico).*)"
  ]
};

export default async function middleware(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET
  });

  if (token) return NextResponse.next();

  const callbackPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const loginPath = `/login?callbackUrl=${encodeURIComponent(callbackPath)}`;

  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = request.headers.get("host") ?? forwardedHost ?? "127.0.0.1:3000";
  const proto = forwardedProto ?? "http";

  // Build an absolute URL using the request Host header to avoid switching between
  // localhost and 127.0.0.1 (which breaks the OAuth state cookie).
  const loginUrl = new URL(loginPath, `${proto}://${host}`);
  return NextResponse.redirect(loginUrl);
}
