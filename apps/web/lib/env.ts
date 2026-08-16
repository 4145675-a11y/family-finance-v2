import { z } from 'zod';

/**
 * Environment validation.
 *
 * Two rules this module exists to enforce:
 *
 *  1. A missing or malformed Supabase URL fails at startup, not at the first
 *     query. A financial app that boots into a broken data connection and only
 *     discovers it mid-flow is worse than one that refuses to boot.
 *
 *  2. Only `NEXT_PUBLIC_*` values may be read here. Anything secret — the
 *     Supabase secret key, service role, database password — is read exclusively
 *     in server-only modules, never through this file, because everything this
 *     module touches can end up in the browser bundle.
 */

/** The new-style publishable key: `sb_publishable_...` (ADR-0013). */
const publishableKeySchema = z
  .string()
  .min(20)
  .refine((value) => value.startsWith('sb_publishable_'), {
    message:
      'expected a Supabase publishable key beginning with "sb_publishable_". ' +
      'A legacy anon JWT (eyJ...) requires an ADR before use, and a secret key must never appear in client configuration.',
  });

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url().refine((value) => value.startsWith('https://'), {
    message: 'the Supabase URL must be https',
  }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKeySchema,
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

/**
 * Parses the public environment.
 *
 * Values are referenced as full literals rather than through a dynamic lookup,
 * because Next inlines `process.env.NEXT_PUBLIC_*` at build time only when it
 * can see the complete expression.
 */
export function readPublicEnv(
  source: Record<string, string | undefined> = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  },
): PublicEnv {
  const result = publicEnvSchema.safeParse(source);

  if (!result.success) {
    // The message names which variable is wrong and never echoes its value: an
    // error report is one of the easiest ways for a credential to reach a log.
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Supabase environment is not usable:\n${problems}\n\n` +
        'Set these in apps/web/.env.local (git-ignored). Values are never printed.',
    );
  }

  return result.data;
}

/** Schema export so tests can exercise validation without touching process.env. */
export const publicEnvContract = publicEnvSchema;
