# THREAT MODEL — Identity & Isolation (Milestone 2)

נגזר מ־`07-SECURITY-PRIVACY.md`. מכסה את שכבת הזהות בלבד: מי המשתמש, לאיזה משק בית הוא שייך, ומה מונע ממנו להגיע לנתונים של משק בית אחר. שכבות מאוחרות יותר (יבוא, AI, קבצים) יקבלו הרחבה ב־milestone שלהן.

## נכסים בשלב זה

| נכס | מדוע הוא שווה תקיפה |
|---|---|
| חברות במשק בית | היא **כל** גבול הבידוד. מי שמשיג חברות מקבל את כל הנתונים הפיננסיים העתידיים של המשפחה |
| טוקן הזמנה | דרך כניסה חוקית למשק בית קיים |
| session/JWT | התחזות למשתמש קיים |
| audit trail | ראיה. תוקף שיכול לערוך אותה מוחק את עקבותיו |
| Publishable key | מזהה את הפרויקט; **אינו** סוד, ואינו מעניק גישה בלי session |
| Secret key / service role | עוקף RLS לחלוטין. הנכס החמור ביותר, ולכן אינו קיים בפרויקט הזה כלל |

## גבול האמון

```
דפדפן (לא אמין)
  │  publishable key + session cookie
  ▼
Next server (אמין חלקית — מריץ קוד שלנו, אך מקבל קלט מהמשתמש)
  │  אותו publishable key + ה־session של המשתמש
  ▼
PostgREST / Postgres  ← RLS כאן היא הגבול האמיתי
```

**הכרעה מרכזית של Milestone 2**: גם השרת פונה ל־Supabase עם ה־publishable key ועם ה־session של המשתמש, ולא עם מפתח שעוקף RLS. משמעות הדבר שגם קוד שרת שגוי אינו יכול להדליף בין משקי בית — הוא כפוף לאותה מדיניות. שרת שמחזיק service role הופך את עצמו לחור בגבול במקום לחלק ממנו.

## איומים ובקרות

| # | איום | תרחיש | בקרה | אימות |
|---:|---|---|---|---|
| T1 | **IDOR בין משקי בית** | משתמש מנחש `household_id` ושולף נתונים | RLS `enable` + **`force`** על כל טבלה; כל policy נשענת על `app.is_household_member()` | 24 בדיקות שליליות ב־`rls-isolation.integration.test.ts` |
| T2 | **הצטרפות עצמית** | משתמש מוסיף שורה ל־`household_members` עבור עצמו | **אין INSERT policy** על הטבלה. הכניסה היחידה היא `accept_household_invitation()` | `Mallory cannot add herself to household A` |
| T3 | **גניבת טוקן הזמנה** | דליפת DB או לוג חושפת טוקנים | נשמר **SHA-256 בלבד**; אין עמודת plaintext; אין החזרה בשאילתה | `the plaintext token is nowhere in the table` |
| T4 | **replay של הזמנה** | אותו טוקן נפדה פעמיים | `accepted_at` + `FOR UPDATE` לנעילה; אדם אחר מקבל שגיאה | `a valid token admits exactly one person, once` |
| T5 | **הזמנה נצחית** | טוקן ישן נשאר תקף | `expires_at` חובה, מוגבל ל־14 יום בחוזה; אכיפה בפונקציה | `an expired token is refused` |
| T6 | **הזמנה שבוטלה** | מוזמן שהוסר משתמש בקישור הישן | `revoked_at` נבדק לפני כל דבר אחר | `a revoked token is refused` |
| T7 | **הסלמת הרשאה דרך revoke** | שימוש ב־UPDATE policy כדי להחזיר חברות שבוטלה | `WITH CHECK (status = 'revoked')` — הכיוון ההפוך חסום | `the revoke policy cannot be used to re-activate` |
| T8 | **זיוף actor ב־audit** | לקוח כותב שורת audit בשם אדם אחר | `record_audit_event()` לוקח את ה־actor מ־`auth.uid()`; אין INSERT policy | `the recorded actor comes from the session` |
| T9 | **שכתוב audit** | מחיקה או עריכה של ראיה | טריגרים ברמת statement דוחים UPDATE/DELETE **לכל role**, כולל הבעלים | `cannot be updated/deleted, even by the table owner` |
| T10 | **service role בדפדפן** | מפתח סוד נכנס לקוד לקוח | `check:client-secrets` — סריקת מקור **וגם** סריקת bundle בנוי | אומת שלילית: הפניה מושתלת הפילה את השער |
| T11 | **גישה ללא אימות** | `anon` קורא טבלאות | אין grant ל־`anon`; כל policy מוגבלת ל־`authenticated` | `anon cannot select from %s` (5 טבלאות) |
| T12 | **recursion ב־policy** | policy על `household_members` קוראת לעצמה | `app.is_household_member()` היא SECURITY DEFINER עם `search_path = ''` | נבדק בהרצת החבילה כולה |
| T13 | **חטיפת search_path** | קורא מגדיר `search_path` זדוני ומחליף פונקציה | כל פונקציית SECURITY DEFINER מוגדרת `set search_path = ''` ומשתמשת בשמות מלאים | code review + הגדרה בקוד |
| T14 | **דליפת credential בלוג** | הודעת שגיאה מהדהדת מפתח | `readPublicEnv()` מדווח שם משתנה בלבד | `the error names the variable but never echoes its value` |

## מה עדיין לא מכוסה, במפורש

| פער | Milestone |
|---|---|
| recent-auth (10 דקות) לפעולות רגישות | 3+, כשקיימות פעולות רגישות לשמור עליהן |
| device/session screen, sign-out-all, revoke lost device | 3+ |
| WebAuthn/passkey | 3+ |
| rate limiting על פדיון הזמנות | 3 — כרגע ההגנה היא אורך הטוקן (32 בייט) |
| CSP/HSTS | 14 (Hardening), נדרש דומיין |
| **אימות בפועל של כל הבקרות למעלה** | **חסום** — ראה `docs/checkpoints/milestone-2.md` |

## הנחה שדורשת אימות

כל השורות בטבלה נשענות על כך שה־migrations הוחלו וש־24 הבדיקות השליליות רצו. **הן טרם רצו** — אין חיבור DB. עד שהן ירוצו, זהו מודל איומים עם בקרות **מתוכננות**, לא בקרות **מוכחות**.
