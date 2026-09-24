/**
 * The ports the browser suite uses.
 *
 * Deliberately different from every other gate's: `check:shell` holds 3131,
 * `check:fail-closed` builds its own servers, and the production-path validation
 * holds 3133. A suite that reused one of those would pass or fail depending on
 * what else happened to be running, which is the least useful kind of test.
 */
export const LOCAL_HOST = '127.0.0.1';
export const LOCAL_PORT = 3141;
export const LOCAL_BASE_URL = `http://${LOCAL_HOST}:${LOCAL_PORT}`;

/**
 * What the local deployment declares as its own origin.
 *
 * `localhost` is the one http origin the configuration treats as secure, so the
 * cookies and the auth-link checks behave as they do in production.
 */
export const LOCAL_APP_ORIGIN = `http://localhost:${LOCAL_PORT}`;
