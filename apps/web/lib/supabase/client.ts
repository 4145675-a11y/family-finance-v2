'use client';

import { createBrowserClient } from '@supabase/ssr';

import { readPublicEnv } from '../env';

/**
 * Browser Supabase client.
 *
 * This module is reachable from the browser bundle, so it may only ever see the
 * publishable key. Every guarantee about what this client can read or write
 * comes from Row Level Security in the database, not from anything here —
 * 07-SECURITY-PRIVACY.md: "UI אינו גבול אבטחה".
 *
 * tools/check-client-secrets.mjs fails the build if a secret or service-role key
 * is ever referenced from a client-reachable module.
 */
export function createClient() {
  const env = readPublicEnv();
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
