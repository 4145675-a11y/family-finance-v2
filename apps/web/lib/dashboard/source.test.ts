import { describe, expect, test } from 'vitest';

import { DEV_DATA_FLAG, loadDashboardSource, resolveDataSource } from './source';

/**
 * The gate that decides whether invented numbers may reach a screen.
 *
 * These are the tests that matter most about this module. Everything else is a
 * layout question; this is the difference between a demo and a lie.
 *
 * There are three answers now, and the ordering between them is the substance:
 * the household's own store beats the fixture, the fixture is off unless a
 * development build asks for it exactly, and production is closed regardless.
 */

const facts = (
  overrides: Partial<Parameters<typeof resolveDataSource>[0]> = {},
): Parameters<typeof resolveDataSource>[0] => ({
  nodeEnv: 'development',
  flag: undefined,
  hasLocalStore: false,
  ...overrides,
});

describe('the household’s own data always wins', () => {
  test('a real store beats the fixture flag', () => {
    const source = resolveDataSource(facts({ flag: 'on', hasLocalStore: true }));
    expect(source.kind).toBe('local_store');
    expect(source.isRealData).toBe(true);
  });

  test('a real store works in production, which is the point of it', () => {
    const source = resolveDataSource(facts({ nodeEnv: 'production', hasLocalStore: true }));
    expect(source.kind).toBe('local_store');
  });

  test('it says where the numbers came from and where they live', () => {
    const source = resolveDataSource(facts({ hasLocalStore: true }));
    expect(source.reason).toContain('אישרתם');
    expect(source.reason).toContain('המחשב הזה');
  });
});

describe('production is closed to invented data, unconditionally', () => {
  test('a production build refuses the fixture even with the flag on', () => {
    expect(resolveDataSource(facts({ nodeEnv: 'production', flag: 'on' })).kind).toBe('none');
  });

  test('production is checked before the flag, so no flag value can open it', () => {
    for (const flag of ['on', 'ON', 'true', '1', 'yes', undefined]) {
      expect(resolveDataSource(facts({ nodeEnv: 'production', flag })).kind).toBe('none');
    }
  });
});

describe('the fixture is off by default outside production', () => {
  test('no flag means no data source', () => {
    expect(resolveDataSource(facts()).kind).toBe('none');
  });

  test('an empty flag means no data source', () => {
    expect(resolveDataSource(facts({ flag: '' })).kind).toBe('none');
  });

  test('only the exact literal switches it on', () => {
    for (const flag of ['ON', 'On', 'true', '1', 'yes', 'enabled', ' on', 'on ']) {
      expect(resolveDataSource(facts({ flag })).kind).toBe('none');
    }
  });

  test('the empty state invites setup rather than naming a variable at the family', () => {
    const source = resolveDataSource(facts());
    expect(source.reason).toContain('הגדרה');
    expect(source.reason).not.toContain(DEV_DATA_FLAG);
  });
});

describe('the one case that opens the fixture', () => {
  test('development plus the exact flag gives the fixture', () => {
    expect(resolveDataSource(facts({ flag: 'on' })).kind).toBe('development_fixture');
  });

  test('test environments may use it too', () => {
    expect(resolveDataSource(facts({ nodeEnv: 'test', flag: 'on' })).kind).toBe(
      'development_fixture',
    );
  });

  test('it is never labelled as real data', () => {
    const source = resolveDataSource(facts({ flag: 'on' }));
    expect(source.isRealData).toBe(false);
    expect(source.label).toContain('הדגמה');
  });

  test('it says plainly that the figures are not the household’s money', () => {
    expect(resolveDataSource(facts({ flag: 'on' })).reason).toContain('אינם הכספים שלכם');
  });
});

describe('loadDashboardSource', () => {
  test('returns no input at all when the gate is closed', async () => {
    const source = await loadDashboardSource(facts({ nodeEnv: 'production', flag: 'on' }));
    expect(source.input).toBeNull();
  });

  test('returns no input when the flag is off', async () => {
    expect((await loadDashboardSource(facts())).input).toBeNull();
  });

  test('returns no fixture input when a real store is present', async () => {
    // The real data is loaded by the store, not by this module: what matters here
    // is that the fixture is not loaded alongside it.
    const source = await loadDashboardSource(facts({ flag: 'on', hasLocalStore: true }));
    expect(source.input).toBeNull();
    expect(source.descriptor.kind).toBe('local_store');
  });

  test('returns a usable engine input when the gate is open', async () => {
    const source = await loadDashboardSource(facts({ flag: 'on' }));
    expect(source.input).not.toBeNull();
    expect(source.input?.currency).toBe('ILS');
    expect(source.input?.accounts.length).toBeGreaterThan(0);
    expect(source.input?.debts.length).toBeGreaterThan(0);
  });

  test('the descriptor always travels with the data, so a screen can label it', async () => {
    const source = await loadDashboardSource(facts({ flag: 'on' }));
    expect(source.descriptor.isRealData).toBe(false);
  });
});
