import { describe, expect, test } from 'vitest';

import { absoluteOnOrigin, decideAuthLink, safeNextPath } from './redirect';

describe('safeNextPath — only a path on this site is ever followed', () => {
  test.each([
    ['/'],
    ['/accounts'],
    ['/join?token=abc'],
    ['/auth/set-password'],
    ['/reports#top'],
  ])('%s is followed as given', (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  test.each([
    ['https://evil.example'],
    ['http://evil.example/'],
    ['//evil.example'],
    ['/' + String.fromCharCode(92) + 'evil.example'],
    ['javascript:alert(1)'],
    ['/javascript:alert(1)'],
    ['/accounts' + String.fromCharCode(13, 10) + 'Set-Cookie: x=y'],
    ['/a' + String.fromCharCode(0) + 'b'],
    ['accounts'],
    [''],
    [42],
    [null],
    [undefined],
    [['/x']],
  ])('%s falls back to the home page', (value) => {
    expect(safeNextPath(value)).toBe('/');
  });

  test('a caller may name a different fallback', () => {
    expect(safeNextPath('https://evil.example', '/login')).toBe('/login');
  });

  test('absoluteOnOrigin never leaves the origin', () => {
    expect(absoluteOnOrigin('https://finance.example.com', '//evil.example')).toBe(
      'https://finance.example.com/',
    );
    expect(absoluteOnOrigin('https://finance.example.com', '/accounts')).toBe(
      'https://finance.example.com/accounts',
    );
  });
});

describe('decideAuthLink — what an auth link asks for', () => {
  test('a PKCE code', () => {
    const decision = decideAuthLink(new URLSearchParams('code=abc123-def456&next=/accounts'));
    expect(decision).toEqual({
      kind: 'code',
      code: 'abc123-def456',
      tokenHash: null,
      type: null,
      next: '/accounts',
    });
  });

  test('a token hash with a known type', () => {
    const decision = decideAuthLink(
      new URLSearchParams(
        'token_hash=pkce_0123456789abcdef&type=invite&next=/auth/set-password',
      ),
    );
    expect(decision.kind).toBe('token_hash');
    expect(decision.type).toBe('invite');
    expect(decision.next).toBe('/auth/set-password');
  });

  test('an unknown type, a malformed token or nothing at all is "none"', () => {
    expect(decideAuthLink(new URLSearchParams('token_hash=abcdefghij&type=admin')).kind).toBe(
      'none',
    );
    expect(decideAuthLink(new URLSearchParams('token_hash=<script>&type=invite')).kind).toBe(
      'none',
    );
    expect(decideAuthLink(new URLSearchParams('code=x')).kind).toBe('none');
    expect(decideAuthLink(new URLSearchParams('')).kind).toBe('none');
  });

  test('the next target is made safe whatever the link says', () => {
    expect(
      decideAuthLink(new URLSearchParams('code=abcdefghij&next=https://evil.example')).next,
    ).toBe('/');
    expect(decideAuthLink(new URLSearchParams('next=//evil.example')).next).toBe('/');
  });
});
