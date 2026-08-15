# ADR-0002: תיעוד גרסאות stable שנמדדו ב־bootstrap

- **Status**: Accepted
- **Date**: 2026-08-15
- **Milestone**: 0
- **Requirement IDs**: —

## הקשר

`05-ARCHITECTURE-DATA.md` מחייב: "אמת גרסאות stable בזמן bootstrap ותעד ADR לסטייה". ה־stack שנקבע שם: Next.js stable, TypeScript strict, App Router, React, Tailwind, Radix/shadcn מותאם RTL, TanStack Query, RHF+Zod, Dexie/IndexedDB, service worker/PWA, Supabase.

ה־stack עצמו אינו מוחלט כאן מחדש — הוא נקבע במסמך הסמכות. ADR זה מתעד את **הגרסאות שנמדדו בפועל** בנקודת ה־bootstrap, כדי שהנעילה ב־Milestone 1 תיעשה מול בסיס ידוע ולא מול זיכרון.

## החלטה

הגרסאות הבאות נמדדו ב־2026-08-15 באמצעות `npm view <pkg> version` מול ה־registry, והן בסיס הייחוס לנעילה ב־Milestone 1:

| חבילה | Latest stable שנמדד |
|---|---|
| next | 16.3.1 |
| react | 19.2.8 |
| typescript | 7.0.2 |
| tailwindcss | 4.3.3 |
| @tanstack/react-query | 5.101.4 |
| react-hook-form | 7.85.0 |
| zod | 4.4.3 |
| dexie | 4.4.5 |
| vitest | 4.1.10 |
| fast-check | 4.9.0 |
| eslint | 10.8.1 |
| prettier | 3.9.6 |
| @playwright/test | 1.62.1 |
| @supabase/supabase-js | 2.112.3 |

Milestone 0 **אינו מתקין** אף אחת מהן (ראה ADR-0003). הנעילה בפועל, כולל בדיקת תאימות בין הגרסאות, היא חלק מ־Milestone 1.

## נקודות שמחייבות תשומת לב ב־Milestone 1

1. **TypeScript 7** הוא מעבר major. יש לאמת שהוא נתמך על ידי ESLint 10, `typescript-eslint`, Next 16 ו־Vitest 4 לפני נעילה. אם לא — ננעל TypeScript 6.x האחרון ויתועד ADR לסטייה.
2. **ESLint 10** מחייב flat config. אין להביא הגדרות `.eslintrc` ישנות.
3. **Tailwind 4** משנה את מודל הקונפיגורציה (CSS-first). ה־tokens מ־`04-DESIGN-SYSTEM.md` יוגדרו לפי המודל החדש.
4. **Zod 4** — `packages/contracts` נבנה מולו מלכתחילה; אין לערבב דפוסי Zod 3.
5. כל סטייה מהטבלה הזו בזמן הנעילה מחייבת שורה מנומקת ב־ADR של Milestone 1.

## השלכות

- חיוביות: הנעילה ב־Milestone 1 מתחילה מנתון מדוד ומתועדך, לא מהשערה.
- שליליות: הטבלה מתיישנת. היא תקפה לתאריך שנרשם בלבד.
- לאימות: `npm ci` + typecheck + build ב־Milestone 1 מול הגרסאות שננעלו.

## תנאי ביטול

ADR של Milestone 1 שנועל גרסאות בפועל מחליף את תפקידו של מסמך זה כבסיס ייחוס.
