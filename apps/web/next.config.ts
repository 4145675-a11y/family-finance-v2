import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The workspace packages ship TypeScript source rather than a build artifact, so
  // Next compiles them with the app. Without this their `.js` import specifiers —
  // which resolve to `.ts` files — are not found by the bundler.
  transpilePackages: [
    '@family-finance/design-system',
    '@family-finance/contracts',
    '@family-finance/finance-engine',
    '@family-finance/document-import',
    '@family-finance/local-store',
  ],
  // 07-SECURITY-PRIVACY.md requires the framework not to advertise itself.
  poweredByHeader: false,
  // `next dev` otherwise writes AGENTS.md and CLAUDE.md into the Next project
  // directory. This repository already has a CLAUDE.md at its root that is the
  // project constitution, and no dependency generates instruction files here.
  // See ADR-0012.
  agentRules: false,
};

export default nextConfig;
