# Supabase — migrations and verification

## מה יש כאן

```
migrations/   חמישה קבצי SQL, מיושמים לפי סדר שם הקובץ
tests/        חבילת בידוד — 24 בדיקות שליליות מול DB אמיתי
```

| קובץ | תוכן |
|---|---|
| `20260816090000_identity_foundation.sql` | סכמת `app`, `touch_updated_at`, `current_profile_id` |
| `20260816090100_profiles_households.sql` | `profiles`, `households`, `household_members`, פונקציות החברות |
| `20260816090200_invitations.sql` | `household_invitations` + `accept_household_invitation()` |
| `20260816090300_audit_events.sql` | `audit_events` + טריגרי append-only + `record_audit_event()` |
| `20260816090400_rls_policies.sql` | RLS enable/force, policies לכל פקודה, grants |

**הסדר מחייב.** קובץ מאוחר מסתמך על אובייקטים של קודמו.

## סטטוס

⚠️ **ה־migrations טרם הוחלו על שום מסד, ובדיקות הבידוד טרם רצו.** הן נכתבו ונקראו, לא הורצו. עד להרצה אין לראות ב־RLS מדיניות מוכחת. פירוט: `docs/checkpoints/milestone-2.md`.

## החלה — שלוש דרכים

### א. Studio (הפשוטה; ללא סודות בכלל)

1. Supabase Studio → **SQL Editor**
2. הדבק את תוכן חמשת הקבצים **לפי הסדר**, כל אחד בהרצה נפרדת
3. עצור בכשל ראשון ודווח את הודעת השגיאה

### ב. Supabase CLI

```bash
npx supabase@2.114.0 link --project-ref <project-ref>
npx supabase@2.114.0 db push
```

`link` יבקש סיסמת DB. ה־CLI אינו dependency של הפרויקט: חבילת `supabase` מורידה בינארי ב־postinstall, ו־CI מתקין עם `--ignore-scripts`, כך שהיא הייתה נשארת שבורה.

### ג. psql

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260816090000_identity_foundation.sql \
  -f supabase/migrations/20260816090100_profiles_households.sql \
  -f supabase/migrations/20260816090200_invitations.sql \
  -f supabase/migrations/20260816090300_audit_events.sql \
  -f supabase/migrations/20260816090400_rls_policies.sql
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
