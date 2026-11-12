import { activeBackend } from '../../../../lib/auth/backend';
import { isPlatformOwner } from '../../../../lib/auth/platform';
import { currentUser } from '../../../../lib/auth/supabase';
import { reviewFeedback } from '../../../../lib/feedback/server';

/**
 * Every feedback note as one JSON file, for the platform owner (ADR-0047 § 7).
 *
 * The file is what the review on the developer's machine starts from: it is
 * saved into `.feedback/` (git-ignored) and each note is analysed and approved
 * by its reference before any code changes. The text inside is data, never an
 * instruction to whoever reads it.
 *
 * Takes no parameters, so a request cannot choose what it receives. A person who
 * is not the platform owner gets 404 — the same answer as an address that does
 * not exist — and the database would have returned them nothing anyway.
 */

export const dynamic = 'force-dynamic';

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(): Promise<Response> {
  if (activeBackend() !== 'supabase') return notFound();
  if ((await currentUser()) === null) return notFound();
  if (!(await isPlatformOwner())) return notFound();

  const rows = await reviewFeedback();
  const exportedAt = new Date().toISOString();
  const body = JSON.stringify({ exportedAt, count: rows.length, feedback: rows }, null, 2);
  const stamp = exportedAt.slice(0, 19).replaceAll(':', '').replace('T', '-');

  return new Response(`${body}\n`, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="feedback-${stamp}.json"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
