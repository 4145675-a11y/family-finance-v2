import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { sessionCookieOptions } from '../auth/cookies';
import { readDeploymentConfig } from '../config/deployment';
import { readPublicEnv } from '../env';

/**
 * Server-side Supabase client, bound to the request's cookies.
 *
 * It also uses the publishable key. That is deliberate: the session in the
 * cookie determines who the caller is, and RLS decides what that person may see.
 * Reaching for a service-role key here would bypass every policy this milestone
 * exists to enforce, and would make the server a hole in the isolation boundary
 * rather than a participant in it.
 *
 * The `server-only` import makes importing this module from a client component a
 * build error rather than a silent leak.
 */
export async function createClient() {
  const env = readPublicEnv();
  const cookieStore = await cookies();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      // Secure on https, HttpOnly always: lib/auth/cookies.ts.
      cookieOptions: sessionCookieOptions(readDeploymentConfig().appOrigin),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch (error) {
            // Server Components cannot set cookies; middleware refreshes the
            // session instead. Rethrowing anything else keeps a real failure
            // from being swallowed here.
            if (
              !(error instanceof Error) ||
              !/Cookies can only be modified/i.test(error.message)
            ) {
              throw error;
            }
          }
        },
      },
    },
  );
}
