# CHECKPOINT — Hotfix: the first Render build

- **Result**: **PASS — root causes fixed and proven locally under Render's build condition; not merged, not redeployed**
- **Branch**: `hotfix/render-build-instrumentation` (מסתעף מ־`main` ב־`af38203`)
- **Environment**: local (Windows 11, Node v24.19.0 — `.nvmrc` נועל 24.18.1; npm 11.17.0) · Supabase PostgreSQL 17.6 · CI ubuntu-latest
- **Date**: 2026-09-15
- **ADR**: `ADR-0034` (מתקן את `ADR-0031` ו־`ADR-0033`)

> **מה קרה**: השירות נוצר ב־Render מה־blueprint וקיבל את הכתובת `https://family-finance-web-l2gp.onrender.com`. הפריסה הראשונה נכשלה ב־`npm run build`: `apps/web/instrumentation.ts:51:5 — A Node.js API is used (process.exit) which is not supported in the Edge Runtime … Ecmascript file had an error`.
>
> **שתי סיבות שורש, שתיהן שוחזרו מקומית**: (1) Next מקמפל את `instrumentation.ts` גם ל־Edge — תמיד — והניתוח הסטטי מסרב ל־Node API במקור; מקומית זו הייתה אזהרה, עם `NODE_ENV=production` בסביבה (כמו ב־Render) נוספה שגיאה. (2) `NODE_ENV=production` ב־blueprint הגיע ל־`npm ci`, שהשמיט 389 חבילות devDependencies — TypeScript, Tailwind, PostCSS.
>
> **העיצוב שנבחר** (נמדד, לא הונח): `throw` מ־`register()` **אינו** fail-closed ב־Next 16.3.1 — השרת ממשיך להאזין ועונה 500 לכול, כולל health. לכן: `instrumentation.ts` בלי שום Node API, רק הכרזה בלוג; **הסירוב נאכף בכל בקשה** — `proxy.ts` עונה 503 לכל בקשה כל עוד יש בעיות, `/api/health` עונה `503 misconfigured` בשמות. תהליך עם תצורה פגומה רץ ואינו מגיש דבר; הבדיקה של Render נכשלת וה־deploy אינו מקודם.

## Scope

### הושלם לפי Requirement IDs

| ID | מצב | מה הוכח | ראיה |
|---|---|---|---|
| `PROD-FAILCLOSED-001` | **Verified (מנגנון מתוקן)** | תצורה פגומה (חנות מקומית / בלי URL / בלי origin) → התהליך רץ, `/api/health` `503 misconfigured` בשם ההגדרה, `/` `/accounts` `/api/export/backup.json` `/auth/callback` ונתיב לא קיים → `503 text/plain` בלי markup, הלוג מכריז `refusing to serve` בשם, אף ערך לא הודפס; תצורה תקינה → האפליקציה עונה | `check:fail-closed` **27/27** (נכתב מחדש; מקרה D בסבב השני) |
| `PROD-HOSTING-001` | **Prepared — build מתוקן** | ה־build עם `NODE_ENV=production` נקי: אף אזהרה, אף שגיאה, exit 0; ההתקנה כוללת devDependencies; `NODE_ENV` אינו ב־blueprint | `npm run check:build` PASS (מקומי + CI ב־Linux); `render-blueprint.test.mjs` **39** (+2: `--include=dev`, אין `NODE_ENV`); `npm ci --dry-run` עם `NODE_ENV=production`: `--include=dev` → up to date, בלעדיו → removed 389 |
| `PROD-HEALTH-002` | **מהודק** | `misconfigured` הוא כעת התשובה שהמארח רואה; שמות בלבד — **ולעולם לא ערך**, גולמי או מפוענח, גם במשבצות ה־origin וה־backend (סבב שני) | 27/27; `health.test.ts` 8; `deployment.test.ts` 59 |

### לא הושלם, סיבה והשפעה

- **הפריסה לא הופעלה מחדש** — הוראה מפורשת. הערך שהוזן ל־`FAMILY_FINANCE_APP_ORIGIN` ב־Render עדיין חסר את `-l2gp`; תיקונו הוא פעולת בעלים (runbook, צעד א.4) לפני ה־deploy הבא.
- **לא מוזג ל־`main`** — ממתין לאישור.

### Out-of-scope שלא שונה

חוקי ה־origin ובדיקותיהם (47) — לא נחלשו ולא הוסרו; המיגרציות; `.nvmrc`; הגדרות Supabase; DNS.

## Changes

**קוד** — `apps/web/instrumentation.ts` (בלי Node API; מכריז בלבד); `apps/web/lib/config/startup.ts` (חדש: `decideStartup`, `deploymentVerdict` — פעם אחת לתהליך, `announceStartupVerdict`); `apps/web/proxy.ts` (סירוב 503 לפני כל דבר אחר; אין Node API).

**שערים** — `tools/check-build.mjs` + `.test.mjs` (חדשים: ה־build כמו ב־Render, כל דיאגנוסטיקה = כישלון; 4 בדיקות על השורות המקוריות מ־Render); `tools/edge-safe.test.mjs` (חדש: אין Node API ב־`instrumentation.ts`/`proxy.ts` ובגרף ה־import הסטטי שלהם; הבדיקה נכשלת על הקובץ הישן — אומת); `tools/check-fail-closed.mjs` (נכתב מחדש, 22); `tools/render-blueprint.test.mjs` (+2, שם בדיקה אחד); `package.json` (`check:build`; `verify` בונה דרכו); `.github/workflows/ci.yml` (install `--include=dev`; Build → `check:build`).

**אירוח** — `render.yaml`: `npm ci --ignore-scripts --include=dev && npm run build`; `NODE_ENV` הוסר (עם הסבר).

**תיעוד** — `ADR-0034` (חדש), `ADR-0031`/`ADR-0033` (הערות תיקון), `docs/adr/README.md`, `docs/HOSTING-RENDER.md` (מה קרה, מה תוקן, הכתובת שהוקצתה ומה לתקן בלוח, smoke #8), `docs/COMMANDS.md`, `docs/CI-GATES.md`, `docs/REQUIREMENTS.md`, `10-TRACEABILITY-MATRIX.md`, `MILESTONE_STATUS.md`, checkpoint זה.

**סבב שני** — `apps/web/lib/config/deployment.ts` (חמש הודעות בעיה: שם בלבד, בלי ערך גולמי או מפוענח; הכלל מתועד בראש `readDeploymentConfig`); `deployment.test.ts` (+12), `health.test.ts` (+1), `startup.test.ts` (+1); `tools/check-fail-closed.mjs` (מקרה D: ערך שהודבק ל־origin — 27 בדיקות; כל מקרה סירוב מוודא שהערך אינו מופיע); `ADR-0034` (השלכות), `docs/HOSTING-RENDER.md` (ספירות; "נוהל פריסה מחדש"), `docs/COMMANDS.md`, `docs/CI-GATES.md`, `docs/REQUIREMENTS.md`, `MILESTONE_STATUS.md`, checkpoint זה.

## Commands & Evidence

| Gate | Command | Result | Counts |
|---|---|---|---|
| Focused | `vitest run apps/web/lib/config/startup.test.ts tools/edge-safe.test.mjs tools/check-build.test.mjs tools/render-blueprint.test.mjs` | **PASS** | 7 + 10 + 4 + 39 |
| Negative check | `edge-safe.test.mjs` מול `instrumentation.ts` של `main` | **FAILS as intended** | `uses process.exit` |
| Reproduction | `NODE_ENV=production npm run build` (לפני התיקון) | reproduced | `Turbopack build encountered 1 warning` + `Ecmascript file had an error` |
| Reproduction | `NODE_ENV=production npm ci --ignore-scripts --dry-run` | reproduced | `removed 389 packages`; עם `--include=dev`: `up to date` |
| Measurement | `next start` עם `throw` מ־`register()` | measured | `Failed to prepare server`, `unhandledRejection`, **health 500, / 500, התהליך חי** |
| **Production build** | `npm run check:build` | **PASS** | `NODE_ENV=production`; no warning, no error, exit 0 |
| Fail-closed | `npm run check:fail-closed` | **PASS** | **22/22** (סבב ראשון) → **27/27** (סבב שני) |
| **verify (aggregate)** | `npm run verify` | **PASS** | exit 0: format, typecheck, lint, unit **1923/1923** (59 קבצים; סבב שני: **1937/1937**), property 41/41, check:build, shell 14/14, fail-closed 22/22 (סבב שני: 27/27), client-secrets, no-env-files, rls-coverage 32/32, db:check 17, forbidden 0, traceability 67/67 |
| Integration / RLS | `npm run integration` | **PASS** | 233/233, rollback |
| Production path (live) | `npm run validate:production-path` | **PASS** | 18/18 |
| DB cleanliness | `npm run db:cleanliness` | **PASS** | households 0 · profiles 0 · `@example.test` 0 · audit 0 · RLS 32/32 · guards 2/2 + 2/2 |
| CI | GitHub Actions על הענף | **success** — run #14 על `c51536e` (סבב ראשון); סבב שני: ראו "סבב שני" | — |

## Reviews

- **Security/privacy**: חוקי ה־origin לא נגעו (47 בדיקות עוברות); אין נפילה ל־localhost או לקובץ — התצורה הפגומה **לא מגישה דבר**; ה־503 של ה־proxy אינו מכיל שמות ולא ערכים; health מכיל שמות בלבד; הלוג נבדק (27/27) שאינו מכיל את המפתח, ה־host, ה־ref או ערך שהודבק. הכתובת שהוקצתה מופיעה רק ב־runbook ובצ׳קפוינט, לא בקוד.
- **Code**: `deploymentVerdict` מחושב פעם אחת לתהליך; `proxy.ts` ו־`instrumentation.ts` ללא Node API (בדיקה סטטית + build). `startup.ts` מיובא סטטית מה־proxy (שכבת `middleware` היא `serverOnly` ב־Next, ולכן `server-only` מותר שם) ודינמית מה־instrumentation.
- **Financial invariants**: לא נגעו.
- **UX**: מסך 503 טקסטואלי בלבד — נראה רק כשהתצורה פגומה, ואז המשפחה ממילא אינה אמורה להגיע לשירות (deploy לא מקודם).

## Forbidden scan findings

0.

## Risks, rollback, next proposed action

- **Rollback**: הענף אינו ממוזג; `main` (`af38203`) נשאר כפי שהוא. ב־Render אין deploy מוצלח שיש לחזור אליו.
- **סיכון**: הבדיקה הסטטית עוקבת אחר import סטטי בלבד; import דינמי מאחורי `NEXT_RUNTIME` הוא המקום המותר ל־Node API — אם Next ישנה זאת, `check:build` (ב־CI, Linux, `NODE_ENV=production`) יתפוס לפני פריסה.
- **הבא** (הסדר חשוב — `autoDeployTrigger: checksPass` על `main` אומר שהמיזוג עצמו יפרוס): **קודם** תיקון `FAMILY_FINANCE_APP_ORIGIN` בלוח Render לערך המדויק `https://family-finance-web-l2gp.onrender.com` (ו־`NODE_ENV` לא מוגדר בלוח) → אישור ומיזוג ל־`main` → Render פורס אוטומטית כש־CI של `main` ירוק (או Manual Deploy) → `GET /api/health` → המשך ב־runbook סעיף ב. הנוהל המלא: `docs/HOSTING-RENDER.md`, "נוהל פריסה מחדש".


## סבב שני (2026-09-15) — ביקורת של התיקון מול הדרישות, והידוק אחד

הענף נבדק שוב, commit אחר commit, מול חוזה האבטחה המלא. מה שאומת מחדש ממקור ה־framework עצמו (`node_modules/next`, 16.3.1), לא מזיכרון:

- **למה `instrumentation.ts` מנותח ל־Edge**: Turbopack יוצר endpoint `instrumentation.edge` לצד `instrumentation.nodeJs` בכל פעם שהקובץ קיים (`server/dev/turbopack-utils.js:531-532`; ב־build: `.next/server/instrumentation/middleware-manifest.json` → `server/edge/chunks/…`). הגרסה שנפלטת מכילה `register` מקופל ל־`async function t(){}` — הבדיקה על `NEXT_RUNTIME` הוכרעה בזמן קומפילציה — אבל ניתוח ה־Node-API רץ על **המקור**, לפני הקיפול. אין הגדרה ב־Next שהופכת את ה־instrumentation ל־Node-only; הדפוס המתועד הוא import דינמי מאחורי הבדיקה, וזה מה שנעשה.
- **ה־proxy אינו הגורם**: `proxy.ts` מקומפל כ־middleware ב־Node (`.next/server/middleware-manifest.json` ריק מפונקציות edge); אין `runtime = 'edge'` בשום קובץ.
- **`throw` מ־`register()` אינו כשל עלייה**: `next-server.js` — `this.prepare().catch((err) => console.error('Failed to prepare server', err))`; הדחייה "מטופלת" ב־await של כל בקשה → 500 לכול. המדידה מהסבב הראשון תואמת את המקור.

**פער שנמצא ונסגר.** חמש מהודעות הבעיה ב־`deployment.ts` שיקפו ערך מהסביבה — הערך הגולמי של `FAMILY_FINANCE_DATA_BACKEND`, הערך הגולמי של `FAMILY_FINANCE_APP_ORIGIN` כשאינו URL, וה־origin המפוענח בשלוש הודעות. ההודעות מגיעות ללוג, לגוף `/api/health` **הציבורי** ולהודעת השגיאה הנזרקת — מפתח שהודבק בטעות למשבצת ה־origin היה מתפרסם ע"י הדיווח שנועד לומר שמשהו לא בסדר. נכתבו 14 בדיקות שנכשלו על הקוד הקיים (9 כישלונות נצפו), ההודעות תוקנו לשם־בלבד, והבדיקות עוברות. `check:fail-closed` קיבל מקרה D — ערך שהודבק ל־origin מול השרת הבנוי: 503 לכול, health נוקב ב־`FAMILY_FINANCE_APP_ORIGIN`, הערך אינו מופיע בלוג, ב־health או בתשובות. חוקי ה־origin לא השתנו.

| Gate | Command | Result | Counts |
|---|---|---|---|
| Reproduction (negative) | `instrumentation.ts` של `main` הוחזר זמנית; `vitest run tools/edge-safe.test.mjs` | **FAILS as intended** | 2 failed / 8 passed — `uses process.exit` |
| Reproduction (negative) | אותו קובץ; `npm run check:build` (`NODE_ENV=production`) | **FAILS as intended**, exit 1 | `Turbopack build encountered 1 warning` · `Warning: A Node.js API is used (process.exit at line: 51) which is not supported in the Edge Runtime.` · `Ecmascript file had an error` — השורות של Render, מילה במילה. (ב־Windows `next build` עצמו יצא 0 — האזהרה היא מה שהשער הופך לכישלון) |
| Render's install + build | `npm ci --ignore-scripts --include=dev && npm run build` (הפקודה מ־`render.yaml`, במאגר) | **PASS** | exit 0 / exit 0; devDependencies הותקנו (`typescript` קיים); עץ העבודה לא הופרע |
| Focused | `vitest run deployment.test.ts health.test.ts startup.test.ts` | **PASS** (אחרי כישלון מכוון של 9) | 74/74 |
| Focused | `vitest run tools/edge-safe.test.mjs tools/check-build.test.mjs tools/render-blueprint.test.mjs` | **PASS** | 53/53 |
| **verify (aggregate)** | `npm run verify` | **PASS**, exit 0 | format ✓ · typecheck ✓ · lint ✓ · unit **1937/1937** (59) · property 41/41 · check:build **clean** · shell 14/14 · fail-closed **27/27** · client-secrets ✓ · no-env-files ✓ · rls-coverage 32/32 · db:check 17 · forbidden 0 · traceability 67/67 |
| Integration / RLS | `npm run integration` | **PASS** | 233/233 (8 קבצים) |
| DB cleanliness (after integration) | `npm run db:cleanliness` | **PASS** | households 0 · profiles 0 · `@example.test` 0 · audit 0 · RLS 32/32 · guards 2/2 + 2/2 |
| Production path (live) | `npm run validate:production-path` | **PASS** | 18/18 |
| DB cleanliness (after validation) | `npm run db:cleanliness` | **PASS** | זהה — נקי ושמור |
| CI (סבב ראשון) | GitHub Actions run #14 על `c51536e` | **success** | — |
| CI (סבב שני) | GitHub Actions על ה־commits של הסבב השני | ראו סוף המסמך | — |

**סודות**: אף ערך של משתנה סביבה, מפתח, URL עם credentials, cookie או סכום כספי לא הודפס, לא נקרא בקול ולא נכנס לקובץ במאגר. `.env.local`, `apps/web/.env.local`, `.env.integration.local` — ignored (`.gitignore:25`), לא במעקב (`check:no-env-files` PASS). לוגי הריצה נכתבו ל־`.tmp/` (ignored) ונמחקו בסוף.

**מה לא השתנה**: Render, Supabase, DNS — לא נגעו. לא בוצע deploy. לא מוזג. לא יובאו נתונים.

## Stop declaration

לא מוזג. לא הופעל deploy. לא שונתה הגדרה חיצונית.
