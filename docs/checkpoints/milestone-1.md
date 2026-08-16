# CHECKPOINT — Milestone 1: Repository Foundation

- **Result**: **PASS**
- **Branch**: `milestone-1-repository-foundation` (מסתעף מ־`main` ב־`e7ede12`)
- **Environment**: local (Windows 10, Node v24.18.1, npm 11.16.0) · אין remote, לא בוצע push
- **Date**: 2026-08-16

> **תיקוני follow-up בתוך אותו ענף** (הספירות בטבלה למטה הן של ההרצה האחרונה):
>
> 1. חסימת הטלמטריה המקומית הייתה המלצה מתועדת ולא אכיפה. נוסף `tools/next.mjs` ובדיקת רגרסיה; `ADR-0010` הוחלף על ידי `ADR-0011`.
> 2. הרצת `next dev` לצפייה חזותית חשפה ש־Next 16 יוצר `AGENTS.md` ו־`CLAUDE.md` בתיקיית האפליקציה. נקבע `agentRules: false`, הקבצים נמחקו, ונוספה בדיקת רגרסיה — `ADR-0012`.

## Scope

### הושלם

| דרישת Milestone 1 (`09-MILESTONES.md`) | ראיה |
|---|---|
| Next / TS strict | Next 16.3.1 App Router; `tsconfig.base.json` עם `strict` + 6 בדיקות נוספות; `typecheck` exit 0 |
| package manager נעול | npm 11.16.0 (`ADR-0001`); `save-exact`; `package-lock.json` מחויב; `npm ci` exit 0 |
| formatting | Prettier 3.9.6; `format:check` exit 0 |
| lint | ESLint 9.39.5 flat config + typescript-eslint type-aware; `--max-warnings=0`; exit 0 |
| test runners | Vitest 4.1.10, runner יחיד (`ADR-0009`); 88 בדיקות עוברות |
| CI | `.github/workflows/ci.yml` — 10 steps אמיתיים |
| tokens | `packages/design-system` — palette, spacing, radius, motion, typography, מאומתים ב־57 בדיקות |
| Hebrew RTL shell | `<html lang="he" dir="rtl">` מאומת גם ברכיב וגם ב־HTML הבנוי |
| Build עובר | `next build` exit 0; 3 עמודות static |
| אין feature screens | אין dashboard/onboarding/auth/schema; העמוד מצהיר מפורשות שאין נתונים |

**Requirement IDs שקודמו**: `UX-RTL-001` (חלקי — מעטפת), `UX-A11Y-001` (חלקי — palette, focus, reduced motion). שניהם עודכנו ל־`In progress` במטריצה ובמרשם, עם ציון מפורש של מה שנותר ל־M6.

### לא הושלם, סיבה והשפעה

| פער | סיבה | השפעה |
|---|---|---|
| אין מדידת overflow בפיקסלים ב־360/390/768/1280 | מדידה אמיתית מחייבת דפדפן; Playwright שייך ל־M6, וההתקנה שלו מורידה דפדפנים ל־cache ברמת המשתמש — מחוץ לגבול הפרויקט | נבדק מבנית במקום: `overflow-x: hidden`, מכולה נוזלית עם `max-w`, ואיסור רוחב קבוע inline. **לא נטען** שנמדד ויזואלית |
| `packages/finance-engine` ו־`packages/contracts` לא נוצרו | M5 ו־M3 (`ADR-0007`) | אין. תיקייה ריקה הייתה placeholder |
| גופני Assistant/Heebo אינם מוטמעים | הטמעה עצמית מחייבת קובצי גופן; `next/font/google` מוסיף תלות רשת ל־build | ה־stack מוגדר נכון עם נפילה ל־system sans; ההטמעה שייכת ל־M6 |
| TypeScript 7 / ESLint 10 לא ננעלו | peer conflicts אמיתיים (`ADR-0006`) | נעולות הגרסאות הגבוהות ביותר שתואמות באמת |

### Out-of-scope שלא שונה

מסמכי `01`–`09`, `11` — לא שונו. `10-TRACEABILITY-MATRIX.md` — עודכנו שתי שורות סטטוס בלבד. `CLAUDE.md` — סעיף פקודות בלבד. **`.claude/settings.json` — לא שונה** (ראה "אירוע" למטה). לא נוצרו: schema, migrations, Supabase, auth, מסכי feature.

## Changes

**חדש**: `apps/web/` (app/layout.tsx, app/page.tsx, app/globals.css, app/layout.test.ts, next.config.ts, postcss.config.mjs, tsconfig.json, package.json) · `packages/design-system/` (tokens.ts, contrast.ts, index.ts, tokens.test.ts, contrast.test.ts, tsconfig.json, package.json) · `tsconfig.base.json` · `tsconfig.json` · `eslint.config.mjs` · `vitest.config.ts` · `.prettierrc.json` · `.prettierignore` · `tools/check-built-shell.mjs` · ADR 0006–0010 · checkpoint זה

**שונה**: `package.json` (scripts + 12 devDependencies) · `package-lock.json` · `.gitignore` (next-env.d.ts) · `.gitattributes` (`.claude/settings.json -text`) · `.github/workflows/ci.yml` · `tools/forbidden-scan.test.mjs` (מעבר ל־Vitest) · `docs/COMMANDS.md` · `docs/CI-GATES.md` · `docs/adr/README.md` · `docs/REQUIREMENTS.md` · `10-TRACEABILITY-MATRIX.md` · `MILESTONE_STATUS.md`

**Migrations**: אין.

**ADRs**: 0006 נעילת גרסאות · 0007 מבנה workspaces · 0008 ניגודיות tokens · 0009 runner יחיד · 0010 טלמטריה (הוחלף) · 0011 launcher לחסימת טלמטריה.

## Commands & Evidence

כל השערים הורצו ברצף אחד דרך `npm run verify`, עם `set -o pipefail` ולכידת קוד היציאה האמיתי.

| Gate | Command | Result | Counts / Evidence |
|---|---|---|---|
| Install | `npm ci --ignore-scripts` | **PASS** | exit 0; 0 vulnerabilities; **0 אזהרות peer** |
| Format | `npm run format:check` | **PASS** | exit 0 |
| Typecheck | `npm run typecheck` | **PASS** | exit 0; שורש + 2 workspaces; TS 6.0.3 |
| Lint | `npm run lint` | **PASS** | exit 0; `--max-warnings=0` |
| Unit | `npm run unit` | **PASS** | **124 passed**, 0 failed, **0 skipped**, 6 קבצים |
| Build | `npm run build` | **PASS** | exit 0; Next 16.3.1 דרך `tools/next.mjs`; 3 עמודים static |
| Built-shell | `npm run check:shell` | **PASS** | 8/8 checks על ה־HTML וה־CSS הבנויים |
| Forbidden scan | `npm run scan:forbidden` | **PASS** | 20 קבצים, 10 כללים, 0 errors |
| Traceability | `npm run check:traceability` | **PASS** | 23/23 |
| **Aggregate** | `npm run verify` | **PASS** | **exit 0 אמיתי** |
| Property | — | **NOT RUN** | Milestone 5 |
| Integration/RLS | — | **NOT RUN** | Milestone 2 |
| E2E / axe / visual | — | **NOT RUN** | Milestone 6 |

## Negative verification

| מה נשבר בכוונה | תוצאה |
|---|---|
| `dir="rtl"` → `dir="ltr"` ב־`layout.tsx`, ואז build מחדש | `check:shell` **exit 1**, 3 מ־8 נכשלו. המקור שוחזר ואומת |
| `--color-primary` ב־`globals.css` שונה ב־ספרה אחת מ־`tokens.ts` | `tokens.test.ts` **exit 1** עם כשל ממוקד. שוחזר ואומת |
| `"start": "next start"` הוחזר כ־script שעוקף את ה־launcher | `next-telemetry.test.mjs` **exit 1**. שוחזר ואומת |
| `next dev` הופעל מחדש אחרי `agentRules: false` | שורת `Generated AGENTS.md and CLAUDE.md` **נעלמה מהלוג**; הקבצים לא נוצרו מחדש בזמן הריצה ולא אחרי הכיבוי |
| ESLint 10 מול תוספי Next | 3 אזהרות `ERESOLVE`; ירדנו ל־9.39.5 עד ל־0 אזהרות |
| TypeScript 7 מול typescript-eslint | peer `<6.1.0` — ננעל 6.0.3 |

## Reviews

- **Code**: אין `any`, אין השתקות, אין קוד לא נבדק. type-aware linting פעיל.
- **Financial invariants**: לא רלוונטי — לא נכתב שום חישוב כספי, ולכן לא נטענת עליו טענה.
- **Security/privacy**: `poweredByHeader: false`; טלמטריה מושבתת ב־CI (`ADR-0010`); אין secrets; `npm ci --ignore-scripts`; אימות שה־cache נשאר בתוך הפרויקט.
- **UX/RTL/states**: `lang="he"`/`dir="rtl"` על השורש בלבד; בידוד דו־כיווני לספרות; focus ring; reduced motion; touch target מוגדר ב־tokens. אין מצבי מסך — אין מסכים.

## Forbidden scan findings

0 errors, 0 warnings על 17 קבצים. אין TODO פונקציונלי, אין mock במסלול production, אין בדיקה מדולגת, אין השתקת טיפוסים או lint.

## אירוע שראוי לדיווח: `.claude/settings.json`

במהלך העבודה git סימן את `.claude/settings.json` כ־`M`. בדיקה הראתה ש־blob hash שלו **זהה ל־HEAD** (`f24f554`) — כלומר התוכן לא השתנה כלל. הסיבה: `.gitattributes` שנוסף ב־M0 יצר renormalization ממתין לקובץ שחויב לפניו.

טיפול: נוסף `.claude/settings.json -text` ל־`.gitattributes` כדי שקובץ הגדרות האבטחה לא ינורמל על ידי כלים לעולם, ואז `git add --renormalize` רענן את רשומת ה־index. אומת: hash זהה, staged diff ריק. **הקובץ לא נערך.**

## טלמטריה — מה נסגר ומה נשאר פתוח

`ADR-0010` כיסה את CI בלבד והשאיר את ההרצה המקומית כהמלצה. הפער נסגר ב־`ADR-0011`: `tools/next.mjs` מכריח `NEXT_TELEMETRY_DISABLED=1` בכל פקודת Next של הפרויקט, בכל מערכת הפעלה, ודורס גם ערך שהגיע בירושה. `tools/next-telemetry.test.mjs` (25 בדיקות) סורק כל `package.json` ונכשל אם script מריץ `next` ישירות.

נשאר פתוח ומוצהר: מפתח שמקליד `npx next dev` ידנית בטרמינל עוקף את ה־launcher. זה מחוץ לשליטת המאגר.

לא הורצה `next telemetry disable` ולא נגעתי בשום קובץ ברמת המשתמש — הרישום שנוצר אולי ב־build הראשון נשאר כפי שהוא, וההסרה שלו היא פעולה שהמשתמש מבצע בעצמו אם ירצה.

## Risks & rollback

| סיכון | חומרה | טיפול |
|---|---|---|
| TS 6 / ESLint 9 מפגרים אחרי ה־latest | נמוכה | תנאי ביטול מדיד ב־`ADR-0006` |
| overflow לא נמדד ויזואלית | **בינונית** | מוצהר במפורש כלא־נבדק; M6 חייב Playwright |
| ה־shell מסתמך על גופן מערכת | נמוכה | M6 מטמיע גופנים |
| CI מעולם לא רץ (אין remote) | נמוכה | אותן פקודות רצו מקומית |

**Rollback**: כל העבודה על ענף ייעודי. ביטול מלא: `git checkout main && git branch -D milestone-1-repository-foundation`. `main` נשאר ב־`e7ede12`. אין schema, אין נתונים, אין מצב חיצוני.

## Next proposed milestone

Milestone 2 — Identity & Isolation. **חסום** עד שיסופק פרויקט Supabase: URL ו־anon key ב־`.env.local` בתוך הפרויקט, ו־service role key בסביבת שרת בלבד. אין להעביר סודות בצ׳אט.

## Stop declaration

**לא התחלתי את Milestone 2.** לא נוצר schema, לא נוצרה migration, ולא נוספה תלות ב־Supabase.
