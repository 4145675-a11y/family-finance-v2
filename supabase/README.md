# Supabase — migrations and verification

## מה יש כאן

```
migrations/   שמונה קבצי SQL, מיושמים לפי סדר שם הקובץ
manual/       חבילה מיוצרת להדבקה ידנית + אבחון קריאה־בלבד
tests/        חבילת בידוד — 24 בדיקות שליליות מול DB אמיתי
```

| קובץ | תוכן |
|---|---|
| `20260816090000_identity_foundation.sql` | סכמת `app`, `touch_updated_at`, `current_profile_id` |
| `20260816090100_profiles_households.sql` | `profiles`, `households`, `household_members`, פונקציות החברות |
| `20260816090200_invitations.sql` | `household_invitations` + `accept_household_invitation()` |
| `20260816090300_audit_events.sql` | `audit_events` + טריגרי append-only + `record_audit_event()` |
| `20260816090400_rls_policies.sql` | RLS enable/force, policies לכל פקודה, grants |
| `20260822100000_financial_accounts.sql` | `businesses`, `financial_accounts`, `account_balance_snapshots`, `categories`, `transactions`, `transaction_splits`, `cashflow_items` |
| `20260822100100_debt_domain.sql` | `debts`, `debt_events`, `debt_rollovers` + אימות קישורי גלגול |
| `20260822100200_financial_row_security.sql` | RLS ל־10 הטבלאות החדשות + עוזרי בעלות על הפניות |

**הסדר מחייב.** קובץ מאוחר מסתמך על אובייקטים של קודמו.

## סטטוס

⚠️ **ה־migrations טרם הוחלו על שום מסד, ובדיקות הבידוד טרם רצו.** הן נכתבו ונקראו, לא הורצו. עד להרצה אין לראות ב־RLS מדיניות מוכחת. פירוט: `docs/checkpoints/milestone-2.md`.

## הדרך המומלצת: שתי פקודות

הדבקה ידנית קובץ־קובץ הובילה לטעויות — ה־SQL Editor שמר תוכן קודם, וה־clipboard הוחלף בצילומי מסך. במקום זה, שתי פקודות:

```bash
npm run db:copy:diagnostic    # אבחון, קריאה בלבד
npm run db:copy:schema        # כל המיגרציות, טרנזקציה אחת
```

כל פקודה מעתיקה ללוח קובץ אחד ומדפיסה שם, מספר תווים, שורות, non-ASCII ו־SHA-256 — **לעולם לא את ה־SQL עצמו**.

לכל פקודה: **פתח חלון SQL חדש וריק**, הדבק, והרץ **פעם אחת**.

- `supabase/manual/diagnostic.sql` — `select` בלבד. מאומת אוטומטית שאין בו INSERT/UPDATE/DELETE/CREATE/ALTER/DROP/TRUNCATE/GRANT/REVOKE ואין קריאה לפונקציה שכותבת. אם מישהו יוסיף שם פקודה משנה, הפקודה תסרב להעתיק.
- `supabase/manual/apply-all.sql` — **קובץ מיוצר**, לא לעריכה ידנית. מאגד את כל המיגרציות לפי סדר שמותיהן, עטוף ב־`begin; … commit;` יחיד. כשל בכל שלב מגלגל הכול אחורה — אין מצב חצי־מוחל. בטוח להרצה חוזרת גם על סכמה שהוחלה חלקית (`ADR-0015`).

`npm run db:build` מייצר מחדש; `npm run db:check` נכשל אם הקובץ סטה מהמיגרציות, והוא חלק מ־`npm run verify`.

**הערה על Windows**: הפקודות אינן משתמשות ב־`clip.exe`, שמקלקל UTF-8 — נמדד: em-dash הפך ל־`Γ`. הן משתמשות ב־PowerShell עם קריאת UTF-8 מפורשת, ומאמתות את הלוח בקריאה חוזרת. אם האימות נכשל, שום דבר לא מדווח כמוצלח.

## אבחון: מה כבר קיים במסד (קריאה בלבד)

`npm run db:copy:diagnostic` מעתיק את `supabase/manual/diagnostic.sql` ללוח. הקובץ הוא `select` יחיד ואינו משנה דבר; `tools/manual-sql.test.mjs` מוכיח זאת בכל ריצה.

הוא בודק קיום של סכמת `app`, 15 הטבלאות, ארבעה enums מייצגים, שש פונקציות, שלושה טריגרים, ספירת policies, ואת העובדה ש־RLS enabled **וגם** forced על כל טבלה. השאילתה עצמה נמצאת בקובץ ואינה משוכפלת כאן — עותק שני היה מתיישן בשקט, וזה בדיוק מה שקרה לגרסה הקודמת של הסעיף הזה.

**קריאת התוצאה**

| תמונה | פירוש |
|---|---|
| הכול `missing` | מסד נקי. הרץ את `npm run db:copy:schema` |
| חלק קיים וחלק חסר | החלה חלקית. החבילה בטוחה להרצה חוזרת — הרץ אותה במלואה |
| הכול `EXISTS` | הסכמה הוחלה. המשך לבדיקות הבידוד |

## החלה — דרכים חלופיות

הדרך המומלצת היא `npm run db:copy:schema` שלמעלה. אלה חלופות בלבד.

### א. Studio, קובץ־קובץ

רק אם אינך משתמש בקובץ המאוחד. **פתח חלון חדש, או נקה את החלון לגמרי (Ctrl+A ואז Delete), לפני כל קובץ** — ה־SQL Editor שומר תוכן קודם, וכך בדיוק נכשלה ההחלה הראשונה. הרץ את שמונת הקבצים לפי הסדר, אחד בכל פעם, ועצור בכשל ראשון.

### ב. Supabase CLI

```bash
npx supabase@2.114.0 link --project-ref <project-ref>
npx supabase@2.114.0 db push
```

`link` יבקש סיסמת DB. ה־CLI אינו dependency של הפרויקט: חבילת `supabase` מורידה בינארי ב־postinstall, ו־CI מתקין עם `--ignore-scripts`, כך שהיא הייתה נשארת שבורה.

### ג. psql

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/manual/apply-all.sql
```

## הרצת בדיקות הבידוד

1. Studio → **Project Settings → Database → Connection string (URI)**
2. צור בשורש הפרויקט `.env.integration.local` (כבר ב־`.gitignore`):

   ```
   SUPABASE_DB_URL=postgresql://postgres:<password>@<host>:5432/postgres
   ```

3. הרץ:

   ```bash
   npm run integration
   ```

**אל תדביק את המחרוזת בצ׳אט.** היא מכילה סיסמת מסד. הקובץ מקומי ואינו נכנס ל־git.

בלי המשתנה החבילה **נכשלת** עם הסבר — היא לעולם אינה מדלגת, כי בדיקת בידוד מדולגת נראית בסיכום כמו בדיקה שעברה.

## מה הבדיקות מוכיחות

שני משקי בית, ארבעה אנשים (Alice+Bob במשק A, Carol במשק B, Mallory ללא שיוך). לכל טבלה ולכל פועל נשאלת אותה שאלה: האם משק A יכול להגיע למשהו של משק B?

RLS enabled+forced · SELECT חוצה־משפחות · UPDATE חוצה־משפחות · הצטרפות עצמית · צפייה בחברים · ביטול חברות · הסלמה דרך revoke · צפייה בפרופיל של זר · עריכת פרופיל של בן/בת הזוג · טוקן hashed · פדיון כפול · טוקן שפג · טוקן שבוטל · פדיון ללא אימות · audit חוצה־משפחות · UPDATE/DELETE על audit · זיוף actor · גישת `anon` לחמש טבלאות.

## אחרי ההרצה

עדכן את `docs/checkpoints/milestone-2.md` — טבלת השערים ושורות הסטטוס ב־`docs/REQUIREMENTS.md` וב־`10-TRACEABILITY-MATRIX.md` — עם התוצאה בפועל. אם משהו נכשל, זו תוצאה תקפה: היא מלמדת שהמדיניות אינה עושה את מה שחשבנו, וזו בדיוק מטרת החבילה.
