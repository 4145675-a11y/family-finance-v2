/**
 * Startup announcement.
 *
 * Next calls `register` once, when the server process starts. The process
 * decides here whether its configuration is safe (`lib/config/deployment.ts`)
 * and says so in the log — one line when it is, the problems by name when it
 * is not. Values are never printed.
 *
 * The decision is *enforced* elsewhere, on every request: `proxy.ts` answers
 * 503 to everything while there are problems and `/api/health` reports
 * `misconfigured`, so a hosted process with bad configuration serves nothing
 * of the application and fails its health check (ADR-0034).
 *
 * Why this file does so little: it is compiled for the Edge runtime as well as
 * for Node — always — and the production build's static analysis refuses any
 * Node API in its source. `process.exit` here failed the first Render build,
 * and a throw from `register` is not a startup failure under `next start`; it
 * leaves a listening process answering 500 to everything, health included.
 * So: `process.env`, one dynamic import behind the runtime check, and nothing
 * else. `tools/edge-safe.test.mjs` and `npm run check:build` hold it there.
 */
export async function register(): Promise<void> {
  // Only the Node.js server runtime reads the configuration. The edge variant
  // of this function is dead code, folded away at compile time.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { announceStartupVerdict } = await import('./lib/config/startup');
  announceStartupVerdict();
}
