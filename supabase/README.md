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

## אבחון: מה כבר קיים במסד (קריאה בלבד)

הרץ ב־SQL Editor **בחלון ריק**. השאילתה אינה משנה דבר — רק `select`:

```sql
select object, case when present then 'EXISTS' else 'missing' end as status
from (
  select 'schema: app' as object,
         exists (select 1 from pg_namespace where nspname = 'app') as present
  union all select 'table: profiles',
         to_regclass('public.profiles') is not null
  union all select 'table: households',
         to_regclass('public.households') is not null
  union all select 'table: household_members',
         to_regclass('public.household_members') is not null
  union all select 'table: household_invitations',
         to_regclass('public.household_invitations') is not null
  union all select 'table: audit_events',
         to_regclass('public.audit_events') is not null
  union all select 'type: membership_status',
         exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'membership_status' and n.nspname = 'public')
  union all select 'function: accept_household_invitation',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where p.proname = 'accept_household_invitation' and n.nspname = 'public')
  union all select 'function: record_audit_event',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where p.proname = 'record_audit_event' and n.nspname = 'public')
  union all select 'function: is_household_member',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where p.proname = 'is_household_member' and n.nspname = 'app')
  union all select 'trigger: profiles_touch_updated_at',
         exists (select 1 from pg_trigger where tgname = 'profiles_touch_updated_at' and not tgisinternal)
  union all select 'policies on public (count > 0)',
         exists (select 1 from pg_policies where schemaname = 'public')
) checks
order by object;
```

**קריאת התוצאה**

| תמונה | פירוש |
|---|---|
| `app`, שלוש הטבלאות הראשונות, ה־type, `is_household_member` ו־`profiles_touch_updated_at` קיימים; `household_invitations`, `audit_events`, שתי הפונקציות ו־policies חסרים | מיגרציות 1–2 הוחלו, 3–5 לא. זה המצב הצפוי אחרי הכשל |
| `household_invitations` קיים | חלק ממיגרציה 3 כן נכנס — דווח לי לפני שתמשיך |



### א. Studio (הפשוטה; ללא סודות בכלל)

1. Supabase Studio → **SQL Editor**
2. **פתח חלון חדש, או נקה את החלון לגמרי (Ctrl+A ואז Delete), לפני כל קובץ.**
   ה־SQL Editor שומר את התוכן הקודם בלשונית. הדבקה מתחת לתוכן קיים מריצה את שני
   הקבצים יחד — כך נכשלה ההחלה הראשונה. מאז המיגרציות ניתנות להרצה חוזרת
   (`ADR-0015`), כך שגם אם יקרה שוב זה יעבור, אבל עדיף לנקות.
3. הדבק קובץ אחד, הרץ, ורק אז עבור לקובץ הבא — **לפי הסדר**
4. עצור בכשל ראשון ודווח את הודעת השגיאה

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
