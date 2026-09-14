import 'server-only';

import { redirect } from 'next/navigation';

import { assertUnlockedSession, sessionContext } from './session';

/**
 * The two ways the lock is enforced, and why there are two.
 *
 * `assertUnlocked` is handed to the household store and runs at every door into
 * the family's records. It throws, because it executes inside the store and a
 * redirect thrown from there would be swallowed by whichever action's error
 * handling happened to be on the stack. It is the backstop: a screen or an
 * action written next month cannot read a balance without passing it, whether or
 * not its author thought about the lock.
 *
 * `requireUnlocked` is what a page calls before it renders. It redirects, which
 * is what a person should experience — the locked screen, not an error. Pages
 * call it explicitly so the redirect happens before any work is done.
 *
 * Neither is a substitute for the other, and neither is decoration: with only
 * the redirect the lock would be a convention, and with only the throw a locked
 * visitor would meet an error page.
 */

/** Handed to the household store. Throws when the application is locked. */
export async function assertUnlocked(): Promise<void> {
  await assertUnlockedSession();
}

/**
 * Called at the top of a protected page. Sends a locked visitor to the lock screen.
 *
 * `redirect` throws a control-flow signal that Next understands, so nothing after
 * it runs — which is the point. It must not be called inside a `try` that
 * swallows errors.
 */
export async function requireUnlocked(): Promise<void> {
  const context = await sessionContext();
  if (!context.locked) return;
  if (context.session !== null) return;
  redirect('/lock');
}
