import 'server-only';

import { z } from 'zod';

/**
 * What this deployment is, and whether it is allowed to run at all.
 *
 * Until now the application had one source of truth — a JSON file on the
 * household's own machine — and `resolveDataSource` picked it whenever it
 * existed, production or not. That was correct while there was nothing else. It
 * is exactly wrong once there is: a hosted server that finds a stray
 * `.data/household.json` on its disk would serve it, silently, as the family's
 * money, with none of the isolation the database provides and none of the
 * durability, on a filesystem the host may discard between deploys.
 *
 * So the decision moves here, is made once, and fails closed:
 *
 *   **A deployment served at an origin other people can reach may not use the
 *   local JSON store.**
 *
 * Not "warns". Not "falls back". Refuses — because every alternative leaves a
 * running server that looks healthy while being wrong about where a household's
 * financial records live.
 *
 * The rule is keyed on the origin, not on `NODE_ENV`. The first version used the
 * build mode and was too broad: it refused a copy running on the family's own
 * computer in production mode, which is the shape this product has shipped as
 * until now and the shape the shell gate exercises. Being built for production
 * is not the risk. Being reachable by other people is.
 *
 * The dangerous default is covered separately — a production deployment must
 * declare its backend, so a hosted service that sets nothing is refused rather
 * than quietly falling back to a file.
 *
 * Everything in this module is a pure function of an environment record. The
 * process is read once, at the edge, so the rules can be tested exhaustively
 * without a server and without setting global state.
 *
 * `server-only` is not decoration. The list below names the variables that must
 * never carry a public prefix, and naming a secret is enough to make a module
 * one the browser must never receive — `check:client-secrets` says so, and it
 * caught this file before the marker was added.
 */

export type DataBackend = 'local_json' | 'supabase';

export class DeploymentConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `this deployment is not configured safely:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
    this.name = 'DeploymentConfigError';
    this.problems = problems;
  }
}

export interface DeploymentConfig {
  readonly nodeEnv: string;
  readonly isProduction: boolean;
  /** Where the household's financial truth lives for this process. */
  readonly backend: DataBackend;
  /** The origin the browser reaches this deployment at. */
  readonly appOrigin: string;
  /** WebAuthn relying party id, derived from the origin. */
  readonly rpId: string;
  /** True when documents may be sent to the configured AI provider. */
  readonly aiEnabled: boolean;
  /** True when the development fixture may be offered. Never in production. */
  readonly fixtureAllowed: boolean;
  /**
   * Whether session cookies must carry the Secure attribute: true on any https
   * origin, false only for http://localhost. A production origin is always https.
   */
  readonly secureCookies: boolean;
  /**
   * The Supabase project this deployment talks to, taken from the URL's host.
   * Present only with the database backend. Compared, never printed.
   */
  readonly supabaseProjectRef: string | null;
}

/**
 * Variables this module reads.
 *
 * Named as literals rather than looked up dynamically, so a reader can grep for
 * exactly what a deployment has to be given, and so nothing arrives here by
 * accident.
 */
export interface RawEnvironment {
  readonly NODE_ENV?: string | undefined;
  readonly FAMILY_FINANCE_DATA_BACKEND?: string | undefined;
  readonly FAMILY_FINANCE_APP_ORIGIN?: string | undefined;
  readonly FAMILY_FINANCE_AUTH_ORIGIN?: string | undefined;
  readonly NEXT_PUBLIC_SUPABASE_URL?: string | undefined;
  readonly NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string | undefined;
  readonly SUPABASE_SECRET_KEY?: string | undefined;
  readonly FAMILY_FINANCE_AI_ENABLED?: string | undefined;
  readonly OPENAI_API_KEY?: string | undefined;
  readonly NEXT_PUBLIC_DEV_DATA_SOURCE?: string | undefined;
}

const backendSchema = z.enum(['local_json', 'supabase']);

/**
 * A Supabase project URL is exactly `https://<ref>.supabase.co`: twenty lowercase
 * letters, no path, no port. Anything else is a typo, a copied dashboard link,
 * or a different service — and a wrong project is a wrong database.
 */
const SUPABASE_HOST = /^([a-z]{20})\.supabase\.co$/;

export function supabaseProjectRefOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search !== '') {
    return null;
  }
  if (parsed.port !== '' || parsed.username !== '' || parsed.password !== '') return null;
  const match = SUPABASE_HOST.exec(parsed.hostname);
  return match?.[1] ?? null;
}

/** The one literal that turns a boolean environment flag on. Anything else is off. */
const ON = 'on';

/**
 * A host that only exists on the machine serving it.
 *
 * A production deployment reachable only here is not reachable by the family,
 * so it is a misconfiguration rather than a deployment.
 */
function isLoopbackHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (hostname === '[::1]') return true;
  return /^127\.[0-9]+\.[0-9]+\.[0-9]+$/.test(hostname);
}

/**
 * A host that is an address rather than a name.
 *
 * Kept separate from loopback because the two are refused for different reasons,
 * and a wrong reason sends somebody looking in the wrong place. A public IP is
 * perfectly reachable; what disqualifies it is that a WebAuthn relying party
 * must be a domain name and an address is not one — measured, and recorded in
 * ADR-0029.
 */
function isIpAddressHost(hostname: string): boolean {
  if (hostname.startsWith('[')) return true;
  return /^[0-9]+(\.[0-9]+){3}$/.test(hostname);
}

interface ParsedOrigin {
  readonly origin: string;
  readonly rpId: string;
  readonly secure: boolean;
  readonly loopback: boolean;
  readonly ipAddress: boolean;
  /** The value carried more than an origin: a path, a query, a fragment or credentials. */
  readonly decorated: boolean;
}

function parseOrigin(candidate: string): ParsedOrigin | null {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return {
    origin: url.origin,
    rpId: url.hostname,
    decorated:
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== '' ||
      url.username !== '' ||
      url.password !== '',
    // `http://localhost` is a secure context; nothing else over http is.
    secure:
      url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost'),
    loopback: isLoopbackHost(url.hostname),
    ipAddress: isIpAddressHost(url.hostname),
  };
}

/**
 * Values that must never be public.
 *
 * Next inlines every `NEXT_PUBLIC_*` variable into the browser bundle. A secret
 * given that prefix is a secret published to every visitor, and the mistake is
 * one keystroke wide — so it is checked here rather than hoped about.
 */
const NEVER_PUBLIC = [
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'DATABASE_URL',
  'OPENAI_API_KEY',
  'VAPID_PRIVATE_KEY',
  'NOTIFICATION_WORKER_SECRET',
] as const;

export function publicPrefixedSecrets(env: Record<string, string | undefined>): string[] {
  return NEVER_PUBLIC.filter((name) => env[`NEXT_PUBLIC_${name}`] !== undefined).map(
    (name) => `NEXT_PUBLIC_${name}`,
  );
}

/**
 * Reads the environment and decides whether this process may serve a household.
 *
 * Throws rather than returning a partial answer. A configuration error is not
 * something a request should discover.
 *
 * Every problem names the variable and never what is in it — not the raw
 * value, not a parsed form of it. The problems travel to the startup log, to
 * the public `/api/health` body and into the thrown error's message, and a
 * key pasted into the wrong slot must not travel with them. The name is what
 * the person deploying needs; the value is what they already have.
 */
export function readDeploymentConfig(env: RawEnvironment = process.env): DeploymentConfig {
  const problems: string[] = [];

  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';

  // --- which backend -------------------------------------------------------
  const declared = env.FAMILY_FINANCE_DATA_BACKEND?.trim();
  let backend: DataBackend = 'local_json';

  if (declared === undefined || declared === '') {
    // Silence means the local store, which is right for a developer and
    // forbidden in production — so production must say what it wants.
    if (isProduction) {
      problems.push(
        'FAMILY_FINANCE_DATA_BACKEND is not set. A production deployment must state its backend explicitly: "supabase" for a hosted service, or "local_json" for a copy running on the household’s own machine.',
      );
    }
  } else {
    const parsed = backendSchema.safeParse(declared);
    if (!parsed.success) {
      problems.push(
        'FAMILY_FINANCE_DATA_BACKEND is not a backend this build knows. Use "supabase" or "local_json".',
      );
    } else {
      backend = parsed.data;
    }
  }

  // --- the origin the family reaches --------------------------------------
  const statedOrigin =
    env.FAMILY_FINANCE_APP_ORIGIN?.trim() || env.FAMILY_FINANCE_AUTH_ORIGIN?.trim() || '';
  const originValue = statedOrigin || 'http://localhost:3100';
  const origin = parseOrigin(originValue);

  // The localhost default is for a developer's machine. A production process on
  // the database backend is a hosted one, and it must say where the family
  // reaches it: cookie security and every auth redirect are derived from the
  // origin, and "localhost" on a server would silently give the wrong answer
  // to both (PROD-ORIGIN-001).
  if (isProduction && backend === 'supabase' && statedOrigin === '') {
    problems.push(
      'FAMILY_FINANCE_APP_ORIGIN is not set. A hosted deployment must state the https origin the family reaches — it decides cookie security and where auth links return to.',
    );
  }

  if (origin === null) {
    problems.push(
      'FAMILY_FINANCE_APP_ORIGIN is not a usable URL. It must be an http(s) origin: scheme, host and port.',
    );
  } else {
    if (origin.decorated) {
      problems.push(
        'FAMILY_FINANCE_APP_ORIGIN must be an origin only — scheme, host and port — with no path, query, fragment or credentials.',
      );
    }
    if (/.supabase.co$/.test(origin.rpId)) {
      problems.push(
        'FAMILY_FINANCE_APP_ORIGIN names a Supabase host. The application origin is where the family reaches this server, never the database.',
      );
    }
    const authOriginValue = env.FAMILY_FINANCE_AUTH_ORIGIN?.trim();
    if (
      authOriginValue !== undefined &&
      authOriginValue !== '' &&
      env.FAMILY_FINANCE_APP_ORIGIN?.trim() &&
      parseOrigin(authOriginValue)?.origin !== origin.origin
    ) {
      problems.push(
        'FAMILY_FINANCE_AUTH_ORIGIN and FAMILY_FINANCE_APP_ORIGIN disagree. A deployment has one origin; set one of them, or set both to the same value.',
      );
    }
    if (!origin.secure) {
      problems.push(
        'FAMILY_FINANCE_APP_ORIGIN is not a secure context, so passkeys cannot work there. Use https, or http://localhost for development.',
      );
    }
    if (!origin.loopback && origin.ipAddress) {
      problems.push(
        'FAMILY_FINANCE_APP_ORIGIN is an IP address: a passkey relying party must be a domain name, and an address is not one (ADR-0029). Set it to the https domain.',
      );
    }
  }

  /*
   * The rule this module exists for, keyed on the risk rather than on a proxy
   * for it.
   *
   * The first version refused `NODE_ENV=production` together with the local
   * store, and that was too broad — it broke the shell gate, which was right and
   * the rule was wrong. A family running this on their own computer in
   * production mode is the shape the product has shipped as until now, and the
   * JSON file is the correct source of truth there.
   *
   * What is never acceptable is a *hosted* deployment reading a file: no
   * row-level security, no durability, and on most hosts a filesystem that
   * disappears with the container. "Hosted" is not a build flag — it is an
   * origin other people can reach.
   *
   * The dangerous default is covered separately: a production deployment must
   * declare its backend, so a Render service that sets nothing is refused rather
   * than quietly falling back to a file.
   */
  if (origin !== null && !origin.loopback && backend === 'local_json') {
    problems.push(
      'FAMILY_FINANCE_APP_ORIGIN is not this machine, and FAMILY_FINANCE_DATA_BACKEND is the local JSON store. Hosted truth must live in PostgreSQL; set FAMILY_FINANCE_DATA_BACKEND=supabase.',
    );
  }

  // --- the Supabase backend needs its connection ---------------------------
  if (backend === 'supabase') {
    if (env.NEXT_PUBLIC_SUPABASE_URL === undefined || env.NEXT_PUBLIC_SUPABASE_URL === '') {
      problems.push('NEXT_PUBLIC_SUPABASE_URL is required when the backend is supabase.');
    } else if (!env.NEXT_PUBLIC_SUPABASE_URL.startsWith('https://')) {
      problems.push('NEXT_PUBLIC_SUPABASE_URL must be https.');
    } else if (supabaseProjectRefOf(env.NEXT_PUBLIC_SUPABASE_URL) === null) {
      problems.push(
        'NEXT_PUBLIC_SUPABASE_URL must be the project URL exactly: https://<project-ref>.supabase.co with no path or port. Copy it from Project Settings → API.',
      );
    }

    const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (key === undefined || key === '') {
      problems.push(
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required when the backend is supabase.',
      );
    } else if (!key.startsWith('sb_publishable_')) {
      problems.push(
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a publishable key beginning with "sb_publishable_". A secret key must never appear in client configuration.',
      );
    }
  }

  // --- AI is off unless it is deliberately on, with a key ------------------
  const aiRequested = env.FAMILY_FINANCE_AI_ENABLED?.trim() === ON;
  const hasKey = (env.OPENAI_API_KEY ?? '').trim().length > 0;

  if (aiRequested && !hasKey) {
    // Claiming a capability that cannot run is worse than not offering it: the
    // screen would invite a person to send a document nowhere.
    problems.push(
      'FAMILY_FINANCE_AI_ENABLED is on but OPENAI_API_KEY is not set. Either supply the key as a protected secret or turn the flag off.',
    );
  }

  // --- a secret must never carry a public prefix ---------------------------
  for (const name of publicPrefixedSecrets(env as Record<string, string | undefined>)) {
    problems.push(
      `${name} is prefixed NEXT_PUBLIC_, which publishes it to every visitor's browser. Remove the prefix and set it as a server-only secret.`,
    );
  }

  if (problems.length > 0) throw new DeploymentConfigError(problems);

  return {
    nodeEnv,
    isProduction,
    backend,
    appOrigin: origin?.origin ?? originValue,
    rpId: origin?.rpId ?? '',
    aiEnabled: aiRequested && hasKey,
    // The fixture is a development convenience and is unreachable in production
    // no matter what the environment says (ADR-0017).
    fixtureAllowed: !isProduction && env.NEXT_PUBLIC_DEV_DATA_SOURCE?.trim() === ON,
    secureCookies: origin?.origin.startsWith('https://') ?? true,
    supabaseProjectRef:
      backend === 'supabase' ? supabaseProjectRefOf(env.NEXT_PUBLIC_SUPABASE_URL ?? '') : null,
  };
}

/**
 * The same check, as a yes/no, for callers that must not throw.
 *
 * Used by the health endpoint, which has to be able to report "misconfigured"
 * rather than crash — a health check that cannot answer is not a health check.
 */
export function deploymentProblems(env: RawEnvironment = process.env): readonly string[] {
  try {
    readDeploymentConfig(env);
    return [];
  } catch (error) {
    return error instanceof DeploymentConfigError
      ? error.problems
      : ['unexpected configuration error'];
  }
}
