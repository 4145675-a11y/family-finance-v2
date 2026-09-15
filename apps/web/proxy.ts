import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { sessionCookieOptions } from './lib/auth/cookies';
import { deploymentVerdict } from './lib/config/startup';

/**
 * Two jobs, in order: refuse a misconfigured process, then keep the Supabase
 * session alive between requests.
 *
 * **Refusal.** The process decides once whether its configuration is safe
 * (`lib/config/startup.ts`, ADR-0034). While there are problems, every
 * request the proxy sees is answered 503 and nothing of the application runs;
 * the host's health check fails and the deploy is not promoted. The body names
 * no setting and no value — `/api/health`, which is outside the matcher on
 * purpose, names the settings at fault.
 *
 * **Session.** Server Components cannot write cookies, so a session whose
 * access token has expired would stay expired for them. This runs before every
 * request under the database backend, asks the auth server for the user —
 * which refreshes the token when needed — and writes the refreshed cookies
 * onto the response. It decides nothing about access. Every page and action
 * asks for the user itself; this only makes sure the answer they get is
 * current. Under the file backend it does nothing at all.
 *
 * Only the public URL and the publishable key are read here. There is no
 * secret in this file and none is reachable from it. This module runs on the
 * Node.js runtime (Next 16 proxy); it uses no Node API even so.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  if (!deploymentVerdict().ok) return refused();

  if (process.env.FAMILY_FINANCE_DATA_BACKEND !== 'supabase') {
    return NextResponse.next({ request });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (url === undefined || key === undefined || url === '' || key === '') {
    // A supabase backend without its settings is a configuration problem, and
    // the verdict above already refused it. Kept as a guard, not a path.
    return refused();
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

/**
 * What a misconfigured process says to every request. Plain text, no
 * markup, no setting names, no values; not cacheable; a hint to retry later
 * for anything automated.
 */
function refused(): NextResponse {
  return new NextResponse(
    'This deployment is not configured safely and is not serving. The settings at fault are named at /api/health.\n',
    {
      status: 503,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': '300',
      },
    },
  );
}

export const config = {
  matcher: [
    // Everything except static assets and the health endpoint, which must
    // answer without a session and without touching the auth server.
    '/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|api/health).*)',
  ],
};
