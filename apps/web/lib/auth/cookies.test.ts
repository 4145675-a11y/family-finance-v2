import { describe, expect, test } from 'vitest';

import { sessionCookieOptions } from './cookies';

describe('session cookies (PROD-COOKIE-001)', () => {
  test('are Secure, HttpOnly and Lax on an https origin', () => {
    expect(sessionCookieOptions('https://finance.example.com')).toEqual({
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
      secure: true,
    });
  });

  test('drop Secure only for http://localhost, and keep everything else', () => {
    expect(sessionCookieOptions('http://localhost:3100')).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
    });
  });

  test('with no origin known, err on the side of Secure', () => {
    expect(sessionCookieOptions(undefined).secure).toBe(true);
    expect(sessionCookieOptions('').secure).toBe(true);
  });
});
