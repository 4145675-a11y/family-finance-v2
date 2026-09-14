import { describe, expect, test } from 'vitest';

import { publicEnvContract, readPublicEnv } from './env';

const validUrl = 'https://abcdefghijklmnop.supabase.co';
const validKey = 'sb_publishable_AbCdEfGhIjKlMnOpQrSt';

describe('public environment validation', () => {
  test('accepts a publishable key and https URL', () => {
    const env = readPublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: validUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: validKey,
    });
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(validUrl);
  });

  test('rejects a missing key', () => {
    expect(() =>
      readPublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: validUrl,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
      }),
    ).toThrow(/Supabase environment is not usable/);
  });

  test('rejects a non-https URL', () => {
    expect(() =>
      readPublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'http://insecure.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: validKey,
      }),
    ).toThrow(/https/);
  });

  test('rejects a legacy anon JWT, which requires an ADR', () => {
    const legacyAnonJwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlLXBsYWNlaG9sZGVy';
    expect(() =>
      readPublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: validUrl,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: legacyAnonJwt,
      }),
    ).toThrow(/sb_publishable_/);
  });

  test('rejects a secret key placed in client configuration', () => {
    expect(() =>
      readPublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: validUrl,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_ThisMustNeverBeAccepted',
      }),
    ).toThrow(/sb_publishable_/);
  });

  test('the error names the variable but never echoes its value', () => {
    const secret = 'sb_secret_SuperSensitiveValue123456';
    try {
      readPublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: validUrl,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secret,
      });
      throw new Error('expected validation to fail');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
      expect(message, 'a rejected credential must not be echoed back').not.toContain(secret);
    }
  });

  test('the contract is exported for reuse without touching process.env', () => {
    const result = publicEnvContract.safeParse({
      NEXT_PUBLIC_SUPABASE_URL: validUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: validKey,
    });
    expect(result.success).toBe(true);
  });
});
