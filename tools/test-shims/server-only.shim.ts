/**
 * A no-op stand-in for the `server-only` marker, used by the test runner.
 *
 * `server-only` exists to make one mistake impossible: importing a module that
 * touches secrets or the filesystem from a client component becomes a build
 * error rather than a silent leak. It does that through conditional exports —
 * under React's `react-server` condition it resolves to nothing, and everywhere
 * else it throws on import.
 *
 * Vitest is neither, so importing a correctly-marked module would throw and the
 * module could not be tested at all. That is the wrong trade: the marker's job
 * is to constrain the *bundle*, and `check:client-secrets` is what enforces it.
 * Aliasing it here restores testability without loosening anything — the gate
 * still reads the real import statement in the real source file.
 *
 * The alternative was to leave such modules unmarked so their tests would run,
 * which is how a module that names secrets ends up reachable from the browser.
 */
export {};
