import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ActionForm, TextField } from '../../components/form';
import { Card, Notice } from '../../components/ui';
import { signInAction } from '../../lib/actions/auth';
import { activeBackend } from '../../lib/auth/backend';
import { currentUser } from '../../lib/auth/supabase';
import { accountScreen } from '../../lib/copy/security';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: accountScreen.signInTitle,
};

/**
 * Sign in with email and password — the door of the database backend.
 *
 * Under the file backend this page does not exist as a door: the lock screen
 * is the door there, and a password form nobody can use would only mislead.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; link?: string }>;
}) {
  if (activeBackend() !== 'supabase') redirect('/');
  if ((await currentUser()) !== null) redirect('/');
  const { next, link } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="px-1 text-[24px] leading-tight font-bold">{accountScreen.signInTitle}</h1>
      {link === 'invalid' ? (
        <Notice tone="attention">
          <p>{accountScreen.linkInvalid}</p>
        </Notice>
      ) : null}
      <Card>
        <p className="text-text-secondary">{accountScreen.signInIntro}</p>
        <div className="mt-5">
          <ActionForm action={signInAction} submitLabel={accountScreen.signIn}>
            <input type="hidden" name="next" value={next ?? '/'} />
            <TextField
              name="email"
              label={accountScreen.email}
              type="email"
              autoComplete="username"
              maxLength={254}
            />
            <TextField
              name="password"
              label={accountScreen.password}
              type="password"
              autoComplete="current-password"
              maxLength={256}
            />
          </ActionForm>
        </div>
        <p className="mt-4 text-small">
          <Link href="/auth/forgot" className="text-primary underline underline-offset-2">
            {accountScreen.forgotLink}
          </Link>
        </p>
        <p className="mt-6 border-t border-border pt-4 text-small text-text-secondary">
          {accountScreen.noAccountYet}
        </p>
      </Card>
    </main>
  );
}
