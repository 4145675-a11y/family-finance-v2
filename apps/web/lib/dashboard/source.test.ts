import { describe, expect, test } from 'vitest';

import { DEV_DATA_FLAG, loadDashboardSource, resolveDataSource } from './source';

/**
 * The gate that decides whether invented numbers may reach a screen.
 *
 * These are the tests that matter most in this milestone. Everything else is a
 * layout question; this is the difference between a demo and a lie.
 */

describe('resolveDataSource — production is closed, unconditionally', () => {
  test('a production build refuses the fixture even with the flag on', () => {
    const source = resolveDataSource({ nodeEnv: 'production', flag: 'on' });
    expect(source.kind).toBe('none');
  });

  test('the refusal explains itself rather than failing silently', () => {
    const source = resolveDataSource({ nodeEnv: 'production', flag: 'on' });
    expect(source.reason).toContain('ייצור');
  });

  test('production is checked before the flag, so no flag value can open it', () => {
    for (const flag of ['on', 'ON', 'true', '1', 'yes', undefined]) {
      expect(resolveDataSource({ nodeEnv: 'production', flag }).kind).toBe('none');
    }
  });
});

describe('resolveDataSource — off by default outside production', () => {
  test('no flag means no data source', () => {
    expect(resolveDataSource({ nodeEnv: 'development', flag: undefined }).kind).toBe('none');
  });

  test('an empty flag means no data source', () => {
    expect(resolveDataSource({ nodeEnv: 'development', flag: '' }).kind).toBe('none');
  });

  test('only the exact literal switches it on', () => {
    for (const flag of ['ON', 'On', 'true', '1', 'yes', 'enabled', ' on', 'on ']) {
      expect(resolveDataSource({ nodeEnv: 'development', flag }).kind).toBe('none');
    }
  });

  test('the off state names the variable, so the reader can act on it', () => {
    const source = resolveDataSource({ nodeEnv: 'development', flag: undefined });
    expect(source.reason).toContain(DEV_DATA_FLAG);
  });
});

describe('resolveDataSource — the one case that opens', () => {
  test('development plus the exact flag gives the fixture', () => {
    const source = resolveDataSource({ nodeEnv: 'development', flag: 'on' });
    expect(source.kind).toBe('development_fixture');
  });

  test('test environments may use it too', () => {
    expect(resolveDataSource({ nodeEnv: 'test', flag: 'on' }).kind).toBe('development_fixture');
  });

  test('it is never labelled as real data', () => {
    const source = resolveDataSource({ nodeEnv: 'development', flag: 'on' });
    expect(source.isRealData).toBe(false);
    expect(source.label).toContain('הדגמה');
  });

  test('it says plainly that the figures are not the household’s money', () => {
    expect(resolveDataSource({ nodeEnv: 'development', flag: 'on' }).reason).toContain(
      'אינם הכספים שלכם',
    );
  });
});

describe('loadDashboardSource', () => {
  test('returns no input at all when the gate is closed', async () => {
    const source = await loadDashboardSource({ nodeEnv: 'production', flag: 'on' });
    expect(source.input).toBeNull();
  });

  test('returns no input when the flag is off', async () => {
    const source = await loadDashboardSource({ nodeEnv: 'development', flag: undefined });
    expect(source.input).toBeNull();
  });

  test('returns a usable engine input when the gate is open', async () => {
    const source = await loadDashboardSource({ nodeEnv: 'development', flag: 'on' });
    expect(source.input).not.toBeNull();
    expect(source.input?.currency).toBe('ILS');
    expect(source.input?.accounts.length).toBeGreaterThan(0);
    expect(source.input?.debts.length).toBeGreaterThan(0);
  });

  test('the descriptor always travels with the data, so a screen can label it', async () => {
    const source = await loadDashboardSource({ nodeEnv: 'development', flag: 'on' });
    expect(source.descriptor.isRealData).toBe(false);
  });
});
