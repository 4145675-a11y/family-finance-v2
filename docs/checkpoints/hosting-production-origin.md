# CHECKPOINT — Hosting & Production-Origin

- **Result**: **PASS — prepared and verified locally; nothing deployed, nothing external changed**
- **Branch**: `hosting-production-origin` (מסתעף מ־`main` ב־`7b56dd1`, ה־merge של Production Data Layer)
- **Environment**: local (Windows 11, Node v24.19.0 — `.nvmrc` נועל 24.18.1, פער מתועד; npm 11.17.0) · Supabase PostgreSQL 17.6
- **Date**: 2026-09-15
- **ADR**: `ADR-0033`

> **מה הושג**: המאגר יודע היכן הוא ירוץ ומה נדרש כדי שזה יקרה, ומוכיח זאת בלי לפרוס. `render.yaml` מתאר Web Service אחד ב־Render — אותו install ו־build כמו CI, Node של `.nvmrc`, `start` שנקשר ל־`$PORT`, ובריאות שפירושה "מוכן באמת" (תצורה, מסד, סכמה, מפתח). חוזה ה־origin נסגר: פריסה מארחת חייבת להצהיר origin אחד, ומכל דבר שנגזר ממנו — cookies של session, הפניות של קישורי auth — שום דבר אינו נגזר מ־Host של הבקשה. קישורי הזמנה ושחזור סיסמה נפדים ב־`/auth/callback` ומובילים למסך קביעת סיסמה; ההוכחה החיה שותלת token למשתמש סינתטי ופודה אותו דרך השרת הבנוי.
>
> **מה לא נעשה, בכוונה**: לא נוצר שירות ב־Render, לא הוזן ערך בשום פלטפורמה, לא שונתה הגדרה ב־Supabase (Site URL, Redirect URLs, תבניות אימייל), לא חובר דומיין, לא הוצא כסף, לא מוזג ל־`main`. כל אלה — פעולות בעלים, צעד אחד בכל פעם, ב־`docs/HOSTING-RENDER.md`.

## Scope

### הושלם לפי Requirement IDs

| ID | מצב | מה הוכח | ראיה |
|---|---|---|---|
| `PROD-ORIGIN-001` | **Verified** | origin = scheme+host+port בלבד; https; לא Supabase; לא IP; **חובה** בייצור עם המסד (אין ברירת מחדל למארח); שתי איות ה־origin חייבות להסכים | `deployment.test.ts` **47**; `check:fail-closed` **11/11** (חדש: "no stated origin refuses to start"); ריצה חיה: `/auth/callback` מפנה ל־`http://localhost:3133/login` כשהבקשה הגיעה ל־`127.0.0.1` |
| `PROD-HOSTING-001` | **Prepared** (לא נפרס) | `render.yaml`: Node web service, Frankfurt, `plan: free`, `branch: main`, `autoDeployTrigger: checksPass`, `healthCheckPath: /api/health`, שמות בלבד ל־3 הערכים של הבעלים; Node = `.nvmrc`; build = CI | `render-blueprint.test.mjs` **38** (כולל פרסר שמסרב ל־YAML שאינו פשוט); `npm run start` עם `PORT=3177` האזין על `0.0.0.0` וענה `200 ready` |
| `PROD-COOKIE-001` | **Verified** | `HttpOnly; SameSite=Lax; Path=/` תמיד; `Secure` על כל origin https — בלקוח השרת וב־proxy | `cookies.test.ts` **3**; ריצה חיה: Set-Cookie על origin http בלי Secure, על origin `https://finance.example.test` (מופע שני של השרת) עם Secure |
| `PROD-AUTHURL-001` | **Verified** (תבניות אימייל — פעולת בעלים) | `code`/`token_hash` נפדים ל־session; `next` רק נתיב באתר (לא `//`, לא `/\`, לא scheme, לא בקרה); כישלון → `/login?link=invalid` בלי סיבה; `/auth/set-password` דורש session ומינימום 10 תווים; `/auth/forgot` עונה זהה לכל כתובת | `redirect.test.ts` **25**; ריצה חיה **18/18**: token שנשתל ב־`auth.one_time_tokens` נפדה, נצרך פעם אחת, `next=https://evil.example/steal` → `/`, סיסמה חדשה דרך הטופס (ללא JS) נכנסת והישנה נדחית |
| `PROD-HEALTH-002` | הורחב | מדד חמישי: `credentials` — `accepted` / `rejected` (מפתח שגוי) / `unknown` | `health.test.ts` **7**; ריצה חיה `credentials: accepted` |

### לא הושלם, סיבה והשפעה

- **הפריסה עצמה** — לא בוצעה: יצירת שירות, הזנת ערכים, DNS ו־Supabase Auth הן פעולות חיצוניות של הבעלים (תנאי עצירה מפורש). ההשפעה: המשפחה עדיין אינה מגיעה לאפליקציה מדומיין.
- **`/auth/forgot` לא נשלח בפועל** — הריצה החיה אינה מפעילה `resetPasswordForEmail` כדי לא לשלוח אימייל לכתובת `@example.test` דרך ה־SMTP המובנה של Supabase (bounces מסכנים את הפרויקט). המסך והפעולה מכוסים ביחידה ובריצה חיה עד לשליחה; השליחה עצמה — בהליכה הידנית אחרי הפריסה.
- **CSP/HSTS** — נדחה למילסטון הקשחה; דורש בדיקה מול המוצר הרץ ב־https אמיתי.
- **Free מול Starter** — `plan: free` בקובץ. שדרוג = החלטת הוצאה של הבעלים, בלוח Render.

### Out-of-scope שלא שונה

מסמכי החוקה `01`–`09`, `11`; המיגרציות (אין מיגרציה חדשה במילסטון הזה — הסכמה לא השתנתה); `.nvmrc`; `main`; הגדרות Supabase; DNS.

## Changes

**אירוח** — `render.yaml` (חדש); `package.json` (`start`); `tools/render-blueprint.mjs` + `.test.mjs` (חדשים); `apps/web/next.config.ts` (`@family-finance/household-store` ב־`transpilePackages`); `apps/web/package.json` + `package-lock.json` (התלות המפורשת ב־household-store — נפתרה קודם רק דרך hoisting).

**חוזה origin ובריאות** — `lib/config/deployment.ts` (origin בלבד; לא Supabase; שני האיותים מסכימים; `supabaseProjectRefOf`; `secureCookies`; **חובה בייצור עם המסד**; regex עם נקודות מוברחות); `lib/health.ts` (`credentials`); `tools/check-fail-closed.mjs` (+2).

**Cookies וקישורי auth** — `lib/auth/cookies.ts` (חדש) ← `lib/supabase/server.ts`, `proxy.ts`; `lib/auth/redirect.ts` (חדש: `safeNextPath`, `absoluteOnOrigin`, `decideAuthLink`); `lib/auth/supabase.ts` (`updatePassword`, `requestPasswordReset`, `redeemCode`, `redeemTokenHash`); `lib/actions/auth.ts` (`setPasswordAction`, `requestPasswordResetAction`); `app/auth/callback/route.ts`, `app/auth/set-password/page.tsx`, `app/auth/forgot/page.tsx` (חדשים); `app/login/page.tsx` (קישור "שכחתי סיסמה", הודעת קישור לא תקף); `lib/copy/security.ts`.

**אימות חי** — `supabase/validation/production-path.validation.ts`: +5 בדיקות (18); `submitForm` (טופס server action ללא JS); `plantRecoveryToken`; מופע שרת שני ל־origin https; ניקוי כולל `auth.one_time_tokens`.

**תיעוד** — `ADR-0033`, `docs/HOSTING-RENDER.md` (חדש), checkpoint זה, `docs/REQUIREMENTS.md` (+4), `10-TRACEABILITY-MATRIX.md` (+4), `docs/adr/README.md`, `docs/COMMANDS.md`, `docs/CI-GATES.md`, `docs/PRODUCTION-DATA-LAYER.md`, `MILESTONE_STATUS.md`, `apps/web/.env.example`.

## Commands & Evidence

| Gate | Command | Result | Counts |
|---|---|---|---|
| Format | `npm run format:check` | **PASS** | exit 0 |
| Typecheck | `npm run typecheck` | **PASS** | שורש + 8 workspaces |
| Lint | `npm run lint` | **PASS** | `--max-warnings=0` |
| Unit | `npm run unit` | **PASS** | **1898 passed**, 56 קבצים, 0 מדולגות (+40: blueprint 38, deployment +1, health +1) |
| Property | `npm run property` | **PASS** | **41/41** |
| Build | `npm run build` | **PASS** | כולל `/auth/callback`, `/auth/set-password`, `/auth/forgot`, `ƒ Proxy` |
| Built-shell | `npm run check:shell` | **PASS** | 14/14 מול השרת הרץ |
| Fail-closed | `npm run check:fail-closed` | **PASS** | **11/11** (+2: origin חסר) |
| Client-secret boundary | `npm run check:client-secrets` | **PASS** | 21 קובצי bundle, 0 ממצאים |
| Env-file gate | `npm run check:no-env-files` | **PASS** | 0 |
| RLS coverage | `npm run check:rls-coverage` | **PASS** | 32/32 |
| Manual bundle | `npm run db:check` | **PASS** | 17 מיגרציות, תואם |
| Forbidden scan | `npm run scan:forbidden` | **PASS** | 0 |
| Traceability | `npm run check:traceability` | **PASS** | **67/67** |
| **verify (aggregate)** | `npm run verify` | **PASS** | exit 0, 2026-09-15 |
| Integration / RLS | `npm run integration` | **PASS** | **233/233**, 8 קבצים, rollback |
| **Production path (live)** | `npm run build && npm run validate:production-path` | **PASS** | **18/18** (+5), 30s; שני מופעי שרת (origin http ו־https) |
| DB cleanliness | `npm run db:cleanliness` | **PASS** | households 0 · profiles 0 · `@example.test` 0 · audit 0 · RLS 32/32 · guards 2/2 + 2/2 — אחרי הריצה החיה ואחרי האינטגרציה |
| Start on `$PORT` | `PORT=3177 npm run start` (ידני, env מפורש) | **PASS** | `0.0.0.0:3177` + `[::]:3177` מאזינים; `/api/health` 200 ready |

### מה הריצה החיה מוכיחה על קישורי auth (חדש)

1. `/auth/callback` ללא פרמטרים → `303 → <origin>/login`, בלי cookie.
2. `token_hash` בדוי + `next=https://evil.example` → `303 → <origin>/login?link=invalid`, בלי cookie; `/login?link=invalid` מציג "הקישור הזה כבר לא תקף".
3. token אמיתי (נשתל ב־`auth.one_time_tokens` + `recovery_sent_at`) עם `next=https://evil.example/steal` → `303 → <origin>/` ו־Set-Cookie `sb-…-auth-token…; Path=/; HttpOnly; SameSite=lax`. אותו token שוב → `link=invalid` (נצרך).
4. token עם `next=%2Fauth%2Fset-password` (הצורה של תבנית האימייל) → `303 → <origin>/auth/set-password`; המסך נטען עם ה־session, אינו מכיל את ה־token.
5. טופס קביעת סיסמה (POST multipart ללא JS, `Origin` = Host): "short" → 200 עם "10 תווים"; סיסמה תקינה → `303 → /`; כניסה עם הישנה נכשלת, עם החדשה מצליחה.
6. מופע שרת שני עם `FAMILY_FINANCE_APP_ORIGIN=https://finance.example.test`: אותו token flow → `303 → https://finance.example.test/auth/set-password`, Set-Cookie עם **Secure**.

## Reviews

- **Code**: הפרסר ב־`render-blueprint.mjs` מקבל תת־קבוצה קטנה ומסרב לכל השאר (13 בדיקות סירוב) — blueprint שדורש anchors/flow הופך לדבר שסוקרים. `submitForm` בריצה החיה מדמה דפדפן ללא JS: הפורמט (`$ACTION_REF_1`, `$ACTION_KEY`) נלקח מה־HTML המרונדר, לא מוקשח בקוד.
- **Financial invariants**: לא נגעו. אין מיגרציה; אין שינוי בחישוב.
- **Security/privacy**: הפניות נבנות מ־`FAMILY_FINANCE_APP_ORIGIN`, לעולם לא מ־Host; `safeNextPath` דוחה `//`, `/\`, תווי בקרה ונקודתיים בנתיב; כישלון פדיון אינו אומר למה; `/auth/forgot` עונה זהה לכל כתובת; `render.yaml` אינו יכול להכיל ערך שנראה כסוד (בדיקה); לוג הריצה החיה נבדק שאינו מכיל מפתח, URL, סיסמאות (כולל החדשה) או שם משק. `credentials: rejected` בבריאות אינו חושף איזה מפתח — רק שהתקבל או לא.
- **UX/RTL/states**: שלושה מסכים חדשים באותה שפה ורכיבים (`Card`, `ActionForm`, `TextField`, `Notice`); הודעת קישור לא תקף מציעה פעולה ("אפשר לבקש קישור חדש"); `check:shell` 14/14.

## Forbidden scan findings

0. אין TODO/FIXME/mock/stub/skip/only/@ts-ignore/lint-disable/empty-catch/hard-coded-success. ה־`try/catch` ב־`plantRecoveryToken` ו־`cleanup` מבצע rollback וזורק מחדש.

## אירועים במהלך המילסטון

1. **`FAMILY_FINANCE_APP_ORIGIN` לא היה חובה בייצור.** תהליך עם `NODE_ENV=production` + `supabase` וללא origin היה עולה עם ברירת המחדל `http://localhost:3100` — cookies בלי Secure והפניות ל־localhost על שרת. נמצא בעת בדיקת `npm run start`; תוקן ב־`deployment.ts` + בדיקת יחידה + 2 בדיקות fail-closed.
2. **`SUPABASE_HOST` עם נקודות לא מוברחות** (`/^([a-z]{20}).supabase.co$/`) — היה מקבל `abcdefghijklmnopqrstxsupabasexco`. תוקן + 3 בדיקות לדמויי־host.
3. **`@family-finance/household-store` לא הוצהר כתלות של `apps/web`** — עבד רק דרך hoisting של ה־workspace. הוצהר ב־`package.json` וב־lock; `npm ci --dry-run` "up to date".
4. **POST של server action עם `Origin` שאינו Host → 500.** בדיקת ה־CSRF של Next משווה Origin ל־Host; הריצה החיה שולחת `Origin: http://127.0.0.1:<port>`. תועד ב־`submitForm`.

## Risks, rollback, next proposed milestone

- **Rollback**: הענף אינו ממוזג. `main` אינו מכיל `render.yaml`; שום שירות אינו מצביע על המאגר. מחיקת הענף = ביטול מלא.
- **סיכונים**: Free plan נרדם — כניסה ראשונה איטית; אם ה־`onrender.com` שהוקצה שונה מהשם הצפוי, `FAMILY_FINANCE_APP_ORIGIN` דורש תיקון אחד ו־redeploy (מתועד בצעד א.4). `autoDeployTrigger: checksPass` מסתמך על GitHub checks — אם CI לא רץ על `main`, לא יהיה deploy אוטומטי (ניתן להפעיל ידנית).
- **הבא, אחרי אישור ומיזוג**: פעולות הבעלים ב־`docs/HOSTING-RENDER.md` סעיפים א–ג (יצירת השירות, Supabase Auth, המשתמש הראשון), ואז הליכה ידנית בדפדפן (smoke 1–7). דומיין (ד) — רק אחרי ש־onrender.com עובד.

## Stop declaration

לא התחלתי את ה־Milestone הבא. לא מוזג. לא נפרס. לא שונתה הגדרה חיצונית.
