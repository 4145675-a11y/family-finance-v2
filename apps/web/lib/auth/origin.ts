/**
 * Which address the passkey works at, and why it is not the one you would guess.
 *
 * The rest of this application is served at `http://127.0.0.1:3100` and binds to
 * loopback only. WebAuthn cannot be used there, and this is not a policy choice
 * that could be argued with — it is what the browser does.
 *
 * A relying party id has to be a *domain*. `127.0.0.1` is an address, not a
 * domain, so Chromium refuses every ceremony on that origin before an
 * authenticator is ever consulted. Measured on this machine, on the server this
 * repository runs:
 *
 *   origin http://127.0.0.1:3100  isSecureContext true, Windows Hello available
 *     rp.id omitted     -> SecurityError: This is an invalid domain.
 *     rp.id "localhost" -> SecurityError: This is an invalid domain.
 *     rp.id "127.0.0.1" -> SecurityError: This is an invalid domain.
 *
 *   origin http://localhost:3100  isSecureContext true, Windows Hello available
 *     rp.id "127.0.0.1" -> SecurityError: not a registrable domain suffix
 *     rp.id "localhost" -> reaches the Windows Hello ceremony
 *
 * So `localhost` is the supported origin for signing in, and the server still
 * listens on 127.0.0.1 only — the name resolves to that address, and nothing is
 * exposed to the network by using it. `localhost` and `127.0.0.1` are two
 * different origins to the browser: a cookie set on one is not sent to the
 * other, and a passkey enrolled on one cannot be used on the other. The product
 * says so on screen rather than letting a person discover it at the lock screen.
 */

/** The origin passkeys are enrolled and verified against. */
export const DEFAULT_AUTH_ORIGIN = 'http://localhost:3100';

export interface AuthOrigin {
  /** The exact origin string, compared whole against `clientDataJSON.origin`. */
  readonly origin: string;
  /** The relying party id: the host, without the port. */
  readonly rpId: string;
  /** Host and port, as it appears in a `Host` header. */
  readonly host: string;
  /** False when this origin cannot do WebAuthn at all. */
  readonly usable: boolean;
  /** Why not, when it cannot. */
  readonly reason: 'ip_address' | 'insecure' | null;
}

/**
 * True for a host the browser treats as an address rather than a name.
 *
 * IPv4 in dotted form, and anything bracketed, which is how IPv6 appears in a
 * URL. Both are refused as relying party ids by the browser, so the product must
 * detect them rather than let the ceremony fail unexplained.
 */
export function isIpAddressHost(host: string): boolean {
  if (host.startsWith('[')) return true;
  return /^[0-9]+(\.[0-9]+){3}$/.test(host);
}

/**
 * Reads an origin and decides whether a passkey can live at it.
 *
 * `http` is accepted only for `localhost`, because that is the only host a
 * browser treats as a secure context without a certificate. Any other host over
 * plain http would give a lock screen that cannot lock.
 */
export function describeOrigin(candidate: string): AuthOrigin {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return {
      origin: candidate,
      rpId: candidate,
      host: candidate,
      usable: false,
      reason: 'insecure',
    };
  }

  const hostname = url.hostname;
  const secure =
    url.protocol === 'https:' || hostname === 'localhost' || hostname.endsWith('.localhost');

  const usable = secure && !isIpAddressHost(hostname);

  return {
    origin: url.origin,
    rpId: hostname,
    host: url.host,
    usable,
    reason: usable ? null : isIpAddressHost(hostname) ? 'ip_address' : 'insecure',
  };
}

/**
 * The origin this build enrols and verifies against.
 *
 * Overridable so the shell gate can run the whole flow on its own port, and so a
 * household that serves the application at a real name over TLS can say so. It is
 * read from the environment, never from a request header: an origin taken from
 * the request is an origin an attacker can choose, and the entire check would
 * then be checking a value against itself.
 */
export function configuredAuthOrigin(): AuthOrigin {
  const configured = process.env['FAMILY_FINANCE_AUTH_ORIGIN'];
  const value =
    configured === undefined || configured.trim() === ''
      ? DEFAULT_AUTH_ORIGIN
      : configured.trim();
  return describeOrigin(value);
}

/**
 * Whether the browser is currently at the address where passkeys work.
 *
 * Compared on host, not on the whole origin: the request arrives over http on
 * loopback and the configured origin may name https, and it is the host that
 * decides whether the ceremony can run.
 */
export function requestIsAtAuthOrigin(requestHost: string | null): boolean {
  if (requestHost === null) return false;
  return requestHost.toLowerCase() === configuredAuthOrigin().host.toLowerCase();
}
