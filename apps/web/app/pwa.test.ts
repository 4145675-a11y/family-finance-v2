import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import manifest from './manifest';

/**
 * The installable shell, and the rule it must not break.
 *
 * A service worker is a cache that answers before the server does. In a financial
 * application that is a loaded gun: a balance served from a cache is a number that
 * was true once, presented as if it were true now — which is the exact thing
 * 02-FINANCIAL-RULES.md § אינווריאנטים forbids as a basis for a decision.
 *
 * So these tests are mostly about what the worker refuses to do. They read the
 * worker's source rather than executing it, because the alternative is a fake
 * service-worker environment, and a rule proved against a simulation of the
 * browser is a rule proved against the simulation.
 */

const WEB_ROOT = fileURLToPath(new URL('../', import.meta.url));
const worker = readFileSync(join(WEB_ROOT, 'public', 'service-worker.js'), 'utf8');

describe('the manifest', () => {
  const built = manifest();

  test('declares Hebrew, right to left', () => {
    expect(built.lang).toBe('he');
    expect(built.dir).toBe('rtl');
  });

  test('opens on the home screen, scoped to the whole application', () => {
    expect(built.start_url).toBe('/');
    expect(built.scope).toBe('/');
    expect(built.display).toBe('standalone');
  });

  test('carries an icon, including a maskable one', () => {
    expect(built.icons?.length).toBeGreaterThanOrEqual(2);
    expect(built.icons?.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  test('its colours come from the design tokens rather than being invented', () => {
    expect(built.theme_color).toBe('#1e4f73');
    expect(built.background_color).toBe('#faf7f2');
  });

  test('says where the data lives, because that is the question an install raises', () => {
    expect(built.description).toContain('המכשיר הזה');
  });

  test('its shortcuts point at screens that exist', () => {
    expect(built.shortcuts?.map((shortcut) => shortcut.url)).toEqual([
      '/entry',
      '/upload',
      '/approvals',
    ]);
  });

  test('it promises nothing it cannot do', () => {
    const text = JSON.stringify(built);
    // No share target and no file handler: both would advertise an entry point
    // this build does not implement.
    expect(text).not.toContain('share_target');
    expect(text).not.toContain('file_handlers');
    expect(text).not.toContain('protocol_handlers');
  });
});

describe('the icons are drawn, not photographed', () => {
  test.each(['icon.svg', 'icon-maskable.svg'])('%s is an svg with a label', (name) => {
    const svg = readFileSync(join(WEB_ROOT, 'public', name), 'utf8');
    expect(svg).toContain('<svg');
    expect(svg).toContain('aria-label');
    expect(svg).toContain('viewBox="0 0 512 512"');
  });

  test('they use the brand colour rather than a fresh one', () => {
    for (const name of ['icon.svg', 'icon-maskable.svg']) {
      expect(readFileSync(join(WEB_ROOT, 'public', name), 'utf8')).toContain('#1e4f73');
    }
  });
});

describe('the service worker never serves a stale financial page', () => {
  test('a navigation always goes to the network first', () => {
    expect(worker).toMatch(/request\.mode === 'navigate'/);
    // The network is attempted, and the cache is only the catch.
    expect(worker).toMatch(/fetch\(request\)\.catch\(/);
  });

  test('when the network fails it serves the offline page, not a cached screen', () => {
    expect(worker).toContain('OFFLINE_URL');
    expect(worker).toMatch(/caches\.match\(OFFLINE_URL\)/);
  });

  test('it never caches an export, which is generated from current data', () => {
    expect(worker).toMatch(/url\.pathname\.startsWith\('\/api\/'\)/);
  });

  test('it never touches a write', () => {
    expect(worker).toMatch(/request\.method !== 'GET'/);
  });

  test('what it does cache is only the shell', () => {
    expect(worker).toMatch(/_next\/static\//);
    expect(worker).toContain('/icon.svg');
    expect(worker).toContain('/manifest.webmanifest');
  });

  test('it claims no capability that needs a server', () => {
    // Background sync and push both require somewhere to sync to and somewhere to
    // push from. Registering a listener that quietly does nothing is a claim.
    expect(worker).not.toContain("addEventListener('push'");
    expect(worker).not.toContain("addEventListener('sync'");
    expect(worker).not.toContain('periodicsync');
  });

  test('an old cache is cleared when the version changes', () => {
    expect(worker).toContain('CACHE_VERSION');
    expect(worker).toMatch(/caches\.delete\(key\)/);
  });
});

describe('registration is careful about where it runs', () => {
  const registration = readFileSync(
    join(WEB_ROOT, 'components', 'service-worker-registration.tsx'),
    'utf8',
  );

  test('it checks for support and for a secure context', () => {
    expect(registration).toContain("'serviceWorker' in navigator");
    expect(registration).toContain('window.isSecureContext');
  });

  test('a failure is survivable, because the application works without it', () => {
    expect(registration).toContain('.catch(');
  });
});
