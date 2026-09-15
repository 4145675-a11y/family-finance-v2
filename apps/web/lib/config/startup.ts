import 'server-only';

import {
  DeploymentConfigError,
  readDeploymentConfig,
  type DeploymentConfig,
  type RawEnvironment,
} from './deployment';

/**
 * The verdict a process reaches about its own configuration, and what it does
 * with it (ADR-0034).
 *
 * A process with problems **runs and serves refusals**: `proxy.ts` answers 503
 * to every request it sees, `/api/health` answers `503 misconfigured` naming
 * the settings at fault, and nothing of the application executes. The host's
 * health check fails, the deploy is not promoted, and the previous one keeps
 * serving. Startup (`instrumentation.ts`, Node runtime) logs the verdict once
 * so the same names are in the log.
 *
 * Why not exit, and why not throw — both were measured:
 *
 *   - `process.exit` in `instrumentation.ts` failed the first Render build:
 *     that file is compiled for the Edge runtime too, always, and the build
 *     refuses a Node API in it. The Edge variant is dead code; the analysis
 *     reads the source.
 *   - A throw from `register()` is not a startup failure under `next start`
 *     (16.3.1): Next logs "Failed to prepare server" and keeps listening, and
 *     every request — `/api/health` included — answers 500. The process is
 *     alive, unhealthy, and says nothing useful over HTTP.
 *
 * A refusing process needs no Node API, is inside what Next supports (a proxy
 * and a route handler), and is observable from outside: the health report
 * names what is wrong, with no value in it.
 */

export type StartupVerdict =
  | { readonly ok: true; readonly config: DeploymentConfig }
  | { readonly ok: false; readonly problems: readonly string[] };

/** Pure: the verdict for an environment record. Never throws. */
export function decideStartup(env: RawEnvironment = process.env): StartupVerdict {
  try {
    return { ok: true, config: readDeploymentConfig(env) };
  } catch (error) {
    return {
      ok: false,
      problems:
        error instanceof DeploymentConfigError
          ? error.problems
          : ['the deployment configuration could not be read'],
    };
  }
}

let cached: StartupVerdict | null = null;

/**
 * The verdict for this process, decided once. The environment does not change
 * while a process runs, and a per-request re-parse would buy nothing.
 */
export function deploymentVerdict(): StartupVerdict {
  cached ??= decideStartup(process.env);
  return cached;
}

export interface StartupLog {
  info(message: string): void;
  error(message: string): void;
}

/**
 * Logs one line about what the process decided it is, or the problems and a
 * refusal. The lines name variables and never their values: a startup report
 * is one of the easiest ways for a credential to reach a log. The origin is
 * printed — it is the public address, not a secret.
 */
export function announceStartupVerdict(
  env: RawEnvironment = process.env,
  log: StartupLog = console,
): StartupVerdict {
  const verdict = decideStartup(env);
  if (verdict.ok) {
    const { config } = verdict;
    log.info(
      `[family-finance] starting: env=${config.nodeEnv} backend=${config.backend} origin=${config.appOrigin} ai=${config.aiEnabled ? 'on' : 'off'}`,
    );
    return verdict;
  }
  log.error('[family-finance] refusing to serve.\n');
  for (const problem of verdict.problems) log.error(`  - ${problem}`);
  log.error(
    '\nEvery request answers 503 and /api/health reports "misconfigured" until this is fixed. Fix the configuration and redeploy. Nothing is served.',
  );
  return verdict;
}
