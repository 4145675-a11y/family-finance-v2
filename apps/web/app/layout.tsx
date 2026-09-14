import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { ServiceWorkerRegistration } from '../components/service-worker-registration';
import './globals.css';

export const metadata: Metadata = {
  title: 'הכסף שלנו',
  description: 'תמונה אחת ברורה של הבית, העסק והחובות.',
  applicationName: 'הכסף שלנו',
  // The manifest is what makes the product installable. `check:shell` asserts the
  // link reaches the browser on every page.
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'הכסף שלנו',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icon.svg' }],
  },
  formatDetection: {
    // A phone turning an account number into a phone link is not helpful here.
    telephone: false,
  },
  // The household's own data must never be indexed or previewed by anything.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Pinch-zoom must stay available; 03-UX-SPEC.md requires text scaling support.
  maximumScale: 5,
  themeColor: '#1e4f73',
};

/**
 * Root layout.
 *
 * `lang="he"` and `dir="rtl"` are set here and nowhere else: they are the
 * document-level contract that every screen inherits (UX-RTL-001).
 * `apps/web/app/layout.test.ts` asserts both attributes on the rendered markup,
 * and `check:shell` asserts them on what the server actually sends.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
