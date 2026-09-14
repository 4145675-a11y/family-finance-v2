import type { MetadataRoute } from 'next';

/**
 * The web app manifest.
 *
 * What it claims is deliberately narrow. The product can be installed and opened
 * like an application, in Hebrew, right to left, with its own icon. It does not
 * claim to work offline as a whole, it does not claim to sync between devices,
 * and it declares no share target or file handler — every one of those would be a
 * promise this build cannot keep, and a promise a financial application must not
 * make lightly.
 *
 * `id` is fixed so an install survives a change of host. `start_url` is the home
 * screen, which is where an installed app should open.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'הכסף שלנו — הבית, העסק והחובות',
    short_name: 'הכסף שלנו',
    description: 'תמונה אחת ברורה של הבית, העסק והחובות. הנתונים נשמרים על המכשיר הזה בלבד.',
    lang: 'he',
    dir: 'rtl',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#faf7f2',
    theme_color: '#1e4f73',
    categories: ['finance', 'productivity'],
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon-maskable.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      { name: 'רישום מהיר', short_name: 'רישום', url: '/entry' },
      { name: 'העלאת מסמך', short_name: 'העלאה', url: '/upload' },
      { name: 'ממתין לאישור', short_name: 'אישורים', url: '/approvals' },
    ],
  };
}
