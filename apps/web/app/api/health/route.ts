import { deploymentProblems, readDeploymentConfig } from '../../../lib/config/deployment';

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
 * What it does say is whether the process considers itself correctly configured.
 * A misconfigured deployment reports `misconfigured` with the *names* of the
 * settings at fault and never their values — enough for the person deploying to
 * fix it, useless to anybody else.
 */

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const problems = deploymentProblems();

  if (problems.length > 0) {
    return Response.json(
      {
        status: 'misconfigured',
        // Variable names only. `deploymentProblems` never includes a value.
        problems,
      },
      {
        status: 503,
        headers: { 'cache-control': 'no-store' },
      },
    );
  }

  const config = readDeploymentConfig();

  return Response.json(
    {
      status: 'ok',
      // Deliberately coarse. Enough to confirm the right build is running with
      // the right backend, and nothing that describes a household.
      backend: config.backend,
      environment: config.nodeEnv,
      aiEnabled: config.aiEnabled,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
