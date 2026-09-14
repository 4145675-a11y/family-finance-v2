/**
 * The production path, end to end, against the real database — without a
 * public deployment and without real family data (ADR-0032; Phase 8 of the
 * Production Data Layer).
 *
 * What runs here is what production runs: the built application in
 * production mode with the database backend, Supabase Auth over the network,
 * supabase-js through PostgREST as the signed-in person, and the pages as the
 * browser would receive them. Only the origin is local.
 *
 * Identities and data are synthetic and created by this file; everything it
 * creates is removed in `afterAll`, in one narrow transaction, and the
 * database is counted clean afterwards. The synthetic passwords are generated
 * here, used here, and never printed.
 *
 * Not run by `npm run integration` — it needs a completed build and commits
 * through PostgREST (nothing here can be rolled back). `npm run validate:production-path`.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { buildCsv, extractDocument } from '@family-finance/document-import';
import {
  SupabaseHouseholdStore,
  SupabaseHouseholdTransport,
} from '@family-finance/household-store';
import {
  addAccount,
  addCheck,
  addDebt,
  addTask,
  approveBatch,
  clearCheck,
  deliverChecks,
  recordTransaction,
  reviewAll,
  setBudgetLine,
  setRepaymentPlan,
  stageExtraction,
  startBudget,
  updateTask,
} from '@family-finance/local-store';
import { createServerClient } from '@supabase/ssr';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

// @ts-expect-error — a plain ESM helper shared with the gates; no types.
import { nextEnv, resolveNextBin } from '../../tools/next.mjs';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WEB_ROOT = join(REPO_ROOT, 'apps', 'web');
const HOST = '127.0.0.1';
const PORT = 3133;
/** Where the pages are fetched from. */
const ORIGIN = `http://${HOST}:${PORT}`;
/** What the deployment declares as its origin: `localhost` is the one http origin the config treats as secure. */
const APP_ORIGIN = `http://localhost:${PORT}`;

const DB_URL = process.env.SUPABASE_DB_URL;
if (!DB_URL) throw new Error('SUPABASE_DB_URL is required (see supabase/tests/load-env.ts)');

/** Public settings from the app's env file, by name. Values never leave this process. */
function publicSetting(name: string): string {
  const fromEnv = process.env[name];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  const file = join(WEB_ROOT, '.env.local');
  if (!existsSync(file))
    throw new Error(`${name} is not set and apps/web/.env.local is absent`);
  for (const raw of readFileSync(file, 'utf8')
    .replace(/^\ufeff/, '')
    .split(/\r?\n/)) {
    const line = raw.trim();
    const separator = line.indexOf('=');
    if (separator <= 0 || line.slice(0, separator).trim() !== name) continue;
    return line.slice(separator + 1).trim();
  }
  throw new Error(`${name} is not set in the environment or apps/web/.env.local`);
}

const SUPABASE_URL = publicSetting('NEXT_PUBLIC_SUPABASE_URL');
const PUBLISHABLE_KEY = publicSetting('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');

interface SyntheticPerson {
  readonly id: string;
  readonly email: string;
  /** Generated here, used here, never printed. */
  readonly password: string;
}

/** A session as the browser would hold it: the cookies @supabase/ssr writes. */
interface Session {
  readonly person: SyntheticPerson;
  readonly cookieHeader: string;
  readonly client: ReturnType<typeof createServerClient>;
}

function synthetic(name: string): SyntheticPerson {
  return {
    id: randomUUID(),
    email: `${name}-${randomUUID()}@example.test`,
    password: `Synthetic-${randomBytes(18).toString('base64url')}`,
  };
}

const people = { alice: synthetic('alice'), bob: synthetic('bob'), carol: synthetic('carol') };
const created = { households: [] as string[] };

let owner: Client;
let server: ChildProcess | null = null;
let serverOutput = '';

async function provision(person: SyntheticPerson): Promise<void> {
  // The shape Supabase's own seeds use: a confirmed email user with a bcrypt
  // password and its email identity. The password leaves this process only as
  // its hash.
  await owner.query(
    `insert into auth.users
       (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token,
        recovery_token, email_change_token_new, email_change)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2,
             extensions.crypt($3, extensions.gen_salt('bf')), now(),
             '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
             '', '', '', '')`,
    [person.id, person.email, person.password],
  );
  await owner.query(
    `insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
     values (gen_random_uuid(), $1, $2, jsonb_build_object('sub', $2::text, 'email', $3::text, 'email_verified', true),
             'email', now(), now(), now())`,
    [person.id, person.id, person.email],
  );
}

/** Signs in through Supabase Auth exactly as the login action does, keeping the cookies in memory. */
async function signIn(person: SyntheticPerson): Promise<Session> {
  const jar = new Map<string, string>();
  const client = createServerClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value === '') jar.delete(name);
          else jar.set(name, value);
        }
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({
    email: person.email,
    password: person.password,
  });
  if (error) throw new Error(`sign-in failed for a synthetic user: status ${error.status}`);
  const cookieHeader = [...jar.entries()].map(([n, v]) => `${n}=${v}`).join('; ');
  return { person, cookieHeader, client };
}

function storeFor(session: Session): SupabaseHouseholdStore {
  return new SupabaseHouseholdStore(
    new SupabaseHouseholdTransport(session.client, session.person.id),
    session.person.id,
    null,
  );
}

async function page(
  path: string,
  session?: Session,
): Promise<{ status: number; html: string; location: string | null }> {
  const response = await fetch(`${ORIGIN}${path}`, {
    redirect: 'manual',
    headers: session ? { cookie: session.cookieHeader } : {},
    signal: AbortSignal.timeout(20_000),
  });
  return {
    status: response.status,
    html: await response.text(),
    location: response.headers.get('location'),
  };
}

async function startServer(): Promise<void> {
  server = spawn(
    process.execPath,
    [resolveNextBin(), 'start', '--hostname', HOST, '--port', String(PORT)],
    {
      cwd: WEB_ROOT,
      env: {
        ...nextEnv(),
        NODE_ENV: 'production',
        FAMILY_FINANCE_DATA_BACKEND: 'supabase',
        FAMILY_FINANCE_APP_ORIGIN: APP_ORIGIN,
        NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
        NEXT_PUBLIC_DEV_DATA_SOURCE: '',
        PORT: String(PORT),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  server.stdout?.on('data', (chunk) => {
    serverOutput += String(chunk);
  });
  server.stderr?.on('data', (chunk) => {
    serverOutput += String(chunk);
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${ORIGIN}/api/health`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (response.status > 0) return;
    } catch {
      await delay(400);
    }
  }
  // Diagnostics only: the server's first lines, with anything that looks like
  // a key or the project URL removed before it reaches a test report.
  const redacted = serverOutput
    .split('\n')
    .filter((line) => !line.includes(SUPABASE_URL) && !line.includes('sb_'))
    .slice(0, 12)
    .join('\n');
  throw new Error(`the production server did not start:\n${redacted}`);
}

beforeAll(async () => {
  if (!existsSync(join(WEB_ROOT, '.next'))) throw new Error('run `npm run build` first');
  owner = new Client({ connectionString: DB_URL });
  await owner.connect();
  for (const person of Object.values(people)) await provision(person);
  await startServer();
}, 120_000);

afterAll(async () => {
  if (server !== null) {
    server.kill('SIGTERM');
    await delay(600);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  await cleanup();
  await owner.end();
}, 120_000);

/**
 * Removes exactly what this run created, in one transaction.
 *
 * The audit guards are paused for the duration of that transaction only —
 * the append-only trail is what makes these rows undeletable — and are
 * re-enabled and proven live before the commit. Every delete is scoped to the
 * synthetic households and people by id.
 */
async function cleanup(): Promise<void> {
  const ids = Object.values(people).map((p) => p.id);
  const households = [...created.households];
  await owner.query('begin');
  try {
    // Anything else the synthetic people own, found by membership rather than assumed.
    const { rows } = await owner.query<{ household_id: string }>(
      'select distinct household_id from public.household_members where profile_id = any($1)',
      [ids],
    );
    for (const row of rows)
      if (!households.includes(row.household_id)) households.push(row.household_id);

    await owner.query(
      'alter table public.audit_events disable trigger audit_events_block_delete',
    );
    await owner.query(
      'alter table public.audit_events disable trigger audit_events_block_update',
    );
    if (households.length > 0) {
      await owner.query('delete from public.audit_events where household_id = any($1)', [
        households,
      ]);
      // Every household-scoped table cascades from households; person-scoped ones from profiles.
      await owner.query('delete from public.households where id = any($1)', [households]);
    }
    await owner.query('delete from public.profiles where id = any($1)', [ids]);
    await owner.query('delete from auth.identities where user_id = any($1)', [ids]);
    await owner.query('delete from auth.users where id = any($1)', [ids]);
    await owner.query(
      'alter table public.audit_events enable trigger audit_events_block_update',
    );
    await owner.query(
      'alter table public.audit_events enable trigger audit_events_block_delete',
    );

    const { rows: guards } = await owner.query<{ n: number }>(
      `select count(*)::int as n from pg_trigger
       where tgrelid = 'public.audit_events'::regclass and not tgisinternal and tgenabled = 'O'`,
    );
    if (guards[0]?.n !== 2) throw new Error('audit guards are not both enabled');
    await owner.query('savepoint guard');
    let live = false;
    try {
      await owner.query('delete from public.audit_events where false');
    } catch (error) {
      live = (error as { code?: string }).code === '42501';
    }
    await owner.query('rollback to savepoint guard');
    if (!live) throw new Error('the append-only guard did not fire');

    await owner.query('commit');
  } catch (error) {
    await owner.query('rollback').catch(() => undefined);
    throw error;
  }
}

const NOW = () => new Date().toISOString();

describe('the production path', () => {
  let alice: Session;
  let bob: Session;
  let carol: Session;
  let householdA = '';
  let accountA = '';

  test('health: the server is up, configured for the database, and ready', async () => {
    const { status, html } = await page('/api/health');
    expect(status).toBe(200);
    const report = JSON.parse(html) as {
      status: string;
      backend: string;
      data: Record<string, string>;
    };
    expect(report.status).toBe('ok');
    expect(report.backend).toBe('supabase');
    expect(report.data).toMatchObject({
      configuration: 'present',
      database: 'reachable',
      schema: 'compatible',
      authenticatedDataSource: 'available',
      readiness: 'ready',
    });
    expect(html).not.toContain(SUPABASE_URL);
  });

  test('without a session every screen is the sign-in screen', async () => {
    for (const path of ['/', '/accounts', '/setup', '/account', '/backup', '/reports']) {
      const { status, location } = await page(path);
      expect(status, path).toBeGreaterThanOrEqual(300);
      expect(location, path).toContain('/login');
    }
    const { status } = await page('/api/export/backup.json');
    expect(status).toBeGreaterThanOrEqual(400);
    const lock = await page('/lock');
    expect(lock.location).toContain('/login');
  });

  test('sign in with email and password, through Supabase Auth', async () => {
    alice = await signIn(people.alice);
    bob = await signIn(people.bob);
    carol = await signIn(people.carol);
    expect(alice.cookieHeader).toMatch(/sb-.*-auth-token/);
  });

  test('a signed-in person with no household is sent to setup, and the page offers it', async () => {
    const home = await page('/', alice);
    expect(home.status === 200 || (home.location ?? '').includes('/setup')).toBe(true);
    const setup = await page('/setup', alice);
    expect(setup.status).toBe(200);
    // The creation form: its two fields, and nothing of a household that does not exist.
    expect(setup.html).toContain('name="householdName"');
    expect(setup.html).toContain('name="profileName"');
  });

  test('bootstrap: create the household, an account, a transaction', async () => {
    const store = storeFor(alice);
    householdA = await store.create({ householdName: 'משפחת בדיקה', profileName: 'אליס' });
    created.households.push(householdA);
    accountA = await store.run((d, c) =>
      addAccount(
        d,
        {
          name: 'עו״ש בדיקה',
          kind: 'bank_account',
          scope: 'household',
          institution: null,
          displaySuffix: null,
          openingBalanceMinor: 1_000_000,
          openingBalanceDirection: 'inflow',
          openingBalanceDate: '2026-09-01',
        },
        c,
      ),
    );
    await store.run((d, c) =>
      recordTransaction(
        d,
        {
          accountId: accountA,
          counterpartAccountId: null,
          scope: 'household',
          kind: 'expense',
          direction: 'outflow',
          amountMinor: 12_345,
          categoryId: null,
          merchant: 'סופר בדיקה',
          transactionDate: '2026-09-02',
          note: null,
        },
        c,
      ),
    );
    const document = await store.readDocument();
    expect(document.accounts).toHaveLength(1);
    expect(document.transactions).toHaveLength(1);
  });

  test('the rendered dashboard and account screens show the household', async () => {
    const home = await page('/', alice);
    expect(home.status).toBe(200);
    // The dashboard shows figures, not the household's name: the safe-until
    // caption only exists when the engine had a real household to compute.
    expect(home.html).toContain('עד ');
    expect(home.html).not.toContain('עוד לא הוקם');
    const accounts = await page('/accounts', alice);
    expect(accounts.status).toBe(200);
    expect(accounts.html).toContain('עו״ש בדיקה');
    const setup = await page('/setup', alice);
    // With a household, the members card offers an invitation by email.
    expect(setup.html).toContain('יצירת הזמנה');
  });

  test('import: stage, review, approve — through the production transport', async () => {
    const store = storeFor(alice);
    const statement = buildCsv({
      delimiter: ';',
      preamble: ['בנק לדוגמה'],
      header: ['תאריך', 'תיאור', 'חובה', 'זכות', 'יתרה'],
      rows: [
        ['03/09/2026', 'דלק', '318.00', '', '9,000.00'],
        ['04/09/2026', 'החזר', '', '150.00', '9,150.00'],
      ],
    });
    const extraction = extractDocument(statement, {
      fileName: 'statement.csv',
      currency: 'ILS',
      scope: 'household',
    });
    const batchId = await store.run((d, c) =>
      stageExtraction(
        d,
        {
          extraction,
          displayName: 'statement.csv',
          storedId: randomUUID(),
          sha256: 'd'.repeat(64),
          byteSize: statement.byteLength,
          declaredMimeType: 'text/csv',
          targetAccountId: accountA,
        },
        c,
      ),
    );
    await store.run((d, c) =>
      reviewAll(d, { batchId, reviewState: 'included', onlyPending: true }, c),
    );
    const outcome = await store.run((d, c) => approveBatch(d, { batchId }, c));
    expect(outcome.transactionsCreated).toBe(2);
    const approvals = await page('/approvals', alice);
    expect(approvals.status).toBe(200);
  });

  test('budget, debt, gemach check and a task — each lands and renders', async () => {
    const store = storeFor(alice);
    const budgetId = await store.run((d, c) =>
      startBudget(
        d,
        { period: NOW().slice(0, 7), lines: [{ categoryKey: 'food', plannedMinor: 250_000 }] },
        c,
      ),
    );
    await store.run((d, c) =>
      setBudgetLine(d, { budgetId, categoryKey: 'food', plannedMinor: 260_000 }, c),
    );

    const debtId = await store.run((d, c) =>
      addDebt(
        d,
        {
          creditorName: 'גמ״ח בדיקה',
          kind: 'gemach',
          openingBalanceMinor: 300_000,
          openedOn: '2026-08-01',
          effectiveAnnualRateBp: 0,
          minimumPaymentMinor: null,
          paymentDueDay: null,
          urgency: 'none',
          promiseSummary: null,
          relationshipSensitivity: null,
          partialPaymentAllowed: null,
          expectedCallDate: null,
          notes: null,
        },
        c,
      ),
    );
    await store.run((d, c) =>
      setRepaymentPlan(
        d,
        {
          debtId,
          agreementSummary: null,
          installmentCount: 3,
          installmentAmountMinor: 100_000,
          finalInstallmentAmountMinor: null,
          firstDueDate: '2026-09-05',
        },
        c,
      ),
    );
    const checkId = await store.run((d, c) =>
      addCheck(
        d,
        {
          debtId,
          accountId: accountA,
          checkNumber: '2001',
          amountMinor: 100_000,
          dueDate: '2026-09-05',
          payeeName: 'גמ״ח בדיקה',
          installmentNumber: 1,
          note: null,
          deliveredOn: null,
        },
        c,
      ),
    );
    await store.run((d, c) =>
      deliverChecks(d, { checkIds: [checkId], deliveredOn: '2026-09-01' }, c),
    );
    const cleared = await store.run((d, c) =>
      clearCheck(d, { checkId, clearedOn: '2026-09-06' }, c),
    );
    expect(cleared.transactionId).toBeTruthy();

    const taskId = await store.run((d, c) =>
      addTask(
        d,
        {
          title: 'משימת בדיקה',
          reason: null,
          origin: 'manual',
          recommendationKey: null,
          amountMinor: null,
          relatedDebtId: null,
          relatedAccountId: null,
          assignedMemberId: null,
          dueOn: null,
        },
        c,
      ),
    );
    await store.run((d, c) => updateTask(d, { taskId, status: 'done' }, c));

    for (const [path, expected] of [
      ['/budget', 'מזון'],
      ['/debts', 'גמ״ח בדיקה'],
      ['/gemach', 'גמ״ח בדיקה'],
      ['/tasks', 'משימת בדיקה'],
      ['/reports', 'לשמור עותק'],
      ['/activity', 'נרשמה'],
    ] as const) {
      const rendered = await page(path, alice);
      expect(rendered.status, path).toBe(200);
      expect(rendered.html, path).toContain(expected);
    }
  });

  test('a recent password entry admits an export; the backup downloads', async () => {
    const backup = await page('/api/export/backup.json', alice);
    expect(backup.status).toBe(200);
    expect(backup.html).toContain('family-finance-backup');
    expect(backup.html).toContain('משפחת בדיקה');
  });

  test('invitation: Alice invites, Bob joins, both read the same household', async () => {
    const token = await storeFor(alice).invite(people.bob.email);
    const account = await page('/account', alice);
    expect(account.status).toBe(200);
    expect(account.html).toContain(people.bob.email.split('@')[0] ?? '');
    expect(account.html).not.toContain(token);

    const joined = await storeFor(bob).acceptInvitation(token);
    expect(joined).toBe(householdA);
    const bobHome = await page('/', bob);
    expect(bobHome.status).toBe(200);
    expect(bobHome.html).not.toContain('עוד לא הוקם');
    // The same household: Bob's account screen lists Alice's account.
    const bobAccounts = await page('/accounts', bob);
    expect(bobAccounts.html).toContain('עו״ש בדיקה');
  });

  test('isolation: Carol’s household never sees Alice’s, on screen or through the transport', async () => {
    const carolStore = storeFor(carol);
    const householdC = await carolStore.create({
      householdName: 'משק זר',
      profileName: 'קרול',
    });
    created.households.push(householdC);

    const foreign = new SupabaseHouseholdStore(
      new SupabaseHouseholdTransport(carol.client, people.carol.id),
      people.carol.id,
      householdA,
    );
    await expect(foreign.readDocument()).rejects.toThrow();

    for (const path of ['/', '/accounts', '/account', '/debts']) {
      const rendered = await page(path, carol);
      expect(rendered.status, path).toBe(200);
      expect(rendered.html, path).not.toContain('משפחת בדיקה');
      expect(rendered.html, path).not.toContain('עו״ש בדיקה');
      expect(rendered.html, path).not.toContain('גמ״ח בדיקה');
    }
    const aliceHome = await page('/', alice);
    expect(aliceHome.html).not.toContain('משק זר');
  });

  test('sign out ends the session; the old cookies open nothing', async () => {
    await alice.client.auth.signOut();
    const afterwards = await page('/accounts', alice);
    expect(afterwards.status).toBeGreaterThanOrEqual(300);
    expect(afterwards.location).toContain('/login');
  });

  test('the server never wrote a secret or a household figure to its output', () => {
    expect(serverOutput).not.toContain(PUBLISHABLE_KEY);
    expect(serverOutput).not.toContain(SUPABASE_URL);
    for (const person of Object.values(people))
      expect(serverOutput).not.toContain(person.password);
    expect(serverOutput).not.toContain('משפחת בדיקה');
  });
});
