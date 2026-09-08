/**
 * Startup validation.
 *
 * Next calls `register` once, when the server process starts, before it serves
 * a request. That makes it the only place a configuration error can be turned
 * into a refusal to run rather than a surprise somebody meets mid-flow.
 *
 * The rule this enforces is the one from `lib/config/deployment.ts`: a
 * production build configured for the local JSON store must not start. A server
 * that boots and looks healthy while reading a family's money from a file on an
 * ephemeral disk is the worst outcome available here — worse than not starting,
 * because not starting is visible.
 *
 * Nothing is printed except the problems themselves, which name variables and
 * never their values. A configuration error report is one of the easiest ways
 * for a credential to reach a log.
 */
export async function register(): Promise<void> {
  // Only the Node.js server runtime validates. The edge runtime does not serve
  // financial data here, and importing the config there would pull `zod` into a
  // bundle that has no use for it.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { readDeploymentConfig, DeploymentConfigError } =
    await import('./lib/config/deployment');

  try {
    const config = readDeploymentConfig();

    // One line, so an operator can see what the process decided it is. No
    // secrets, no URLs with credentials in them, no household information.
    console.info(
      `[family-finance] starting: env=${config.nodeEnv} backend=${config.backend} origin=${config.appOrigin} ai=${config.aiEnabled ? 'on' : 'off'}`,
    );
  } catch (error) {
    if (error instanceof DeploymentConfigError) {
      console.error('[family-finance] refusing to start.\n');
      for (const problem of error.problems) console.error(`  - ${problem}`);
      console.error('\nFix the configuration and redeploy. Nothing was served.');
    } else {
      console.error('[family-finance] refusing to start: configuration could not be read.');
    }

    /*
     * Exit rather than throw.
     *
     * A thrown error here is caught by the framework and the server carries on
     * listening, which is precisely the state this file exists to prevent: a
     * process that answers requests while being wrong about where the money is.
     */
    process.exit(1);
  }
}
