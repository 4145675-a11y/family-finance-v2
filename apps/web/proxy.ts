import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { sessionCookieOptions } from './lib/auth/cookies';

/**
 * Keeps the Supabase session alive between requests.
 *
 * Server Components cannot write cookies, so a session whose access token has
 * expired would stay expired for them. This runs before every request under
 * the database backend, asks the auth server for the user — which refreshes
 * the token when needed — and writes the refreshed cookies onto the response.
 *
 * It decides nothing about access. Every page and action asks for the user
 * itself; this only makes sure the answer they get is current. Under the file
 * backend it does nothing at all.
 *
 * Only the public URL and the publishable key are read here. There is no
 * secret in this file and none is reachable from it.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  if (process.env.FAMILY_FINANCE_DATA_BACKEND !== 'supabase') {
    return NextResponse.next({ request });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (url === undefined || key === undefined || url === '' || key === '') {
    // Misconfigured: instrumentation refuses to start such a process, so this
    // is unreachable in practice — and if it were reached, nothing is served.
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookieOptions: sessionCookieOptions(process.env.FAMILY_FINANCE_APP_ORIGIN),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Not the result — the side effect: a refreshed token lands in the cookies.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and the health endpoint, which must
    // answer without a session and without touching the auth server.
    '/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|api/health).*)',
  ],
};
