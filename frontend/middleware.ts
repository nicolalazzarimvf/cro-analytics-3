import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

export const config = {
  // Middleware disabled to avoid blocking routes while we debug 404s.
  matcher: []
};

export default async function middleware(request: NextRequest) {
  return NextResponse.next();
}
