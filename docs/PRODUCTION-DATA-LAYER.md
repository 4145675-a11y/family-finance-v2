# Production Data Layer — הפעלה, פיתוח ושחזור

מדריך תפעולי ל־`ADR-0032`. שני מצבי הפעלה, נקבעים מתצורה אחת, לעולם לא מנחשים.

## שני ה־backends

| | `local_json` | `supabase` |
|---|---|---|
| מקור האמת | `.data/household.json` על המחשב | 32 טבלאות ב־Supabase, RLS forced |
| זהות | WebAuthn מקומי (`ADR-0028/0029`) | Supabase Auth, אימייל+סיסמה |
| מי רשאי | מי שפתח את הנעילה במחשב הזה | חבר במשק הבית, לפי `auth.uid()` |
| origin | `http://localhost:3100` בלבד | דומיין https (לוקאלי: `http://localhost:<port>` לאימות) |
| גיבוי | קובץ ב־`.data/backups` | הורדה: `/api/export/backup.json` |
| שחזור מגיבוי | נתמך | **לא נתמך** (רשומות כסף אינן מוחלפות) |
| הוספת חבר | שם בלבד | הזמנה באימייל, קוד חד־פעמי |
| מסמך שהועלה | נשמר 24h ב־`.data/uploads` | נקרא בזיכרון, לא נשמר |

## משתני סביבה

השמות בלבד; אף ערך אינו נכנס ל־git. `apps/web/.env.example` מחזיק placeholders.

| שם | ציבורי? | מתי |
|---|---|---|
| `FAMILY_FINANCE_DATA_BACKEND` | לא | `local_json` (ברירת מחדל בפיתוח) או `supabase`. ייצור **חייב** להצהיר |
| `FAMILY_FINANCE_APP_ORIGIN` | לא | ה־origin שהמשפחה מגיעה אליו. https; `localhost` הוא ה־http היחיד שנחשב מאובטח. **חובה** בייצור עם `supabase` — אין ברירת מחדל למארח (`PROD-ORIGIN-001`) |
| `NEXT_PUBLIC_SUPABASE_URL` | כן (מוטמע ב־bundle) | Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | כן | חייב להתחיל ב־`sb_publishable_`. מפתח סודי נדחה לפי צורתו |
| `SUPABASE_DB_URL` | **סוד, שרת/פיתוח בלבד** | רק לבדיקות אינטגרציה ולכלי המיגרציה (`.env.integration.local`). **לעולם לא** לאפליקציה הרצה |

אין `SUPABASE_SECRET_KEY` / `SERVICE_ROLE` בשום מקום באפליקציה. `check:client-secrets` ו־`deployment.ts` (`NEVER_PUBLIC`) אוכפים.

## פיתוח מקומי

- ברירת מחדל: `npm run dev` → `local_json`, נעילת WebAuthn.
- **מול המסד, מקומית** (מה שהריצה החיה עושה): `apps/web/.env.local` עם URL + publishable key; הפעלה עם `FAMILY_FINANCE_DATA_BACKEND=supabase FAMILY_FINANCE_APP_ORIGIN=http://localhost:3100`. משתמש אמיתי ב־Supabase Auth נדרש; כניסה ב־`/login`.
- בדיקות אינטגרציה (`npm run integration`) ואימות (`npm run validate:production-path`) קוראים `SUPABASE_DB_URL` מ־`.env.integration.local`; שום כלי אינו מדפיס אותו.

## מסלול המידע בייצור

```
דפדפן ──cookies (session)──▶ Next (server) ──supabase-js + JWT──▶ PostgREST ──authenticated──▶ Postgres (RLS)
                                   │
                                   └── lib/store/server.ts → SupabaseHouseholdStore
                                         load_household_document(id)     -- security invoker
                                         command (pure)                   -- אותו קוד כמו מקומית
                                         apply_household_changes(id, v, Δ) -- security invoker, אטומי
```

- `proxy.ts` מרענן את ה־session בכל בקשה (URL + publishable בלבד).
- `resolveDataSource` מחזיר `supabase` רק עם session + household; אחרת `none`. לעולם לא קובץ, לעולם לא fixture.
- `lib/auth/store.ts` (קובץ הכניסה המקומי) **מסרב** להיפתח תחת `supabase`.

## הפעלה ראשונה של פריסה (סדר)

> האירוח עצמו — Render, `render.yaml`, ה־origin, cookies, קישורי הזמנה/שחזור והצ׳קליסט של Supabase Auth — מתועד ב־`docs/HOSTING-RENDER.md` (`ADR-0033`). הסעיף כאן הוא הסדר הלוגי; הצעדים המדויקים לבעלים נמצאים שם.

1. הסכמה מוחלת: `npm run db:cleanliness` מדווח 32/32 ו־guards 2/2; `apply-all.sql` מכיל 16 מיגרציות. מיגרציה חדשה: `npm run db:apply supabase/migrations/<file>.sql`.
2. Supabase Auth: ספק Email מופעל; "Confirm email" לפי החלטתכם (משתמש שנוצר ב־Studio עם אישור — נכנס מיד).
3. משתני הסביבה לעיל ב־secrets של המארח. אין קובץ `.env` ב־image (`check:no-env-files`).
4. `/api/health` → `200 {"status":"ok", "data":{"readiness":"ready", …}}`. `503 not_ready` = מסד לא נגיש או סכמה לא מיושרת; `503 misconfigured` = שמות ההגדרות הפגומות.
5. כניסה, `/setup` ליצירת משק בית, `/account` להזמנת בן/בת הזוג (`/join` אצלם).

## אימות לפני פריסה ציבורית

`npm run build && npm run validate:production-path` — שרת ייצור מקומי מול המסד האמיתי, שלושה משתמשים סינתטיים, המסלול הקריטי, בידוד, ניקוי. אחריו `npm run db:cleanliness`.

## rollback ושחזור

- **קוד**: הענף אינו ממוזג עד לאישור. `main` אינו קורא לאף אובייקט שהמיגרציה הוסיפה.
- **סכמה**: מיגרציות קדימה בלבד. ביטול = מיגרציה נוספת. `voided_at`/`removed_at` שומרים היסטוריה — שום שורה לא נמחקה.
- **נתונים**: Supabase שומר גיבויים יומיים לפרויקט; בנוסף `/api/export/backup.json` (דורש הזנת סיסמה מחדש). שחזור לתוך המסד — ייבנה עם תהליך הארכוב (נדחה; `docs/checkpoints/milestone-2.md`).
- **ניקוי שאריות בדיקה** (רק פיקסטורות של ריצה שנקטעה): מזוהות לפי `@example.test`; מחיקה בטרנזקציה צרה עם השהיית ה־guards והפעלתם מחדש **בתוך אותה טרנזקציה** — כפי שעושה `afterAll` של הריצה החיה. לעולם לא DELETE רחב.

## מה נדחה, ולמה

| נושא | סטטוס | טעם |
|---|---|---|
| Passkeys בייצור | נדחה | זהות = Supabase Auth; passkey יתווסף כאמצעי שני |
| ארכוב/אנונימיזציה | נדחה | `audit_events` append-only; household/profile/user אינם נמחקים |
| Supabase Storage למסמכים | נדחה | הבייטים אינם נחוצים אחרי הפרסור; פרטיות קודמת |
| שחזור לתוך המסד | נדחה | דורש את תהליך הארכוב |
