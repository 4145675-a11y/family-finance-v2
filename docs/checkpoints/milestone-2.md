# CHECKPOINT — Milestone 2: Identity & Isolation

- **Result**: **PARTIAL — blocked on database access**
- **Branch**: `milestone-2-identity-isolation` (מסתעף מ־`main` ב־`af51add`)
- **Environment**: local (Windows 10, Node v24.18.1, npm 11.16.0) · אין remote, לא בוצע push
- **Date**: 2026-08-16

> **למה PARTIAL ולא PASS**: קריטריון הקבלה המרכזי של Milestone 2 לפי `09-MILESTONES.md` הוא "שני households בבדיקות חיוביות ושליליות". הבדיקות נכתבו במלואן — 24 בדיקות שליליות — אך **טרם רצו**, כי אין חיבור למסד. RLS שלא הורצה מולה בדיקה היא כוונה, לא בקרה. `CLAUDE.md` אוסר לסמן PASS על "בדיקה שלא הורצה", ולכן זה PARTIAL.

## Scope

### הושלם ואומת

| פריט | ראיה |
|---|---|
| Supabase boundary | client + server, שניהם עם publishable key (`ADR-0013`) |
| חוזה סביבה | `readPublicEnv()` דוחה anon JWT ו־secret key; 7 בדיקות |
| service role לא בדפדפן | `check:client-secrets` — מקור (7 מודולים) **וגם** bundle בנוי (10 קבצים); אומת שלילית |
| חוזי טיפוסים | `packages/contracts` — Zod, 22 בדיקות |
| threat model | `docs/THREAT-MODEL.md` — 14 איומים, בקרה ובדיקה לכל אחד |
| ADRs | 0013, 0014 |

### הושלם אך **לא אומת** (חסום)

| פריט | מצב |
|---|---|
| 5 migrations SQL | נכתבו ונקראו. **לא הוחלו על שום מסד.** אין אימות תחביר, אין אימות שהן רצות על DB נקי |
| RLS על 5 טבלאות | policies נכתבו. **לא נבדקו בהרצה** |
| invitation hashed/חד־פעמי/פג/ניתן לביטול | פונקציה נכתבה. **לא נבדקה בהרצה** |
| audit append-only | טריגרים נכתבו. **לא נבדקו בהרצה** |
| 24 בדיקות בידוד | נכתבו. `npm run integration` **נכשל במכוון** ללא DB |

### לא בוצע, ובכוונה

UI לאימות, מסכי הרשמה/כניסה, recent-auth, device/session screen, WebAuthn — כולם דורשים תשתית מאומתת תחילה. `CLAUDE.md`: "לפני UI: contracts/schema/RLS/tests". ה־UI ייבנה כשהשכבה מתחתיו מוכחת.

### Out-of-scope שלא שונה

מסמכי `01`–`09`, `11` לא שונו. `10-TRACEABILITY-MATRIX.md` — 4 שורות. `.claude/settings.json` — לא נגעתי. אין טבלאות פיננסיות (M3+).

## Changes

**חדש**: `supabase/migrations/` (5 קבצים) · `supabase/tests/rls-isolation.integration.test.ts` · `supabase/README.md` · `packages/contracts/` (identity.ts, index.ts, identity.test.ts, package.json, tsconfig.json) · `apps/web/lib/env.ts` + `env.test.ts` · `apps/web/lib/supabase/{client,server}.ts` · `tools/check-client-secrets.mjs` · `vitest.integration.config.ts` · `docs/THREAT-MODEL.md` · ADR 0013–0014 · checkpoint זה

**שונה**: `package.json` (6 תלויות, scripts `integration` ו־`check:client-secrets`) · `package-lock.json` · `tsconfig.json` · `apps/web/package.json` · `docs/REQUIREMENTS.md` · `10-TRACEABILITY-MATRIX.md` · `docs/adr/README.md`

## Commands & Evidence

| Gate | Command | Result | Counts |
|---|---|---|---|
| Install | `npm ci --ignore-scripts` | **PASS** | 0 vulnerabilities, 0 אזהרות peer |
| Format | `npm run format:check` | **PASS** | exit 0 |
| Typecheck | `npm run typecheck` | **PASS** | שורש + 3 workspaces |
| Lint | `npm run lint` | **PASS** | `--max-warnings=0` |
| Unit | `npm run unit` | **PASS** | **183 passed**, 0 failed, **0 skipped**, 9 קבצים |
| Build | `npm run build` | **PASS** | exit 0 |
| Built-shell | `npm run check:shell` | **PASS** | 8/8 |
| **Client secrets** | `npm run check:client-secrets` | **PASS** | 7 מודולים + 10 קבצי bundle, 0 ממצאים |
| Forbidden scan | `npm run scan:forbidden` | **PASS** | 36 קבצים, 0 errors |
| Traceability | `npm run check:traceability` | **PASS** | 26/26 |
| **Aggregate** | `npm run verify` | **PASS** | **exit 0 אמיתי** |
| **Migrations** | — | **NOT RUN** | חסום — אין חיבור DB |
| **Integration / RLS** | `npm run integration` | **FAILS BY DESIGN** | exit 1 עם הוראות; 24 בדיקות ממתינות ל־DB |

## Negative verification

| מה נשבר בכוונה | תוצאה |
|---|---|
| הפניה ל־`SUPABASE_SERVICE_ROLE_KEY` במודול לקוח | `check:client-secrets` **exit 1**, 3 ממצאים. הקובץ הוסר |
| אותה הפניה מאחורי `import 'server-only'` | **exit 0** — השער מבחין בין המסלולים ואינו סתם מחפש מחרוזת |
| הרצת `npm run integration` בלי `SUPABASE_DB_URL` | **exit 1** עם הוראות — לא דילוג, לא ירוק מדומה |
| anon JWT ישן כ־publishable key | `env.test.ts` דוחה |
| secret key בתצורת לקוח | `env.test.ts` דוחה, וההודעה אינה מהדהדת את הערך |

## Reviews

- **Code**: אין `any`, אין השתקות. חוזי Zod מאמתים בזמן ריצה, לא רק בקומפילציה.
- **Financial invariants**: לא רלוונטי — אין טבלאות כספיות ואין חישוב.
- **Security/privacy**: `force row level security` בכל טבלה; אין INSERT policy על `household_members`; `WITH CHECK` חוסם הסלמה דרך revoke; טוקן hashed בלבד; audit append-only בטריגר; `search_path = ''` בכל SECURITY DEFINER; אין DELETE policy; `anon` ללא grants.
- **UX/RTL/states**: אין UI חדש.

## אירוע: כשל בהחלה הידנית הראשונה

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

**מצב שנותר**: Postgres עוטף ריצת multi-statement בטרנזקציה משתמעת, ולכן ההרצה שנכשלה **התגלגלה אחורה במלואה**. הציפייה היא שמיגרציה 3 לא הוחלה כלל — אך זו ציפייה, לא ידיעה. שאילתת אבחון קריאה־בלבד ב־`supabase/README.md` מאמתת בפועל מה קיים, ולא הונחה שום הנחה לפניה.

**התיקון** (`ADR-0015`): כל האובייקטים במיגרציות הפכו לניתנים להרצה חוזרת — 7 טריגרים ו־12 policies מקבלים `drop … if exists` לפני היצירה, וה־enum נעטף בבדיקת קיום מול `pg_type`. `tools/migrations.test.mjs` (25 בדיקות) אוכף זאת, כולל איסור על הגדרת אותו אובייקט בשני קבצים — הכשל שהיה מייצר בדיוק את אותה שגיאה מבלבלת.

אומת שלילית: הסרת ה־`drop` של `profiles_touch_updated_at` הפילה שתי בדיקות עם הודעה שמסבירה את התיקון.

## 🔴 חסימה — נדרשת פעולה שלך

**מה חסום**: החלת ה־migrations, ובעקבותיה 24 בדיקות הבידוד.

**למה אני לא יכול לבצע זאת**: החלת migrations דורשת סיסמת מסד או access token. `.env.local` מכיל URL ו־publishable key בלבד — ובצדק: publishable key אינו יכול ליצור טבלאות. Docker אינו זמין במכונה, ולכן גם stack מקומי אינו אפשרי.

**מה נדרש ממך** — הכול מקומי, שום ערך בצ׳אט:

1. **החל את ה־migrations** — הדרך הפשוטה היא Studio → SQL Editor, חמשת הקבצים לפי הסדר. שתי דרכים נוספות ב־`supabase/README.md`.
2. **לבדיקות** — Studio → Project Settings → Database → Connection string (URI), ואז בשורש הפרויקט:

   ```
   .env.integration.local
   SUPABASE_DB_URL=postgresql://postgres:<password>@<host>:5432/postgres
   ```

   הקובץ כבר ב־`.gitignore` (אומת).
3. הרץ `npm run integration` ומסור לי את **הסיכום** (מספרים ושמות בדיקות שנכשלו). אל תדביק את מחרוזת החיבור.

**מה יקרה אז**: אריץ, אתקן כשלים אמיתיים, ואעדכן את ה־checkpoint ל־PASS או אדווח מה לא מחזיק. סביר שיהיו כשלים בהרצה ראשונה — SQL שלא רץ מעולם הוא SQL לא בדוק.

## Risks & rollback

| סיכון | חומרה | טיפול |
|---|---|---|
| SQL שלא הורץ מעולם | **גבוהה** | מוצהר במפורש; זו כל החסימה |
| `insert into auth.users` בבדיקות תלוי במבנה הפנימי של Supabase | בינונית | ייתכן שיידרש תיקון בהרצה ראשונה |
| policy נכונה תחבירית אך שגויה לוגית | בינונית | 24 בדיקות שליליות נועדו בדיוק לזה — משנרוצנה |
| `citext`/`pgcrypto` לא זמינים | נמוכה | `create extension if not exists`; שגיאה תתגלה בהחלה |

**Rollback**: הכול על ענף ייעודי, ולא הוחל דבר על מסד. `git checkout main && git branch -D milestone-2-identity-isolation`.

## Stop declaration

**לא התחלתי את Milestone 3.** לא נוצרו טבלאות פיננסיות, לא UI, ולא מוזג דבר ל־`main`.
