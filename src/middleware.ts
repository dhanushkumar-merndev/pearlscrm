import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Middleware (legacy `middleware.ts` convention, Edge runtime).
 *
 * NOTE: `@opennextjs/cloudflare` does not yet support Next.js 16 `proxy.ts`
 * (which is locked to the Node.js runtime). This file intentionally uses the
 * deprecated `middleware.ts` convention so the Cloudflare build can run it as
 * Edge middleware. Revert to `src/proxy.ts` once OpenNext supports it.
 *
 * It refreshes the Supabase session cookie and keeps unauthenticated traffic
 * out of the application shell.
 *
 * This is a convenience redirect, not the authorization boundary — every page,
 * action and route handler re-checks the session server-side, and RLS enforces
 * access in the database regardless.
 */

const PUBLIC_PATHS = [
  "/sign-in",
  "/auth/sign-out",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    // API routes must answer with JSON, never an HTML sign-in page: a `fetch`
    // follows a redirect transparently, so the caller would see `ok: true` and
    // an unparseable body instead of an auth failure. Fall through and let the
    // route handler's own `requirePermission` return a 401 envelope.
    if (!pathname.startsWith("/api/")) {
      const url = request.nextUrl.clone();
      url.pathname = "/sign-in";
      url.search = "";
      if (pathname !== "/") {
        url.searchParams.set("next", `${pathname}${search}`);
      }
      return NextResponse.redirect(url);
    }
  }

  if (user && pathname === "/sign-in") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Clinical content must never be cached by a shared/CDN cache.
  response.headers.set("Cache-Control", "no-store, must-revalidate");

  return response;
}

export const config = {
  /*
   * Everything except Next.js internals and static assets.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
