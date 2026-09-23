# Hosting on Render — runbook

מדריך תפעולי ל־`ADR-0033`. מה המאגר הכין, מה **הבעלים** עושה בעצמו, ומה נדחה במפורש.
משלים את `docs/PRODUCTION-DATA-LAYER.md` (המסד וה־backend) — כאן: המקום שבו התהליך רץ,
ה־origin שהמשפחה מגיעה אליו, ו־Supabase Auth מול הדומיין הזה.

> **מצב (2026-09-15)**: השירות **נוצר** ב־Render מה־blueprint וקיבל את הכתובת
> `https://family-finance-web-l2gp.onrender.com`. **הפריסה הראשונה נכשלה ב־build** (ראו
> "הפריסה הראשונה — מה קרה"); התיקון בענף `hotfix/render-build-instrumentation`, ממתין
> לאישור ולמיזוג. אף הגדרה ב־Supabase לא שונתה, אף דומיין לא חובר. כל פעולה בסעיף
> "פעולות הבעלים" היא פעולה חיצונית שדורשת אתכם.

## הפריסה הראשונה — מה קרה, ומה תוקן

| | |
|---|---|
| **תסמין** | `npm run build` ב־Render נכשל: `apps/web/instrumentation.ts:51:5 — A Node.js API is used (process.exit) which is not supported in the Edge Runtime`, ואז `Ecmascript file had an error` |
| **סיבת שורש 1** | Next מקמפל את `instrumentation.ts` גם ל־Edge runtime — תמיד — והניתוח הסטטי מסרב ל־Node API במקור, גם כשהשורה מתה בגרסת ה־Edge. מקומית זו הייתה *אזהרה* ו־exit 0; עם `NODE_ENV=production` בסביבה, כמו ב־Render, ה־build נכשל |
| **סיבת שורש 2** | `NODE_ENV=production` ב־blueprint הגיע גם ל־`npm ci`, ש**משמיט devDependencies** במצב הזה (389 חבילות) — TypeScript, Tailwind, PostCSS. ה־build לא יכול היה להצליח גם בלי 1 |
| **התיקון** | `ADR-0034`: אין Node API ב־`instrumentation.ts`; תהליך עם תצורה פגומה **רץ ומסרב** — `503` לכל בקשה דרך ה־proxy, `/api/health` → `503 misconfigured` עם שמות ההגדרות; הבדיקה של Render נכשלת וה־deploy אינו מקודם. `render.yaml`: `npm ci --ignore-scripts --include=dev`, ובלי `NODE_ENV`. שערים חדשים: `npm run check:build` (ה־build כמו ב־Render, כל אזהרה = כישלון; גם ב־CI), `tools/edge-safe.test.mjs` |
| **מה עליכם לתקן ב־Render** | הערך שהוזן ל־`FAMILY_FINANCE_APP_ORIGIN` השמיט את הסיומת `-l2gp`. הערך הנכון הוא ה־origin המדויק שהוקצה: `https://family-finance-web-l2gp.onrender.com` (בלי `/` בסוף). ראו צעד א.4 |
| **נוהל פריסה מחדש (בטוח)** | **הסדר חשוב**: `autoDeployTrigger: checksPass` על `main` אומר שהמיזוג עצמו יפרוס. (1) בלוח Render → Environment: תקנו `FAMILY_FINANCE_APP_ORIGIN` ל־`https://family-finance-web-l2gp.onrender.com` **בדיוק** — https, עם `-l2gp`, בלי `/` בסוף; ודאו ש־`NODE_ENV` **אינו** מופיע בלוח; אל תשנו דבר אחר. אם הלוח מציע שמירה בלי פריסה — בחרו בה; אם פריסה מתחילה בכל זאת על `main` הישן היא תיכשל ב־build כמו קודם, ללא תעבורה וללא נזק. (2) ודאו ש־CI ירוק על `hotfix/render-build-instrumentation`, ומזגו ל־`main` (fast-forward). (3) Render פורס אוטומטית כש־CI של `main` ירוק; אחרת Manual Deploy → Deploy latest commit. (4) בלוג: `[family-finance] starting: env=production backend=supabase origin=https://family-finance-web-l2gp.onrender.com ai=off`. אם במקום זה `[family-finance] refusing to serve.` — השורות שאחריה מונות **שמות**; תקנו ב־Environment ופרסו שוב. (5) `GET https://family-finance-web-l2gp.onrender.com/api/health` → `200`, `"backend":"supabase"`, `"credentials":"accepted"`, `"readiness":"ready"`. `503 misconfigured` = תצורה (שמות בתשובה); `503 not_ready` = המסד/המפתח/הסכמה (סעיף ב). (6) המשיכו ב־smoke, סעיף ב, כולל #8 (בדיקת השלילה) |

## מה הוכן במאגר

| רכיב | קובץ | מה הוא קובע | איך זה מוכח |
|---|---|---|---|
| Blueprint | `render.yaml` | Web Service, runtime Node, Frankfurt, `plan: free`, `branch: main`, deploy רק אחרי ש־CI ירוק (`autoDeployTrigger: checksPass`), `healthCheckPath: /api/health` | `tools/render-blueprint.test.mjs` — 38 בדיקות: מבנה, Node = `.nvmrc`, build = CI, `start` קיים, כל משתנה נדרש מוצהר, **אף ערך שנראה כסוד** |
| Node | `NODE_VERSION=24.18.1` ב־blueprint | הגרסה ש־`.nvmrc` נועל ו־CI מריץ | הבדיקה משווה את שלושת המקומות |
| Build | `npm ci --ignore-scripts --include=dev && npm run build` | אותה התקנה ואותו build כמו CI; devDependencies במפורש (ה־build צריך אותן) | `npm run check:build` — ה־build עם `NODE_ENV=production` כמו ב־Render, כל דיאגנוסטיקה של Turbopack = כישלון; רץ ב־`verify` וב־CI |
| Start | `npm run start` → `next start` דרך `tools/next.mjs` | נקשר ל־`0.0.0.0:$PORT` (Render מגדיר `PORT`); טלמטריה כבויה | הורץ מקומית עם `PORT=3177` |
| Health | `/api/health` | `200` רק כשהתצורה מלאה, המסד נגיש, הסכמה תואמת **והמפתח מתקבל** (`credentials: accepted`); `503 misconfigured` עם **שמות** ההגדרות כשהתצורה פגומה | `health.test.ts` 8, `check:fail-closed` 27/27, ריצה חיה |
| סירוב (`ADR-0034`) | `proxy.ts` + `lib/config/startup.ts` | תצורה פגומה → התהליך רץ, **כל** בקשה עונה `503` טקסט, שום דבר מהאפליקציה אינו רץ; הלוג מכריז `refusing to serve` בשמות | `check:fail-closed` 27/27: `/`, `/accounts`, `/api/export/backup.json`, `/auth/callback`, נתיב לא קיים — כולם 503; ערך שהודבק ל־origin אינו מופיע בלוג ולא ב־health |
| Origin | `FAMILY_FINANCE_APP_ORIGIN` | origin בלבד (scheme+host+port), https, לא Supabase, לא IP; **חובה** בייצור עם המסד | `deployment.test.ts` 47; fail-closed "no stated origin refuses to start" |
| Cookies | `lib/auth/cookies.ts` | `HttpOnly; SameSite=Lax; Path=/` תמיד; `Secure` על כל origin https | `cookies.test.ts`; ריצה חיה על origin http ועל origin https |
| קישורי auth | `/auth/callback`, `/auth/set-password`, `/auth/forgot` | קישור הזמנה/שחזור נפדה ל־session; `next` רק נתיב באתר; כישלון → `/login?link=invalid` | `redirect.test.ts` 25; ריצה חיה: token נפדה, הופך session, נצרך פעם אחת |

### משתני הסביבה ב־Render

| שם | ב־blueprint | ערך |
|---|---|---|
| `NODE_VERSION` | ערך | `24.18.1` |
| `NODE_ENV` | **לא מוגדר** | `next build`/`next start` מגדירים `production` בעצמם. בסביבה הוא מגיע גם ל־`npm ci` ומשמיט devDependencies — זו הייתה הפריסה הראשונה. **אל תוסיפו אותו בלוח** |
| `NEXT_TELEMETRY_DISABLED` | ערך | `1` |
| `FAMILY_FINANCE_DATA_BACKEND` | ערך | `supabase` — מוכתב מהקוד, לא מהלוח |
| `FAMILY_FINANCE_APP_ORIGIN` | `sync: false` — **אתם מזינים** | ה־origin ה־https. בשלב א׳ `https://<service>.onrender.com`; אחרי חיבור דומיין — הדומיין |
| `NEXT_PUBLIC_SUPABASE_URL` | `sync: false` — **אתם מזינים** | Project Settings → API → Project URL (`https://<ref>.supabase.co`, בלי נתיב) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sync: false` — **אתם מזינים** | Project Settings → API Keys → publishable (`sb_publishable_…`). **לא** secret key |

**אין סוד ב־Render.** לאפליקציה אין service-role ואין `SUPABASE_DB_URL`. אם מסך ה־Render מבקש מכם ערך נוסף — עצרו; זו אינה התצורה שבמאגר.

## פעולות הבעלים — לפי הסדר, צעד אחד בכל פעם

כל צעד ניתן לביטול לפני הבא. אל תדלגו על בדיקת הבריאות.

### א. ליצור את השירות מה־Blueprint

1. Render → **New → Blueprint** → בחרו את המאגר (branch `main`). Render קורא `render.yaml`.
2. במסך האישור Render יבקש את שלושת הערכים המסומנים `sync: false`. הזינו:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — מה־Supabase dashboard.
   - `FAMILY_FINANCE_APP_ORIGIN` — עדיין אין לכם את הכתובת. Render מקצה `https://<name>.onrender.com` לפי שם השירות (`family-finance-web` ← `https://family-finance-web.onrender.com`, או עם סיומת אם השם תפוס). אם הכתובת אינה ידועה בשלב הזה — הזינו `https://family-finance-web.onrender.com`, ותקנו בצעד 4 אם Render הקצה שם אחר.
3. **Apply.** ה־deploy הראשון ירוץ. תוצאה צפויה: build מצליח, ואז אחת משתיים:
   - `/api/health` → `200 … "readiness":"ready"` — השירות חי ומקבל תעבורה.
   - ה־deploy נכשל ב־health check — פתחו את ה־logs; השורה `[family-finance] refusing to serve.` מונה **שמות** של הגדרות פגומות (לעולם לא ערכים). תקנו ב־Environment ו־**Manual Deploy**.
   - ה־deploy נכשל ב־build — פתחו את ה־logs. build שעובר `npm run check:build` ב־CI אמור לעבור גם כאן; אם לא, ההבדל הוא בסביבה (למשל `NODE_ENV` שנוסף בלוח).
4. פתחו `https://<הכתובת>/api/health` בדפדפן. ודאו `"backend":"supabase"`, `"credentials":"accepted"`, `"readiness":"ready"`. אם הכתובת שונה ממה שהזנתם ב־`FAMILY_FINANCE_APP_ORIGIN` — עדכנו את המשתנה ל־origin המדויק (בלי `/` בסוף) ו־Manual Deploy. **במקרה שלכם**: Render הקצה `https://family-finance-web-l2gp.onrender.com`, והערך שהוזן השמיט את `-l2gp` — תקנו לערך המדויק הזה.

**Free plan**: השירות נרדם אחרי ~15 דקות ללא תעבורה; הבקשה הראשונה אחר כך איטית (עשרות שניות). זה מקובל ל־smoke; ל־שימוש יומיומי — שדרוג ל־Starter הוא **החלטת הוצאה שלכם**, ומבוצע בלוח Render (לא בקובץ).

### ב. Supabase Auth מול ה־origin החדש (Authentication → URL Configuration)

**שום דבר מזה לא שונה על ידי המאגר.** ההגדרות האלה קובעות לאן קישורי האימייל חוזרים.

1. **Site URL**: ה־origin המדויק, `https://<הכתובת>` (בלי נתיב).
2. **Redirect URLs** — הוסיפו:
   - `https://<הכתובת>/**`
   - `http://localhost:3100/**` (לאימות מקומי מול אותו פרויקט; אפשר להסיר אחר כך)
3. **Email templates** (Authentication → Email Templates). האפליקציה פודה קישורים ב־`/auth/callback` עם `token_hash` — הצורה שאינה תלויה ב־PKCE ופועלת גם מאימייל שנפתח בדפדפן אחר. עדכנו את ה־`href` בשתי התבניות:
   - **Invite user**:
     `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=%2Fauth%2Fset-password`
   - **Reset password**:
     `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=%2Fauth%2Fset-password`
   - (אופציונלי) **Magic link**: `…&type=magiclink&next=%2F`. **Confirm signup** לא רלוונטי — אין הרשמה עצמית.
4. **Confirm email**: השאירו **מופעל**. **Enable sign ups**: מומלץ **לכבות** — במוצר הזה משתמשים נוצרים רק על ידכם (Invite), והצטרפות למשק בית היא בקוד הזמנה נפרד (`/join`).

### ג. המשתמשים הראשונים (Authentication → Users)

1. **Invite user** עם כתובת האימייל שלכם. האימייל שמגיע מוביל ל־`/auth/callback` → `/auth/set-password` → בחירת סיסמה (10 תווים לפחות) → מסך הבית → `/setup` להקמת משק הבית.
2. בן/בת הזוג: Invite user ב־Supabase (זהות) **וגם** קוד הזמנה למשק הבית מ־`/account` (חברות). שני השלבים נדרשים — זהות אינה חברות (`ADR-0014`).
3. שכחתם סיסמה: `/auth/forgot` באתר, או **Send password recovery** בלוח Supabase.

### ד. דומיין משפחתי (אופציונלי, אחרי שהכול עובד על onrender.com)

1. Render → Settings → Custom Domains → הוסיפו את הדומיין; Render מציג רשומת DNS (CNAME/ALIAS) להוספה אצל רשם הדומיין. TLS מונפק אוטומטית.
2. אחרי שהדומיין עונה ב־https: `FAMILY_FINANCE_APP_ORIGIN` → `https://<הדומיין>`; Manual Deploy; **ואז** Site URL + Redirect URLs ב־Supabase לדומיין החדש. השאירו את `onrender.com` ב־Redirect URLs עד שווידאתם שהכול עובד מהדומיין.
3. Cookies של session ישנות (על `onrender.com`) אינן עוברות לדומיין — כניסה מחדש פעם אחת.

## smoke test אחרי כל deploy

| # | מה | צפוי |
|---:|---|---|
| 1 | `GET /api/health` | `200`, `readiness: ready`, `credentials: accepted`. **אין** host, ref, מפתח או מספר כלשהו בתשובה |
| 2 | `GET /` בלי session | הפניה ל־`/login` |
| 3 | `GET /auth/callback` | הפניה ל־`/login` **על ה־origin שהוגדר** (לא על Host של הבקשה) |
| 4 | `GET /auth/callback?token_hash=x&type=recovery&next=https://evil.example` | הפניה ל־`/login?link=invalid`; אין cookie |
| 5 | כניסה בדפדפן | DevTools → Application → Cookies: `sb-…-auth-token…` עם **Secure, HttpOnly, SameSite=Lax** |
| 6 | Invite user לכתובת שלכם | האימייל מוביל למסך "קביעת סיסמה"; אחרי קביעה — מסך הבית |
| 7 | `GET /api/health` בזמן שה־Supabase project מושהה (Pause) | `503 not_ready`; Render מפסיק לנתב deploy חדש; deploy קיים ממשיך לענות 503 — **המשפחה רואה מסך שגיאה ולא נתונים חלקיים** |
| 8 | (בדיקת שלילה, פעם אחת) הסירו זמנית את `FAMILY_FINANCE_APP_ORIGIN` בלוח ו־Manual Deploy | ה־deploy **נכשל** ב־health (`503 misconfigured`, השם `FAMILY_FINANCE_APP_ORIGIN` בתשובה); ה־deploy הקודם ממשיך לשרת. החזירו את הערך |

הפריטים 5–6 הם הליכה ידנית בדפדפן; המקבילה האוטומטית שלהם רצה מקומית ב־`npm run validate:production-path` (18 בדיקות, כולל token שנשתל למשתמש סינתטי ונפדה דרך `/auth/callback`).

## rollback

- **Deploy שנכשל ב־health** אינו מקבל תעבורה; הקודם ממשיך. אין מה לעשות מלבד לתקן.
- **Deploy שעבר ומתברר כשגוי**: Render → Deploys → הקודם → **Rollback / Redeploy**. הקוד חוזר; **הסכמה לא** — מיגרציות הן קדימה בלבד (`ADR-0015`), ולכן כל מיגרציה חייבת להיות תואמת גם לגרסה הקודמת של הקוד לפני שהיא מוחלת.
- **הפסקת שירות מיידית**: Render → Settings → **Suspend**. השירות מפסיק לענות; המסד אינו נפגע.
- **מפתח דלף** (publishable): Supabase → API Keys → צרו חדש, עדכנו ב־Render, Manual Deploy, מחקו את הישן. ה־publishable key אינו מעניק גישה מעבר ל־RLS, אבל הוא מזהה את הפרויקט.

## מה לא נעשה, ולמה

| נושא | סטטוס | טעם |
|---|---|---|
| יצירת השירות ב־Render | **פעולת בעלים** | חשבון חיצוני; הסכמה לתנאים והוצאה |
| הזנת שלושת הערכים | **פעולת בעלים** | ערכים אינם נכנסים למאגר, גם לא הציבוריים |
| Site URL, Redirect URLs, תבניות אימייל | **פעולת בעלים** | שינוי הגדרות Supabase לא בוצע ללא הוראה |
| דומיין ו־DNS | **פעולת בעלים, אופציונלי** | שלב ב׳, אחרי smoke על onrender.com |
| Free מול Starter | **החלטת בעלים** | `plan: free` בקובץ כדי שלא תיווצר הוצאה בשוגג |
| CSP / HSTS headers | נדחה | דורש בדיקה מול המוצר הרץ ב־https; milestone הקשחה |
| Passkeys בייצור | נדחה (`ADR-0032`) | זהות = Supabase Auth |
| בדיקות אינטגרציה ב־CI | נדחה | דורש סוד DB ב־GitHub — החלטה נפרדת |
| Preview environments | לא הוגדר | אין צורך; `main` בלבד נפרס |

## מיגרציות — הקוד עלול להקדים את המסד

Render פורס את `main` ברגע שה־CI ירוק. **מיגרציה מגיעה למסד רק כשהבעלים מחיל אותה.** בין שני
הרגעים האלה הקוד מקדים את הסכמה, וזה קרה בפועל: קומיט שהפנה את מסלול הכתיבה לפונקציה חדשה
הפיל **כל כתיבה במוצר** עם ההודעה "מסד הנתונים לא זמין כרגע" — משפט לא נכון ושאי אפשר לפעול
לפיו, כי המתנה לא משנה דבר.

**מה תוקן בקוד** (ADR-0037): כתיבה שנתקלת בפונקציה חסרה (`PGRST202`) נופלת אחורה לפונקציה
הקודמת, כך שרשומות כספיות ממשיכות להישמר; מה שבאמת אינו יכול להישמר — כלל סיווג — **מסרב
בקול** עם הודעה מדויקת, ולא נופל בשקט. `PGRST202` ו־`22P02` ממופים ל־`schema_outdated`.

**מה עדיין פעולת בעלים**: להחיל את המיגרציות שטרם הוחלו, לפי הסדר:

```
npm run db:apply supabase/migrations/20260922120000_lender_ledger_and_dual_calendar.sql
npm run db:apply supabase/migrations/20260923090000_transaction_intelligence.sql
```

עד שיוחלו, אלה הדברים שאינם עובדים בייצור ואומרים זאת במפורש:

| מה | מה יקרה עד ההחלה |
|---|---|
| שמירת כלל סיווג | הודעה מדויקת: דורש עדכון מסד |
| פעולת "הערה" בכרטיס מלווה | הודעה מדויקת (ערך `note` אינו ב־enum) |
| מועד פירעון מובְנה על חוב | לא נשמר לעמודות; שאר החוב נשמר |
| כינויי מלווה | הטבלה אינה קיימת |

**מה כן עובד בלי ההחלה**: כל שאר הכתיבות — תשלום ידני בכרטיס מלווה, חוב חדש, תנועה, תקציב,
יבוא ואישור.

**כלל לעתיד**: מיגרציה מוחלת **לפני** שהקומיט שתלוי בה מגיע ל־`main`, או שהקוד יודע לעבוד
בלעדיה. לא שתיהן לא.
