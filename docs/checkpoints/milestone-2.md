# CHECKPOINT — Milestone 2: Identity & Isolation

- **Result**: **PASS — evidenced against a real database (2026-09-14)**
- **Branch**: `milestone-2-identity-isolation` (מסתעף מ־`main` ב־`af51add`)
- **Environment**: local (Windows 11, Node v24.19.0, npm 11.17.0) · remote `origin` מוגדר
- **Date**: 2026-08-16 (נכתב) · 2026-08-22 (אומת מחדש, ללא DB) · **2026-09-14 (אומת מול Supabase)**

> **למה PASS**: קריטריון הקבלה של Milestone 2 לפי `09-MILESTONES.md` הוא "שני households בבדיקות חיוביות ושליליות". ב־2026-09-14 הסכמה נמצאה מוחלת במלואה על פרויקט Supabase אמיתי, ו־**38/38** בדיקות הבידוד רצו ועברו מולו. הריצה הראשונה חשפה שני באגים בקוד הבדיקה (לא ב־RLS) ומגבלת סכמה אחת — כולם מתועדים למטה עם ההחלטה שהתקבלה. עד לריצה הזו הדוח היה PARTIAL, כי `CLAUDE.md` אוסר PASS על "בדיקה שלא הורצה".

## Scope

### הושלם ואומת

| פריט | ראיה |
|---|---|
| Supabase boundary | client + server, שניהם עם publishable key (`ADR-0013`) |
| חוזה סביבה | `readPublicEnv()` דוחה anon JWT ו־secret key; 7 בדיקות |
| service role לא בדפדפן | `check:client-secrets` — מקור (7 מודולים) **וגם** bundle בנוי (10 קבצים); אומת שלילית |
| חוזי טיפוסים | `packages/contracts` — Zod, 22 בדיקות |
| threat model | `docs/THREAT-MODEL.md` — 14 איומים, בקרה ובדיקה לכל אחד |
| ADRs | 0013, 0014, 0015 |
| **חיבור למסד** | `pg` מול Supabase, PostgreSQL 17.6 — הצליח |
| **סכמה מוחלת** | `diagnostic.sql` (קריאה בלבד): **31/31** אובייקטים קיימים — סכמת `app`, 15 טבלאות M2–M4, 4 enums, 6 פונקציות, 3 טריגרים, policies, RLS forced. ספירה נוספת: **32/32** טבלאות ציבוריות עם RLS enabled **וגם** forced, **94** policies |
| **RLS על 5 טבלאות M2** | **38/38** בדיקות שליליות עברו מול המסד (`npm run integration`, exit 0) |
| invitation hashed/חד־פעמי/פג/ניתן לביטול | 7 בדיקות בהרצה, כולל replay ע"י אדם אחר ו־`anon` ללא EXECUTE (`42501`) |
| audit append-only | UPDATE ו־DELETE נדחים גם לבעל הטבלה; actor נלקח מה־session; כתיבה חוצת־משק נדחית |
| `anon` ללא גישה | 5 טבלאות, `42501` — היעדר grant ולא "אפס שורות" |
| **המסד נקי** | החבילה רצה בטרנזקציה אחת עם `rollback`; אחרי הריצה: 0 households, 0 profiles, 0 משתמשי `@example.test` |

### לא בוצע, ובכוונה

UI לאימות, מסכי הרשמה/כניסה, recent-auth, device/session screen, WebAuthn — נבנו במילסטונים מאוחרים (M8) מעל החנות המקומית. בדיקות allow/deny לטבלאות M3–M4 ו־M9 (27 טבלאות) — RLS enabled+forced אומת לכולן, אך בדיקות שליליות ייעודיות להן טרם נכתבו; הן שייכות ל־milestone שלהן.

### Out-of-scope שלא שונה

מסמכי `01`–`09`, `11` לא שונו. `.claude/settings.json` — לא נגעתי. סכמת המסד — לא שונתה (ראה ההחלטה על מחיקה).

## Changes

**2026-08-16 (חדש)**: `supabase/migrations/` (5 קבצים) · `supabase/tests/rls-isolation.integration.test.ts` · `supabase/README.md` · `packages/contracts/` · `apps/web/lib/env.ts` + `env.test.ts` · `apps/web/lib/supabase/{client,server}.ts` · `tools/check-client-secrets.mjs` · `vitest.integration.config.ts` · `docs/THREAT-MODEL.md` · `supabase/manual/` · `tools/build-manual-bundle.mjs` · `tools/copy-sql.mjs` · `tools/sql-guard.mjs` · `tools/migrations.test.mjs` · `tools/manual-sql.test.mjs` · ADR 0013–0015 · checkpoint זה

**2026-09-14 (אימות מול DB)**:

- `supabase/tests/load-env.ts` (חדש) — טוען את `.env.integration.local` לפני החבילה; ערך קיים בסביבה גובר; לעולם אינו מדפיס. עד כה ההוראות בבדיקה הפנו לקובץ ששום דבר לא קרא.
- `vitest.integration.config.ts` — `setupFiles` ל־loader.
- `supabase/tests/rls-isolation.integration.test.ts` — עיצוב מחדש (ראה "אירוע" למטה): טרנזקציה אחת + savepoints + rollback; שני תיקוני assertion.
- `.gitignore` — `*-firebase-adminsdk-*.json` (קובץ מפתח זר נמצא בשורש, נמחק; מעולם לא היה במעקב).
- `supabase/README.md`, `docs/REQUIREMENTS.md`, `10-TRACEABILITY-MATRIX.md`, `MILESTONE_STATUS.md`, checkpoint זה — סטטוס.

## Commands & Evidence (2026-09-14)

| Gate | Command | Result | Counts |
|---|---|---|---|
| Format | `npm run format:check` | **PASS** | exit 0 |
| Typecheck | `npm run typecheck` | **PASS** | שורש + workspaces |
| Lint | `npm run lint` | **PASS** | `--max-warnings=0` |
| Unit | `npm run unit` | **PASS** | ראה `MILESTONE_STATUS.md` לספירה העדכנית |
| Aggregate | `npm run verify` | **PASS** | exit 0 אמיתי — הפירוט ב־`MILESTONE_STATUS.md` |
| **Connection** | `pg` → Supabase | **PASS** | PostgreSQL 17.6 |
| **Schema diagnostic** | `supabase/manual/diagnostic.sql` (read-only) | **PASS** | **31/31** EXISTS; 32/32 טבלאות RLS forced; 94 policies |
| **Integration / RLS** | `npm run integration` | **PASS** | **38 passed, 0 failed, 0 skipped**, exit 0 (הורץ פעמיים אחרי התיקון: 49.7s, 104.1s) |
| **DB after run** | ספירה קריאה־בלבד | **PASS** | 0 households · 0 profiles · 0 `@example.test` users · 0 audit rows של fixture |

הפלט של כל ריצה עבר דרך redactor (מחרוזת החיבור, סיסמה, host, project ref). שום ערך סודי לא הודפס ולא נשמר.

## Negative verification

| מה נשבר בכוונה | תוצאה |
|---|---|
| הפניה ל־`SUPABASE_SERVICE_ROLE_KEY` במודול לקוח | `check:client-secrets` **exit 1**, 3 ממצאים. הקובץ הוסר |
| אותה הפניה מאחורי `import 'server-only'` | **exit 0** — השער מבחין בין המסלולים ואינו סתם מחפש מחרוזת |
| הרצת `npm run integration` בלי `SUPABASE_DB_URL` | **exit 1** עם הוראות — לא דילוג, לא ירוק מדומה |
| anon JWT ישן כ־publishable key | `env.test.ts` דוחה |
| secret key בתצורת לקוח | `env.test.ts` דוחה, וההודעה אינה מהדהדת את הערך |
| **מחיקת household ללא שורות audit, כבעל הטבלה** (טרנזקציה שגולגלה אחורה) | **`42501 audit_events is append-only; DELETE is not permitted`** — ה־cascade נחסם גם על אפס שורות |
| **מחיקת profile, כבעל הטבלה** | **`42501 … UPDATE is not permitted`** — `on delete set null` הוא UPDATE על audit |

## Reviews

- **Code**: אין `any`, אין השתקות. חוזי Zod מאמתים בזמן ריצה, לא רק בקומפילציה. בחבילת הבידוד הוסרה assertion ריקה (`error !== null || true`) והוחלפה בבדיקה של "0 שורות שונו".
- **Financial invariants**: לא רלוונטי — אין חישוב.
- **Security/privacy**: `force row level security` בכל 32 הטבלאות (אומת במסד); אין INSERT policy על `household_members`; `WITH CHECK` חוסם הסלמה דרך revoke; טוקן hashed בלבד; audit append-only בטריגר — **מוכח בהרצה גם נגד הבעלים**; `search_path = ''` בכל SECURITY DEFINER; אין DELETE policy; `anon` ללא grants — **מוכח `42501`**.
- **UX/RTL/states**: אין UI חדש.

## אירוע: הריצה הראשונה מול המסד (2026-09-14)

**תוצאה גולמית**: 38 בדיקות — **37 עברו, 1 נכשלה**, ובנוסף כשל ב־`afterAll`. שני הכשלים היו בקוד הבדיקה, לא ב־RLS:

1. **`a valid token admits exactly one person, once`** — `authentication required`. הבדיקה קראה ל־`set_config(..., is_local => true)` **ללא `begin`**; מחוץ לבלוק טרנזקציה ההגדרה פגה בסוף אותו statement, והקריאה ל־`accept_household_invitation` רצה ללא claims. אותו דפוס בבדיקת ה־`anon` — היא "עברה" מהסיבה הלא־נכונה.
2. **teardown** — `delete from households` נדחה: `audit_events is append-only; DELETE is not permitted`. הבדיקה הניחה ש־`on delete cascade` ינקה את שורות ה־audit; ה־trigger חוסם בדיוק את זה.

**ממצא סכמה** (אומת בטרנזקציות שגולגלו אחורה, ללא שינוי במסד): שני ה־triggers על `audit_events` הם ברמת **statement**, ולכן נורים גם כשה־cascade לא נוגע באף שורה. `households → audit_events` הוא `on delete cascade` (DELETE), `profiles → audit_events.actor_profile_id` הוא `on delete set null` (UPDATE), ו־`auth.users → profiles` הוא cascade. **לכן בסכמה הנוכחית אף `auth.users`, `profiles` או `households` אינם ניתנים למחיקה — על ידי אף אחד, גם ללא היסטוריית audit.**

**החלטת מוצר ואבטחה (2026-09-14)**: בשלב זה **אין לשנות או להחליש** את מנגנון ה־append-only של `audit_events`. מחיקת household, profile או auth.user שיש להם היסטוריית audit **אינה נתמכת כמחיקה רגילה**. בעתיד יוגדר תהליך מסודר של ארכוב/אנונימיזציה תוך שמירת יומן הביקורת (יתועד ב־ADR כשיוגדר). עד אז המגבלה מתועדת כאן, ב־`supabase/README.md` וב־`docs/REQUIREMENTS.md` (`SEC-AUDIT-001`).

**התיקון בחבילת הבדיקה**: מאחר שמחיקה בלתי אפשרית בלי לגעת ב־trigger, שום דבר אינו עובר commit. חיבור owner אחד פותח `begin` ב־`beforeAll`; כל ה־fixture חי בתוכו; `afterAll` = `rollback`. פעולה כמשתמש רצה ב־`savepoint` על אותו חיבור — `set_config(..., true)` בתוך טרנזקציה פעילה, ו־`rollback to savepoint` מחזיר גם `role` וגם `request.jwt.claims`. כל בדיקה ב־savepoint משלה, כך שכשל אינו "מרעיל" את הבאות. RLS מוערך per-statement לפי ה־role הנוכחי, ולכן ההוכחה זהה לזו שעל חיבורים נפרדים — והמסד נשאר כפי שנמצא גם אם בדיקה נכשלת או התהליך מת. שני חיזוקי assertion: `anon` מול הפונקציה מצפה ל־`42501` (EXECUTE מבוטל), ובדיקת ה־revoke מצפה ל־0 שורות שונו במקום `|| true`.

**ניקוי שאריות הריצה הראשונה** (באישור מפורש): 4 `auth.users`, 4 `profiles`, 2 `households`, 2 `audit_events`. טרנזקציה אחת; כל ספירה נבדקה לפני כל מחיקה (סטייה = rollback — וזה קרה בניסיון הראשון, שנעצר על ה־UPDATE trigger וגולגל אחורה במלואו). בניסיון השני שני ה־guards הושהו **בתוך הטרנזקציה בלבד**, הופעלו מחדש לפני ה־commit, ואומתו פעילים (`tgenabled = 'O'` **וגם** DELETE/UPDATE נדחים בפועל). ספירה אחרי: הכול 0; שום נתון אחר לא נגע.

## אירוע: כשל בהחלה הידנית הראשונה (2026-08)

**מה נצפה**: מיגרציות 1–2 עברו. בהרצת מיגרציה 3 התקבל
`ERROR: 42710: trigger "profiles_touch_updated_at" for relation "profiles" already exists` —
טריגר ששייך למיגרציה **2**, לא ל־3.

**האבחון** (ספירת שורות, קריאה בלבד):

| נתון | ערך |
|---|---|
| מיגרציה 2 | 143 שורות |
| מיגרציה 3 | 139 שורות |
| סכום + שורת הפרדה | **283** |
| מה שנצפה בעורך | **283** |

התאמה מדויקת. חלון ה־SQL Editor עדיין החזיק את מיגרציה 2 כשמיגרציה 3 הודבקה מתחתיה, וההרצה ביצעה את שתיהן. `create trigger` בשורה 24 של המאגר נכשל.

`profiles_touch_updated_at` מוגדר **פעם אחת בלבד** בכל המאגר — אומת בגריפ ובבדיקה אוטומטית. לא היה כפל הגדרות.

**התיקון** (`ADR-0015`): כל האובייקטים במיגרציות הפכו לניתנים להרצה חוזרת — טריגרים ו־policies מקבלים `drop … if exists` לפני היצירה, וה־enum נעטף בבדיקת קיום מול `pg_type`. `tools/migrations.test.mjs` אוכף זאת, כולל איסור על הגדרת אותו אובייקט בשני קבצים.

אומת שלילית: הסרת ה־`drop` של `profiles_touch_updated_at` הפילה שתי בדיקות עם הודעה שמסבירה את התיקון.

## החסימה שהוסרה

עד 2026-09-14 ה־checkpoint היה PARTIAL: החלת ה־migrations דרשה סיסמת מסד, ו־`.env.local` הכיל publishable key בלבד. ב־2026-09-14 הסכמה נמצאה מוחלת במלואה, `.env.integration.local` סופק מקומית (הסיסמה קודדה percent-encoding מקומית, ללא הדפסה; הקובץ ב־`.gitignore`, אומת), והחבילה רצה.

## Risks & rollback

| סיכון | חומרה | טיפול |
|---|---|---|
| `insert into auth.users` בבדיקות תלוי במבנה הפנימי של Supabase | נמוכה | עבד בפועל; מגולגל אחורה תמיד |
| ריצה מקבילה של שתי חבילות מול אותו מסד | נמוכה | אין נתונים משותפים — הכול uncommitted; `fileParallelism: false` |
| policy נכונה תחבירית אך שגויה לוגית בטבלאות M3+ | בינונית | RLS forced אומת ל־32; בדיקות allow/deny ל־27 הטבלאות הנוספות טרם נכתבו |
| **מחיקת חשבון/משק בית בלתי אפשרית** | **מוצרית** | החלטה מתועדת; ארכוב/אנונימיזציה יוגדרו בנפרד |

**Rollback**: הכול על ענף ייעודי. `git checkout main && git branch -D milestone-2-identity-isolation`. הסכמה במסד לא שונתה ב־checkpoint זה.

## Stop declaration

**לא מוזג דבר ל־`main`.** לא שונתה סכמה, לא נגעה מדיניות, לא הוחלש trigger.
