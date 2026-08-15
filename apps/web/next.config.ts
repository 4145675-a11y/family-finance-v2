import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The design system ships TypeScript source; Next compiles it with the app.
  transpilePackages: ['@family-finance/design-system'],
  // 07-SECURITY-PRIVACY.md requires the framework not to advertise itself.
  poweredByHeader: false,
};

export default nextConfig;
