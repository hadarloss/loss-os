import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";

// Native HTTP Basic Auth prompts are unreliable across mobile browsers/in-app
// webviews (some never show a credential UI at all), so auth is a real login
// page + signed session cookie instead — works identically everywhere.
const PUBLIC_PATHS = ["/login", "/signup", "/api/auth/login", "/api/auth/signup"];

export function proxy(request: NextRequest) {
  if (!process.env.SESSION_SECRET) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (verifySessionToken(token)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api")) {
    return NextResponse.json({ error: "נדרשת התחברות מחדש." }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
