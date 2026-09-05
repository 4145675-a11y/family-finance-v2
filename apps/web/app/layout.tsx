import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'הכסף שלנו',
  description: 'תמונה אחת ברורה של הבית, העסק והחובות.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Pinch-zoom must stay available; 03-UX-SPEC.md requires text scaling support.
  maximumScale: 5,
};

/**
 * Root layout.
 *
 * `lang="he"` and `dir="rtl"` are set here and nowhere else: they are the document-level
 * contract that every screen inherits (UX-RTL-001). apps/web/app/layout.test.tsx asserts
 * both attributes on the rendered markup.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
