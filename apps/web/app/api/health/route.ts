import { healthReport } from '../../../lib/health';

/**
 * Is this deployment alive and configured?
 *
 * Render, and any uptime check, needs an endpoint that answers without a
 * session. That makes it the one route reachable by anybody at all — so what it
 * may say is strictly limited:
 *
 *   - **never** a balance, a household name, a member, a document, a count of
 *     anything financial, or whether a household exists at all. "How many
 *     households are set up" is itself information about this family.
 *   - **never** a secret, a connection string, or a URL carrying credentials.
 *   - **never** a stack trace or a library version, which only helps somebody
 *     deciding what to try next.
 *
 * What it does say is whether the process considers itself correctly configured,
 * and — for the database backend — whether the data layer behind it can be
 * used: configuration present, database reachable, schema compatible, the
 * authenticated path available, and an overall readiness (PROD-HEALTH-002).
 * A misconfigured deployment reports `misconfigured` with the *names* of the
 * settings at fault and never their values — enough for the person deploying to
 * fix it, useless to anybody else. See lib/health.ts for how the probe works
 * without a session and without exposing anything.
 */

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const { report, httpStatus } = await healthReport();
  return Response.json(report, {
    status: httpStatus,
    headers: { 'cache-control': 'no-store' },
  });
}
