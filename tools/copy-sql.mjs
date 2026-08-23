#!/usr/bin/env node
/**
 * Copies a project SQL file to the clipboard.
 *
 * Exists because pasting five files by hand went wrong twice: the SQL Editor
 * retained previous content, and the clipboard was overwritten by screenshots.
 * One command, one file, one paste.
 *
 * What it prints: file name, byte and character counts, line count, SHA-256, and
 * for the diagnostic a read-only confirmation. It never prints the SQL itself —
 * output is for verifying that the right thing is on the clipboard, and a
 * transcript should not become a second copy of the file.
 *
 * Windows uses clip.exe, macOS pbcopy, Linux xclip or xsel. No dependency, no
 * global install, and no path outside the repository is read or written.
 *
 * Usage: node tools/copy-sql.mjs <path-inside-supabase/manual>
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findMutations } from './sql-guard.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANUAL_DIR = join(REPO_ROOT, 'supabase', 'manual');

/** Files that must contain no state-changing statement. */
const READ_ONLY_FILES = new Set(['diagnostic.sql']);

/**
 * Places a file's contents on the system clipboard.
 *
 * Windows does NOT use clip.exe. clip.exe decodes its stdin with the console
 * code page, so UTF-8 arrives mangled — verified here: an em dash (U+2014) came
 * back as U+0393. These files carry Hebrew and typographic punctuation, so that
 * would put visibly corrupted SQL in front of a production database.
 *
 * PowerShell reads the file itself with an explicit UTF-8 decoder and sets the
 * clipboard as a Unicode string, so no code page is involved. The copy is then
 * read back and compared, because a clipboard write that silently corrupts is
 * exactly the failure this tool exists to prevent.
 *
 * pbcopy, xclip and xsel are byte-transparent, so UTF-8 survives stdin there.
 *
 * @param {string} absolutePath
 * @param {string} text
 * @returns {{ok: true, verified: boolean} | {ok: false, reason: string}}
 */
function copyToClipboard(absolutePath, text) {
  if (process.platform === 'win32') {
    const psPath = absolutePath.replace(/'/g, "''");
    const script = [
      '$ErrorActionPreference = "Stop";',
      `$text = [System.IO.File]::ReadAllText('${psPath}', [System.Text.Encoding]::UTF8);`,
      'Set-Clipboard -Value $text;',
      // Read back and report equality, ignoring the CRLF the clipboard applies.
      '$back = Get-Clipboard -Raw;',
      'if ($null -eq $back) { Write-Output "VERIFY:EMPTY"; exit 0 }',
      '$a = ($text -replace "`r`n", "`n").TrimEnd("`n");',
      '$b = ($back -replace "`r`n", "`n").TrimEnd("`n");',
      'if ($a -eq $b) { Write-Output "VERIFY:OK" } else { Write-Output "VERIFY:MISMATCH" }',
    ].join(' ');

    const result = spawnSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', windowsHide: true },
    );

    if (result.error || result.status !== 0) {
      return { ok: false, reason: 'PowerShell could not set the clipboard' };
    }
    const stdout = String(result.stdout);
    if (stdout.includes('VERIFY:OK')) return { ok: true, verified: true };
    if (stdout.includes('VERIFY:MISMATCH')) {
      return { ok: false, reason: 'the clipboard did not match the file after copying' };
    }
    return { ok: true, verified: false };
  }

  const candidates =
    process.platform === 'darwin'
      ? [['pbcopy', []]]
      : [
          ['xclip', ['-selection', 'clipboard']],
          ['xsel', ['--clipboard', '--input']],
        ];

  for (const [command, args] of candidates) {
    const result = spawnSync(command, args, { input: text, windowsHide: true });
    if (!result.error && result.status === 0) return { ok: true, verified: false };
  }

  return {
    ok: false,
    reason: 'no clipboard utility available (tried pbcopy / xclip / xsel)',
  };
}

function main() {
  const requested = process.argv[2];

  if (!requested) {
    console.error('Usage: node tools/copy-sql.mjs <file.sql inside supabase/manual>');
    process.exitCode = 2;
    return;
  }

  // Resolve inside supabase/manual and refuse anything that escapes it. A path
  // argument is the obvious way this tool could be pointed at a file it has no
  // business reading.
  const absolute = resolve(MANUAL_DIR, requested);
  const insideManual = absolute === MANUAL_DIR || absolute.startsWith(MANUAL_DIR + sep);

  if (!insideManual) {
    console.error('Refusing to read outside supabase/manual.');
    console.error(`  requested: ${requested}`);
    process.exitCode = 2;
    return;
  }

  if (extname(absolute).toLowerCase() !== '.sql') {
    console.error(`Not a .sql file: ${relative(REPO_ROOT, absolute)}`);
    process.exitCode = 2;
    return;
  }

  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    console.error(`File not found: ${relative(REPO_ROOT, absolute)}`);
    process.exitCode = 2;
    return;
  }

  const sql = readFileSync(absolute, 'utf8');
  const name = relative(MANUAL_DIR, absolute).split(sep).join('/');
  const digest = createHash('sha256').update(sql, 'utf8').digest('hex');

  // The diagnostic must be provably read-only before it is handed over.
  if (READ_ONLY_FILES.has(name)) {
    const mutations = findMutations(sql);
    if (mutations.length > 0) {
      console.error(`${name} is expected to be read-only but contains:`);
      for (const { kind, token } of mutations) console.error(`  ${kind}: ${token}`);
      console.error('Nothing was copied.');
      process.exitCode = 1;
      return;
    }
  }

  const copied = copyToClipboard(absolute, sql);
  const nonAscii = [...sql].filter((char) => char.codePointAt(0) > 127).length;

  console.log(`file:       supabase/manual/${name}`);
  console.log(`characters: ${sql.length}`);
  console.log(`bytes:      ${Buffer.byteLength(sql, 'utf8')}`);
  console.log(`lines:      ${sql.split(/\r?\n/).length}`);
  console.log(`non-ascii:  ${nonAscii}`);
  console.log(`sha256:     ${digest}`);
  console.log(
    `read-only:  ${READ_ONLY_FILES.has(name) ? 'yes (verified)' : 'no - this file changes the schema'}`,
  );

  if (!copied.ok) {
    console.error('');
    console.error(`Clipboard failed: ${copied.reason}`);
    console.error(`Nothing was copied. Open the file directly: supabase/manual/${name}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `clipboard:  ${copied.verified ? 'copied and read back byte-for-byte' : 'copied (not verified on this platform)'}`,
  );
  console.log('');
  console.log('Paste into an EMPTY SQL Editor window and run once.');
}

main();
