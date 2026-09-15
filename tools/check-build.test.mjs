/**
 * The build gate's matcher, against what Render actually printed.
 *
 * The gate itself runs a real build (`npm run check:build`); this pins the
 * lines it must treat as failures — starting with the three that ended the
 * first deployment — and that a clean build's output is not one of them.
 */

import { describe, expect, test } from 'vitest';

import { findDiagnostics } from './check-build.mjs';

/** Verbatim from the failed Render build and from the same build run locally. */
const RENDER_FAILURE = [
  '✓ Generating static pages using 15 workers (4/4) in 166ms',
  'Turbopack build encountered 1 warning:',
  './apps/web/instrumentation.ts:51:5',
  'Warning: A Node.js API is used (process.exit at line: 51) which is not supported in the Edge Runtime.',
  '    Learn more: https://nextjs.org/docs/api-reference/edge-runtime',
  '',
  'Ecmascript file had an error',
  '',
  '  Finalizing page optimization ...',
].join('\n');

const CLEAN_BUILD = [
  '▲ Next.js 16.3.1 (Turbopack)',
  '  Creating an optimized production build ...',
  '✓ Compiled successfully in 946ms',
  '  Running TypeScript ...',
  '  Finished TypeScript in 1926ms ...',
  '  Collecting page data using 15 workers ...',
  '✓ Generating static pages using 15 workers (4/4) in 166ms',
  '  Finalizing page optimization ...',
  '',
  'Route (app)',
  '┌ ƒ /',
  '├ ƒ /api/health',
  '└ ƒ /upload',
  '',
  'ƒ Proxy (Middleware)',
].join('\n');

describe('the production-build gate', () => {
  test('finds the lines that ended the first Render deployment', () => {
    const found = findDiagnostics(RENDER_FAILURE);
    expect(found).toEqual([
      'Turbopack build encountered 1 warning:',
      'Warning: A Node.js API is used (process.exit at line: 51) which is not supported in the Edge Runtime.',
      'Ecmascript file had an error',
    ]);
  });

  test('a warning alone is a failure, not a note', () => {
    expect(findDiagnostics('Turbopack build encountered 2 warnings:')).toHaveLength(1);
    expect(findDiagnostics('Turbopack build encountered 1 error:')).toHaveLength(1);
  });

  test('a compile failure is a failure even when the process exits 0', () => {
    expect(findDiagnostics('Failed to compile.')).toHaveLength(1);
  });

  test('a clean build reports nothing', () => {
    expect(findDiagnostics(CLEAN_BUILD)).toEqual([]);
  });
});
