# REQUIREMENTS REGISTRY

מרשם מזהי הדרישות. נוצר ב־Milestone 0 לפי `ADR-0004`.

המרשם **אינו** מקור סמכות עסקי. הסמכות נשארת במסמכי החוקה לפי סדר ה־README. המרשם מרכז את המזהים, מצמיד לכל מזהה את מקורו המדויק, ומאפשר לשער `check:traceability` לאכוף שאין דרישה ללא מיפוי ואין מיפוי ללא דרישה.

## סכמת מזהים

`DOMAIN-TOPIC-NNN`

- `DOMAIN`: `PROD` (מוצר), `FIN` (כספים), `UX`, `SEC`, `OFF` (offline/sync), `IMP` (imports), `AI`.
- `TOPIC`: נושא קצר באותיות גדולות.
- `NNN`: מספר רץ תלת־ספרתי בתוך הנושא.

מזהה שהוקצה אינו ממוחזר ואינו משנה משמעות. שינוי משמעות מחייב מזהה חדש ו־ADR.

## כלל הרחבה

כל milestone חייב לרשום כאן מזהה לכל דרישה שהוא ממש, לפני שהוא מסמן אותה Done במטריצה. `npm run check:traceability` נכשל כאשר מזהה מופיע במסמך סמכות ואינו במרשם, כאשר מזהה רשום חסר שורה במטריצה, או כאשר המטריצה ממפה מזהה לא רשום.

## מרשם

| ID | דרישה | מקור | Milestone | סטטוס |
|---|---|---|---:|---|
| `PROD-CORE-001` | כמה כסף בטוח פנוי עד סוף החודש | 01-PRODUCT-SPEC.md § חזון | 5–6 | Implemented (M5–M6) — לא אומת מול נתוני אמת |
| `PROD-CORE-002` | האם החוב נטו יורד או גדל | 01-PRODUCT-SPEC.md § חזון | 4–6 | Implemented (M4–M6) — לא אומת מול נתוני אמת |
| `PROD-CORE-003` | מה הפעולה האחת המעשית עכשיו | 01-PRODUCT-SPEC.md § חזון | 6/12 | Implemented (M6) |
| `PROD-KPI-001` | מעל 90% מהפעולות מאושרות/מסווגות אחרי 30 יום | 01-PRODUCT-SPEC.md § הצלחה | 8 | Registered |
| `PROD-KPI-002` | התאמת יתרות 2–3 פעמים בשבוע | 01-PRODUCT-SPEC.md § הצלחה | 3/8 | Registered |
| `PROD-KPI-003` | המשתמש יודע מהו safe spend | 01-PRODUCT-SPEC.md § הצלחה | 6 | Implemented (M6b) — תשובה דומיננטית אחת בשפה פשוטה |
| `PROD-KPI-004` | כל העברה מהעסק מבוססת רווח ממומש אחרי מס ורזרבה | 01-PRODUCT-SPEC.md § הצלחה | 11 | Registered |
| `PROD-KPI-005` | נמדדת מגמת חוב נטו ולא רק תשלומים | 01-PRODUCT-SPEC.md § הצלחה | 4–6 | Implemented (M4–M6) |
| `PROD-KPI-006` | פחות הפתעות ופחות לחץ מדווח | 01-PRODUCT-SPEC.md § הצלחה | 14 | Registered |
| `FIN-MONEY-001` | amount_minor integer לא־שלילי; משמעות מ־direction/type | 02-FINANCIAL-RULES.md § מוסכמות | 3/5 | Verified (M3, M5) |
| `FIN-MODE-001` | ששת מצבי ההתנהלות ותנאי המעבר ביניהם | 02-FINANCIAL-RULES.md § מצבי ההתנהלות | 5 | Verified (M5) |
| `FIN-WATERFALL-001` | סדר הקצאת כסף פנוי בעשרה שלבים | 02-FINANCIAL-RULES.md § מפל הקצאת כסף | 5 | Verified (M5) |
| `FIN-ROLL-001` | גלגול חוב: פירעון, חוב חדש וקישור כשלוש עובדות נפרדות | 02-FINANCIAL-RULES.md § גלגול חוב והחלפת נושה | 4–6 | Verified (M5) — נבדק גם כ־property |
| `UX-HOME-001` | שלוש תשובות הליבה מובנות תוך 10 שניות | 03-UX-SPEC.md § קבלה | 6 | Structure built (M6b) — היררכיה נאכפת בבדיקה; בדיקת משתמש טרם בוצעה |
| `UX-TRUST-001` | כל מספר מרכזי מסביר מקור/זמן/confidence | 03-UX-SPEC.md § קבלה | 6 | Verified (M6b) — כל מספר פותח פירוט; כיסוי הניסוח נאכף |
| `UX-RTL-001` | אין horizontal overflow ב־360/390/768/1280 | 03-UX-SPEC.md § קבלה | 1/6 | Partial (M1 shell) |
| `UX-A11Y-001` | WCAG 2.2 AA, מקלדת, focus, labels, reduced motion, text scaling | 03-UX-SPEC.md § קבלה | 1/6/14 | Partial (M6b) — ניגודיות, focus, 44px, טקסט חלופי; axe/מקלדת בדפדפן לא הורצו |
| `UX-STATE-001` | כל המצבים המחייבים קיימים ונבדקו בכל core screen | 03-UX-SPEC.md § מצבים מחייבים | 6+ | Partial (M6b) — empty/incomplete/stale/demo/coming-soon קיימים; offline/conflict ב־M7 |
| `UX-DEBT-002` | כרטיס "מה קרה באמת לחוב" וציר זמן מקושר | 03-UX-SPEC.md § מסכים | 6 | Implemented (M6) |
| `SEC-RLS-001` | RLS על כל טבלה פרטית עם בדיקות שליליות בשני households | 07-SECURITY-PRIVACY.md § Authorization | 2+ | Implemented, unverified (M2–M4) |
| `SEC-INVITE-001` | invitation token hashed, חד־פעמי, ניתן לביטול ופג תוקף | 07-SECURITY-PRIVACY.md § Authorization | 2 | Implemented, unverified (M2) |
| `SEC-AUDIT-001` | audit append-only באכיפת DB; before/after מצומצמים ללא secrets | 07-SECURITY-PRIVACY.md § Audit | 2+ | Implemented, unverified (M2–M4) |
| `SEC-KEY-001` | service role לעולם לא בבנדל; לקוח מקבל publishable key בלבד | 07-SECURITY-PRIVACY.md § Authorization | 2+ | Verified (M2) |
| `OFF-SYNC-001` | mutation offline עם idempotency, concurrency ו־conflict גלוי | 05-ARCHITECTURE-DATA.md § Offline | 7 | Registered |
| `IMP-DRAFT-001` | כל יבוא הוא draft עד אישור; קובץ נמחק לפי state machine | 05-ARCHITECTURE-DATA.md § Imports | 8 | Registered |
| `AI-TOOL-001` | AI מקבל JSON מצומצם מכלי שרת בלבד; מסמך/מייל אינם הוראות | 05-ARCHITECTURE-DATA.md § Advisor tools, 07-SECURITY-PRIVACY.md § AI/Email | 12 | Registered |
| `FIN-ACCOUNT-001` | חשבונות, יתרות פתיחה ו־snapshot יתרה מאומת מול המוסד | 05-ARCHITECTURE-DATA.md § Reconciliation | 3 | Implemented, DB unverified (M3) |
| `FIN-SCOPE-001` | בית ועסק נפרדים; consolidated נגזר; transfer אינו הכנסה/הוצאה | 02-FINANCIAL-RULES.md § Scopes ותנועות | 3/5 | Verified (M5) |
| `FIN-DEBT-001` | אירועי חוב הם האמת; יתרה מחושבת בשחזור ואינה נשמרת | 02-FINANCIAL-RULES.md § גלגול חוב והחלפת נושה | 4 | Implemented, DB unverified (M4) |
| `FIN-RESERVE-001` | רצפת הרזרבה היא הגבוה מארבעה רכיבים, והרכיב שקבע מוצג | 02-FINANCIAL-RULES.md § רזרבה מינימלית | 5 | Verified (M5) |
| `FIN-STRESS-001` | שישה תרחישי לחץ עם נקודת שפל, יום כשל, פער ומחויבויות בסיכון | 02-FINANCIAL-RULES.md § Stress tests | 5 | Verified (M5) |
| `FIN-QUALITY-001` | ציון איכות נתונים 0–100 עם רכיבים ומשקלים מתועדים | 02-FINANCIAL-RULES.md § איכות נתונים | 5 | Verified (M5) — ADR-0016 |
| `FIN-DECISION-001` | כל תוצאה מוחזרת במעטפת החלטה מלאה עם breakdown וגרסאות | 02-FINANCIAL-RULES.md § פלט החלטה מחייב | 5 | Verified (M5) |
| `UX-SOURCE-001` | מקור נתונים שאינו אמיתי מסומן חזותית בכל מסך שמציג אותו | 08-TEST-PLAN.md § שער גלובלי | 6 | Verified (M6) — ADR-0017 |
| `UX-DAILY-001` | מסך הבית עונה על שלוש שאלות הליבה בלבד; הפירוט רמה אחת פנימה | 01-PRODUCT-SPEC.md § מסך הבית | 6b | Verified (M6b) — ADR-0021 |
| `UX-COPY-001` | עברית פשוטה, חמה ולא מאשימה; ז׳רגון והאשמה נחסמים בשער | 03-UX-SPEC.md § Microcopy | 6b | Verified (M6b) — ADR-0022 |
| `FIN-BUDGET-001` | תקציב חודשי עם שש כמויות נפרדות; תוכנית אינה מזיזה כסף | 03-UX-SPEC.md § מסכים | 6b | Verified (M6b), DB unverified |
| `FIN-FOODWEEK-001` | הנחיה שבועית לאוכל שלעולם אינה גדולה ממה שנשאר לחודש | 01-PRODUCT-SPEC.md § Must | 6b | Verified (M6b) — ADR-0023 |

## פערים ידועים שנרשמו ב־Milestone 0

1. `UX-DEBT-001` אינו מוקצה. המטריצה המקורית פותחת ב־`UX-DEBT-002`. המזהה שמור ואינו יוקצה מחדש לדרישה אחרת.
2. מסמכי `04-DESIGN-SYSTEM.md`, `05-ARCHITECTURE-DATA.md`, `07-SECURITY-PRIVACY.md`, `08-TEST-PLAN.md` ו־`11-OPERATIONS.md` נושאים דרישות מחייבות ללא תוויות מזהה בגוף הטקסט. חמישה מזהים מהם כבר נרשמו כאן דרך המטריצה (`SEC-RLS-001`, `OFF-SYNC-001`, `IMP-DRAFT-001`, `AI-TOOL-001`, ובעקיפין `UX-STATE-001`). שאר הדרישות באותם מסמכים יקבלו מזהים ב־milestone שמממש אותן, לפי כלל ההרחבה למעלה. Milestone 0 לא המציא דרישות חדשות ולא שינה טקסט סמכותי.
3. אין מסמך במספר `06`. הרצף `05` → `07` עקבי בין README, פרומפט ה־bootstrap ורשימת הקבצים בפועל, ולכן זהו פער מספור ולא קובץ חסר.
| `LOCAL-STORE-001` | מקור אמת מקומי בעל גרסת פורמט, נכתב אטומית, עם audit append-only | 05-ARCHITECTURE-DATA.md § גבולות | 7 | Verified (M7) — ADR-0024; 85 בדיקות ב־packages/local-store |
| `LOCAL-BACKUP-001` | גיבוי מקומי עם checksum, תצוגה מקדימה לפני שחזור, ודחייה מנומקת של קובץ פגום | 11-OPERATIONS.md § גיבוי | 7 | Verified (M7) — ADR-0024 |
| `IMP-PARSE-001` | קריאת xlsx, csv ו־PDF טקסטואלי מקומית, עם provenance לכל שורה | 05-ARCHITECTURE-DATA.md § Imports | 7 | Verified (M7) — ADR-0025 |
| `IMP-SAFETY-001` | חתימת קובץ, גבולות פריסה, איסור מאקרו ונוסחאות, ואיסור בניית נתיב משם שהמשתמש נתן | 07-SECURITY-PRIVACY.md § Uploads | 7 | Verified (M7) — ADR-0025 |
| `IMP-APPROVE-001` | שום הצעת יבוא אינה משנה יתרה, תקציב, חוב או תחזית לפני אישור מפורש; היפוך אפשרי | 05-ARCHITECTURE-DATA.md § Imports | 7 | Verified (M7) |
| `ENTRY-MANUAL-001` | הזנה ידנית מלאה: חשבון, יתרה, הוצאה, הכנסה, העברה, פריט צפוי, חוב, תשלום חוב, גלגול, תקציב, משימה | 01-PRODUCT-SPEC.md § Must | 7 | Verified (M7) |
| `REP-EXPORT-001` | דוחות מקומיים עם תקופה, חותמת זמן והפרדה בין מאושר לממתין; ייצוא xlsx ו־CSV | 05-ARCHITECTURE-DATA.md § Reports | 7 | Verified (M7) — ADR-0026; PDF דרך הדפסת הדפדפן |
| `PWA-INSTALL-001` | manifest, אייקונים ו־service worker שאינו מגיש מסך פיננסי מהמטמון | 05-ARCHITECTURE-DATA.md § Offline | 7 | Verified (M7) |
| `PROD-FAILCLOSED-001` | build של ייצור שמוגדר לחנות המקומית מסרב לעלות; אין דגל שפותח את הדלת | 05-ARCHITECTURE-DATA.md § גבולות | 9 | Verified (M9) — ADR-0031; 37 בדיקות יחידה + 7 בדיקות מול שרת שרץ |
| `PROD-HEALTH-001` | נקודת בריאות ציבורית שמדווחת תצורה בלבד — בלי מידע פיננסי, בלי סודות, בלי ערכים | 07-SECURITY-PRIVACY.md § Operations | 9 | Verified (M9) — נבדק שהתשובה נקייה מאוצר מילים פיננסי |
| `PROD-NOENV-001` | אף קובץ סביבה אינו במעקב git ואינו בתוך תוצר ה־build | 07-SECURITY-PRIVACY.md § Secrets | 9 | Verified (M9) — שער check:no-env-files |
| `AUTH-PASSKEY-001` | כניסה לאפליקציה מאומתת ב־WebAuthn מול Windows Hello; אימות משתמש נדרש, לא רק נוכחות | 07-SECURITY-PRIVACY.md § Access | 8 | Verified (M8) — ADR-0029; 70 בדיקות פרוטוקול מול מאמת תוכנה אמיתי |
| `AUTH-NOBIO-001` | האפליקציה אינה מקבלת, שומרת, רושמת או מייצאת טביעת אצבע או תבנית ביומטרית | 07-SECURITY-PRIVACY.md § Privacy | 8 | Verified (M8) — הסכימה מכילה מפתח ציבורי ומזהה בלבד |
| `AUTH-SESSION-001` | עוגיית סשן httpOnly עם טוקן אקראי; אתגר חד־פעמי וקצוב; נעילה מחדש לפי חוסר פעילות ותקרה מוחלטת | 07-SECURITY-PRIVACY.md § Sessions | 8 | Verified (M8) — ADR-0028; 42 בדיקות מדיניות |
| `AUTH-REAUTH-001` | אימות חוזר לפני שחזור גיבוי, ייצוא כל הנתונים ושינוי מפתחות הכניסה | 07-SECURITY-PRIVACY.md § Access | 8 | Verified (M8) — נאכף גם במסלול ה־GET של הייצוא |
| `GEM-MODEL-001` | גמ״ח כסוג חוב נפרד עם ריבית אפס מפורשת, תוכנית החזר, וצ׳קים דחויים כישויות עם מצב ומעברים מאומתים | 02-FINANCIAL-RULES.md § חוב | 8 | Verified (M8) — ADR-0030; 55 בדיקות + 5 property |
| `GEM-DELIVERY-001` | מסירת צ׳ק אינה מקטינה יתרה בבנק ואינה מקטינה חוב; רק פירעון בפועל מקטין, ופעם אחת | 02-FINANCIAL-RULES.md § אינווריאנטים | 8 | Verified (M8) — property: תזוזת מזומן = ירידת חוב בכל רצף פעולות |
| `GEM-FORECAST-001` | צ׳ק שנמסר ולא נפרע נכלל בתחזית פעם אחת בדיוק; תוכנית ההחזר אינה מוסיפה חיוב מקביל | 02-FINANCIAL-RULES.md § תחזית | 8 | Verified (M8) — צ׳ק שעבר תאריך מוסט להיום כדי שלא ייעלם מהחלון |
| `GEM-MATCH-001` | התאמת חיוב מיובא לצ׳ק מוצעת עם נימוקים ורמת ביטחון, אינה מאושרת אוטומטית, ונשארת בלתי מוכרעת כשיש שתי אפשרויות שקולות | 05-ARCHITECTURE-DATA.md § Imports | 8 | Verified (M8) — אישור חוזר נדחה בשם על ידי מצב הצ׳ק |
