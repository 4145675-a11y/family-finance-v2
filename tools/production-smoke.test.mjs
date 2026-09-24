import { describe, expect, test } from 'vitest';

import { DEFAULT_ORIGIN, resolveOrigin } from './production-smoke.mjs';

/**
 * Which origin the smoke check aims at.
 *
 * One line of logic, and it broke the workflow on its first triggered run. A
 * GitHub `inputs` expression is an **empty string** on every event that carries no
 * inputs, so `??` took that empty string over the default and the check failed
 * with `the origin must be https, got`. The fix is one predicate; this is here so
 * that predicate cannot quietly come back.
 */

describe('resolveOrigin', () => {
  test('falls back to the deployed service when nothing is given', () => {
    expect(resolveOrigin(undefined, undefined)).toBe(DEFAULT_ORIGIN);
  });

  test('treats an empty environment value as absent — the workflow case', () => {
    expect(resolveOrigin(undefined, '')).toBe(DEFAULT_ORIGIN);
  });

  test('treats whitespace as absent too', () => {
    expect(resolveOrigin(undefined, '   ')).toBe(DEFAULT_ORIGIN);
    expect(resolveOrigin('  ', undefined)).toBe(DEFAULT_ORIGIN);
  });

  test('an argument wins over the environment', () => {
    expect(resolveOrigin('https://one.example', 'https://two.example')).toBe(
      'https://one.example',
    );
  });

  test('the environment is used when there is no argument', () => {
    expect(resolveOrigin(undefined, 'https://two.example')).toBe('https://two.example');
  });

  test('a trailing slash is dropped, so no path becomes a double slash', () => {
    expect(resolveOrigin('https://one.example/', undefined)).toBe('https://one.example');
  });

  test('the default is the https production origin', () => {
    // Not a localhost default: a smoke check that silently aimed at a developer's
    // machine would report a green that says nothing about the deployment.
    expect(DEFAULT_ORIGIN.startsWith('https://')).toBe(true);
  });
});
