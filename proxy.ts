import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";

/**
 * Next 16 renamed Middleware to Proxy. Runs on the Node.js runtime.
 *
 * Two jobs, both cheap:
 *   1. Refresh the Supabase session cookie so long-lived tabs stay
 *      signed in.
 *   2. An *optimistic* redirect to /login for unauthenticated requests,
 *      purely to avoid rendering a shell that will bounce anyway.
 *
 * This is NOT the authorization boundary. Role checks live in
 * `lib/auth/dal.ts` and run on every page and Server Action.
 */

/** Routes reachable without a session. */
const PUBLIC_PATHS = ["/login", "/auth"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Validated rather than `!`-asserted: the Proxy runs on every
  // request, so a missing variable throws before any page renders
  // and the platform reports a bare 500. The named error says which.
  const supabase = createServerClient(
    supabaseUrl(),
    supabasePublishableKey(),
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

  // Refreshes the auth token as a side effect. Do not remove, and do not
  // add code between this and the response return — anything that runs
  // in between risks the refreshed cookie not being written back.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Bounce back to the intended page after signing in.
    if (pathname !== "/") {
      url.searchParams.set("next", pathname);
    }
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals and static assets:
     * _next/static, _next/image, favicon, and common image extensions.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
