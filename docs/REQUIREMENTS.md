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
| `PROD-CORE-001` | כמה כסף בטוח פנוי עד סוף החודש | 01-PRODUCT-SPEC.md § חזון | 5–6 | Registered |
| `PROD-CORE-002` | האם החוב נטו יורד או גדל | 01-PRODUCT-SPEC.md § חזון | 4–6 | Registered |
| `PROD-CORE-003` | מה הפעולה האחת המעשית עכשיו | 01-PRODUCT-SPEC.md § חזון | 6/12 | Registered |
| `PROD-KPI-001` | מעל 90% מהפעולות מאושרות/מסווגות אחרי 30 יום | 01-PRODUCT-SPEC.md § הצלחה | 8 | Registered |
| `PROD-KPI-002` | התאמת יתרות 2–3 פעמים בשבוע | 01-PRODUCT-SPEC.md § הצלחה | 3/8 | Registered |
| `PROD-KPI-003` | המשתמש יודע מהו safe spend | 01-PRODUCT-SPEC.md § הצלחה | 6 | Registered |
| `PROD-KPI-004` | כל העברה מהעסק מבוססת רווח ממומש אחרי מס ורזרבה | 01-PRODUCT-SPEC.md § הצלחה | 11 | Registered |
| `PROD-KPI-005` | נמדדת מגמת חוב נטו ולא רק תשלומים | 01-PRODUCT-SPEC.md § הצלחה | 4–6 | Registered |
| `PROD-KPI-006` | פחות הפתעות ופחות לחץ מדווח | 01-PRODUCT-SPEC.md § הצלחה | 14 | Registered |
| `FIN-MONEY-001` | amount_minor integer לא־שלילי; משמעות מ־direction/type | 02-FINANCIAL-RULES.md § מוסכמות | 3/5 | Registered |
| `FIN-MODE-001` | ששת מצבי ההתנהלות ותנאי המעבר ביניהם | 02-FINANCIAL-RULES.md § מצבי ההתנהלות | 5 | Registered |
| `FIN-WATERFALL-001` | סדר הקצאת כסף פנוי בעשרה שלבים | 02-FINANCIAL-RULES.md § מפל הקצאת כסף | 5 | Registered |
| `FIN-ROLL-001` | גלגול חוב: פירעון, חוב חדש וקישור כשלוש עובדות נפרדות | 02-FINANCIAL-RULES.md § גלגול חוב והחלפת נושה | 4–6 | Registered |
| `UX-HOME-001` | שלוש תשובות הליבה מובנות תוך 10 שניות | 03-UX-SPEC.md § קבלה | 6 | Registered |
| `UX-TRUST-001` | כל מספר מרכזי מסביר מקור/זמן/confidence | 03-UX-SPEC.md § קבלה | 6 | Registered |
| `UX-RTL-001` | אין horizontal overflow ב־360/390/768/1280 | 03-UX-SPEC.md § קבלה | 1/6 | Registered |
| `UX-A11Y-001` | WCAG 2.2 AA, מקלדת, focus, labels, reduced motion, text scaling | 03-UX-SPEC.md § קבלה | 1/6/14 | Registered |
| `UX-STATE-001` | כל המצבים המחייבים קיימים ונבדקו בכל core screen | 03-UX-SPEC.md § מצבים מחייבים | 6+ | Registered |
| `UX-DEBT-002` | כרטיס "מה קרה באמת לחוב" וציר זמן מקושר | 03-UX-SPEC.md § מסכים | 6 | Registered |
| `SEC-RLS-001` | RLS על כל טבלה פרטית עם בדיקות שליליות בשני households | 07-SECURITY-PRIVACY.md § Authorization | 2+ | Registered |
| `OFF-SYNC-001` | mutation offline עם idempotency, concurrency ו־conflict גלוי | 05-ARCHITECTURE-DATA.md § Offline | 7 | Registered |
| `IMP-DRAFT-001` | כל יבוא הוא draft עד אישור; קובץ נמחק לפי state machine | 05-ARCHITECTURE-DATA.md § Imports | 8 | Registered |
| `AI-TOOL-001` | AI מקבל JSON מצומצם מכלי שרת בלבד; מסמך/מייל אינם הוראות | 05-ARCHITECTURE-DATA.md § Advisor tools, 07-SECURITY-PRIVACY.md § AI/Email | 12 | Registered |

## פערים ידועים שנרשמו ב־Milestone 0

1. `UX-DEBT-001` אינו מוקצה. המטריצה המקורית פותחת ב־`UX-DEBT-002`. המזהה שמור ואינו יוקצה מחדש לדרישה אחרת.
2. מסמכי `04-DESIGN-SYSTEM.md`, `05-ARCHITECTURE-DATA.md`, `07-SECURITY-PRIVACY.md`, `08-TEST-PLAN.md` ו־`11-OPERATIONS.md` נושאים דרישות מחייבות ללא תוויות מזהה בגוף הטקסט. חמישה מזהים מהם כבר נרשמו כאן דרך המטריצה (`SEC-RLS-001`, `OFF-SYNC-001`, `IMP-DRAFT-001`, `AI-TOOL-001`, ובעקיפין `UX-STATE-001`). שאר הדרישות באותם מסמכים יקבלו מזהים ב־milestone שמממש אותן, לפי כלל ההרחבה למעלה. Milestone 0 לא המציא דרישות חדשות ולא שינה טקסט סמכותי.
3. אין מסמך במספר `06`. הרצף `05` → `07` עקבי בין README, פרומפט ה־bootstrap ורשימת הקבצים בפועל, ולכן זהו פער מספור ולא קובץ חסר.
