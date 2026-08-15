import js from '@eslint/js';
import next from 'eslint-config-next/core-web-vitals';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Flat config (ESLint 9).
 *
 * Ordering matters: later entries win. Project rules come last so they are not
 * silently relaxed by a preset.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '.npm-cache/**',
      'apps/web/next-env.d.ts',
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommended,

  // Next's rules describe a Next application, so they apply to the app and nowhere else.
  // Left unscoped they also run against packages/ and tools/, where they report on a
  // `pages/` directory that legitimately does not exist.
  ...next.map((config) => ({
    ...config,
    files: ['apps/web/**/*.{js,jsx,mjs,ts,tsx}'],
  })),
  {
    name: 'project/next-root',
    files: ['apps/web/**/*.{js,jsx,mjs,ts,tsx}'],
    settings: { next: { rootDir: 'apps/web' } },
  },

  {
    name: 'project/typescript',
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A discarded promise in a money flow is a silent data-loss bug.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // `any` erases exactly the guarantees strict mode was enabled for.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // CLAUDE.md: an empty catch is forbidden. This catches it at lint time too.
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },

  {
    name: 'project/node-tooling',
    files: ['tools/**/*.mjs', '**/*.config.{js,mjs,ts}'],
    languageOptions: {
      globals: globals.node,
    },
  },

  {
    name: 'project/no-suppression',
    rules: {
      // The forbidden-artifact scan blocks these at the repository level; failing here
      // as well gives the author the message in their editor instead of in CI.
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-nocheck': true, 'ts-expect-error': 'allow-with-description' },
      ],
    },
  },
);
