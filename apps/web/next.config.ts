import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The design system ships TypeScript source; Next compiles it with the app.
  transpilePackages: ['@family-finance/design-system'],
  // 07-SECURITY-PRIVACY.md requires the framework not to advertise itself.
  poweredByHeader: false,
  // `next dev` otherwise writes AGENTS.md and CLAUDE.md into the Next project
  // directory. This repository already has a CLAUDE.md at its root that is the
  // project constitution, and no dependency generates instruction files here.
  // See ADR-0012.
  agentRules: false,
};

export default nextConfig;
