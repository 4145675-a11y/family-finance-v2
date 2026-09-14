# ADR-0032: Supabase כשכבת הנתונים של הייצור

- **Status**: Accepted
- **Date**: 2026-09-14
- **Milestone**: Production Data Layer (ראה "שמות ומספור" למטה)
- **Requirement IDs**: `PROD-DATASOURCE-001`, `PROD-AUTHDB-001`, `PROD-SECRET-BOUNDARY-001`, `PROD-RLS-BEHAVIOUR-001`, `PROD-DOMAIN-PERSIST-001`, `PROD-PARTIAL-FAILCLOSED-001`, `PROD-HEALTH-002`

## הקשר

עד עכשיו למוצר היה מקור אמת אחד: `.data/household.json` על המחשב של המשפחה (`ADR-0024`). הסכמה ב־Supabase (15 מיגרציות, 32 טבלאות, 94 policies) הוחלה ואומתה ב־2026-09-14 (`docs/checkpoints/milestone-2.md`), אך **שום קוד באפליקציה לא קרא ממנה ולא כתב אליה**: `DataSourceKind` ידע רק `none | local_store | development_fixture`, ו־`lib/supabase/{client,server}.ts` מ־M2 לא יובאו על ידי אף מודול. `ADR-0031` הבטיח שפריסה מארחת מסרבת לקובץ — ולכן פריסה כזו עלתה ריקה.

מסמכי הסמכות:

- `07-SECURITY-PRIVACY.md § Authorization`: "DB-side RLS לכל טבלה פרטית; UI אינו גבול אבטחה … service role לעולם לא בבנדל". `§ Authentication`: "אימייל+סיסמה; WebAuthn/passkey כאשר נתמך".
- `05-ARCHITECTURE-DATA.md § גבולות`: "DB דרך layers … כספים לא נמחקים; void/correction. audit append-only".
- `02-FINANCIAL-RULES.md`: "void אינו נספר. correction יוצר היסטוריה, לא מחיקה".
- `CLAUDE.md`: "draft לא truth; uncertain לא safe; אין השלמה מדומה".

## החלטה

1. **זהות בייצור = Supabase Auth, אימייל וסיסמה.** ה־JWT של המשתמש המחובר הוא זהות ה־RLS: `auth.uid()` הוא מזהה הפרופיל, ו־policies שכבר הוכחו (38/38) ממשיכות לעבוד כמות שהן. Passkeys/WebAuthn נשארים אמצעי כניסה **מקומי** (`ADR-0028/0029`) ויוכלו להתווסף בעתיד כאמצעי שני; session מקומי של WebAuthn **אינו** זהות מסד בייצור.

2. **כל גישה רגילה למסד רצה כמשתמש המחובר.** השרת יוצר לקוח Supabase עם ה־session מה־cookies (`@supabase/ssr`) וקורא לפונקציות SQL בעלות `security invoker`; RLS הוא הסמכות בכל statement. הדפדפן מקבל URL + publishable key בלבד. service role / secret key: לעולם לא בדפדפן, לעולם לא `NEXT_PUBLIC_*`, ולא כתחליף להרשאת משתמש. שימוש מנהלתי מצומצם, אם יידרש, יהיה server-only, מנומק ב־ADR, ולא יעקוף בידוד משק בית. במילסטון הזה אין שימוש כזה.

3. **הפקודות הטהורות נשארות ההיגיון העסקי; המסד מקבל שכבת התמדה מנורמלת.** `HouseholdStore.run(command)` נשאר החוזה: טוענים את מסמך משק הבית (מ־32 הטבלאות, לא מרשומת JSON אחת), מפעילים את הפקודה הטהורה, ומחשבים את ההפרש. ההפרש נכתב לטבלאות בטרנזקציה אחת דרך `public.apply_household_changes(...)` — פונקציית `security invoker`, כך שכל insert/update עובר policy — עם נעילת שורת המשק ו־optimistic concurrency על `households.version`. הקריאה נעשית דרך `public.load_household_document(...)`, גם היא `security invoker`. כך כל אינווריאנט פיננסי (transfer net zero, צ׳ק ≠ תשלום, `approveBatch` כגבול היחיד) נשמר בדיוק כפי שנבדק ב־1,600+ בדיקות, ואטומיות מתקבלת מהמסד ולא ממנהל טרנזקציות משלנו.

4. **מעבר מדורג, תחום אחרי תחום, ללא ערבוב מקורות בפעולה אחת.** כל תחום (זהות, חשבונות, תנועות, יבוא, תקציב, חובות, גמ״ח וצ׳קים, דוחות, תפעול) מקבל מיפוי, בדיקות אינטגרציה מול המסד ב־rollback, ובדיקות parity מול החנות המקומית. פעולה אחת לעולם אינה כותבת גם לקובץ וגם למסד.

5. **פריסה מארחת חלקית נכשלת סגור.** `resolveDataSource` מחזיר `supabase` רק כשהתצורה הציבורית קיימת, יש session מאומת, וכל התחומים הנדרשים מוצהרים כשלמים. חסר משהו — `kind: 'none'` עם אבחון תפעולי; לעולם לא `local_store`, לעולם לא `development_fixture`, לעולם לא הצלחה סינתטית. `/api/health` מבחין בין תצורה חסרה, מקור מאומת לא זמין, מסד לא נגיש, אי־התאמת סכמה ומוכנות — בלי סודות, בלי host/ref, בלי מזהי משתמש, בלי שגיאות מסד גולמיות.

6. **החנות המקומית נשארת רק לפיתוח מקומי מפורש** (`FAMILY_FINANCE_DATA_BACKEND=local_json` על origin מקומי) ולכלי מיגרציה מאושרים. יבוא `.data/household.json` למסד אינו חלק מהמילסטון ודורש אישור נפרד.

7. **`audit_events` נשאר append-only.** ה־triggers לא מוחלשים. מחיקת household/profile/auth.user עם היסטוריית audit אינה מחיקה רגילה; תהליך ארכוב/אנונימיזציה יוגדר בנפרד (ראה `docs/checkpoints/milestone-2.md`).

8. **תיקוני סכמה — רק במיגרציה קדימה.** המיגרציות שהוחלו אינן נערכות. `20260914*` מוסיפה: `create_household()` (עד היום לא היה מסלול שבו יוצר משק בית הופך לחבר בו), `create_household_invitation()`, עמודות provenance ליבוא (`import_batch_id` וכו׳), עמודות שהחוזים דורשים והמסד חסר (`businesses.operating_reserve_minor`, שדות `family_tasks`, `import_batches.summary/warnings/rejected_at`, ערך enum `dismissed`), ו־**`voided_at`** ל־`account_balance_snapshots` ול־`debt_events`.

9. **ביטול יבוא והסרת פריט צפוי אינם מוחקים במסד.** ה־`reverseBatch` המקומי מחק snapshots ואירועי חוב שהיבוא יצר, ו־`removePlannedItem` מחק פריט — בניגוד ל־"כספים לא נמחקים; void/correction". במסד הם **מסומנים** (`voided_at`, `removed_at`): שורה שנעלמה מתוצאת הפקודה מתורגמת לסימון, `load_household_document()` אינו מחזיר שורות מסומנות, ו־trigger מאפשר על שתי הטבלאות ה־append-only שינוי אחד בלבד — הסימון, פעם אחת. הפקודות הטהורות והחנות המקומית (נתיב פיתוח מקומי בלבד, §6) לא שונו; שער המיגרציות ממשיך לאכוף ש־`transaction_splits` היא טבלת ה־DELETE היחידה.

## חלופות שנשקלו

| חלופה | יתרון | חיסרון | מדוע נדחתה |
|---|---|---|---|
| WebAuthn עצמי + חיבור `pg` עם service role והזרקת claims | אין תלות ב־Supabase Auth | השרת מחזיק סיסמת מסד; באג אחד מדלג על `set role` והבידוד נעלם | סותר החלטות 3–6; RLS מפסיק להיות הסמכות |
| כתיבות ישירות דרך supabase-js, טבלה־טבלה | פשוט לכתיבה | אין אטומיות בין בקשות; אישור יבוא שנקטע משאיר חצי | סותר "approval all-or-nothing" |
| כתיבת דומיין מחדש כ־repositories ב־SQL | "טבעי" למסד | משכפל ~3,000 שורות היגיון מבודק; סיכון רגרסיה עצום | סותר "שמירת התנהגות ואינווריאנטים" |
| שמירת המסמך כ־JSON ברשומה אחת | אפס מיפוי | מבטל את הסכמה המנורמלת, את ה־RLS ואת ה־triggers | נאסר במפורש |
| מחיקה בביטול יבוא (כמו היום מקומית) | parity מדויק עם ההתנהגות הקיימת | סותר את החוקה; דורש policy מחיקה על רשומות כסף | האינווריאנט גובר על ההתנהגות |

## השלכות

- חיוביות: RLS מוכח נשאר הסמכות; שכבת דומיין אחת; אטומיות מהמסד; פריסה חלקית לא יכולה להיראות תקינה; החנות המקומית ממשיכה לעבוד למפתח.
- הוכח בפועל (2026-09-15): 231 בדיקות אינטגרציה ב־rollback, 17 מהן דרך ה־store על תשעת התחומים; `verify` exit 0; fail-closed 9/9. הריצה החיה דרך Supabase Auth/PostgREST כתובה וממתינה ל־publishable key מקומי (`docs/checkpoints/production-data-layer.md`).
- שליליות ועלות: כל פעולה טוענת את מסמך המשק (סדר גודל של אלפי שורות — כמו היום מהקובץ); פונקציית apply ב־plpgsql דורשת מיפוי מפורש לכל טבלה; הוספת חבר = הזמנה באימייל (זהות אמיתית), לא יצירת פרופיל מקומי; שחזור מגיבוי לתוך המסד אינו נתמך במילסטון הזה (רשומות כסף אינן ניתנות להחלפה) ומדווח כך במפורש.
- מה נדרש לאמת בבדיקות: allow/deny לכל 32 הטבלאות; load/apply לכל תחום ב־rollback; parity מול local-store; fail-closed ב־resolution וב־health; היעדר local-store בנתיב ייצור; ניקיון המסד אחרי כל ריצה.

## שמות ומספור

`09-MILESTONES.md` קורא ל־"9" OCR/Voice/Email; `ADR-0031` והמיגרציות `20260908*` השתמשו ב־"Milestone 9 — Production Readiness" למסלול הייצור. שני השמות נשארים בהיסטוריה כפי שנכתבו. מכאן והלאה מסלול הייצור נקרא בשמו: **Phase 0** (מצב), **Phase 1** (fail-closed, `ADR-0031`), **Phase 2/4** (סכמה + RLS לטבלאות M7–M8), **Production Data Layer** (ADR זה) — ולאחריו כניסה על דומיין, אירוח, גיבוי/שחזור ו־UAT (M14).

## תנאי ביטול

Supabase Auth מפסיק לתמוך באימייל+סיסמה; נדרש מודל הרשאות שאינו "שני שותפים שווים"; או שהעומס של טעינת מסמך שלם לכל פעולה נמדד כבעיה אמיתית — ואז המעבר לקריאות ממוקדות ייעשה תחום־תחום, מאחורי אותו חוזה.
