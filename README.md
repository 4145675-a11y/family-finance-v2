# מרכז השליטה הכלכלי המשפחתי — ערכת V2

ערכת חוקה והפעלה ל־Claude Code. אין להדביק את כל הקבצים בשיחה אחת. מעתיקים את התיקייה לפרויקט, מדביקים רק את `00-BOOTSTRAP-PROMPT.md`, ונותנים ל־Claude לעבוד בכל פעם על milestone יחיד.

## סדר המסמכים וסמכותם

1. בטיחות, פרטיות ושלמות נתונים.
2. `02-FINANCIAL-RULES.md` בכל מספר וחישוב.
3. `01-PRODUCT-SPEC.md` בהתנהגות המוצר.
4. `07-SECURITY-PRIVACY.md` באבטחה והרשאות.
5. `03-UX-SPEC.md` ו־`04-DESIGN-SYSTEM.md` בממשק.
6. `05-ARCHITECTURE-DATA.md` במימוש.
7. `08-TEST-PLAN.md` באימות.
8. `09-MILESTONES.md` בסדר העבודה.

סתירה אינה נפתרת בשקט. יש לתעד ADR או לעצור לשאלה אחת ממוקדת.

## קבצים

- `00-BOOTSTRAP-PROMPT.md` — הטקסט היחיד שמדביקים בתחילת הפרויקט.
- `01-PRODUCT-SPEC.md` — חזון, משתמשים, תכולה וגבולות.
- `02-FINANCIAL-RULES.md` — חוקת הכסף, מצב ייצוב, חובות ונוסחאות.
- `03-UX-SPEC.md` — מסכים, זרימות, מצבים ומיקרו־קופי.
- `04-DESIGN-SYSTEM.md` — tokens ורכיבי עיצוב מחייבים.
- `05-ARCHITECTURE-DATA.md` — ארכיטקטורה, schema, offline, imports ו־AI.
- `07-SECURITY-PRIVACY.md` — threat model, RLS, retention וגיבוי.
- `08-TEST-PLAN.md` — בדיקות, evidence ושערי איכות.
- `09-MILESTONES.md` — milestones 0–14, כל אחד עם עצירה.
- `10-TRACEABILITY-MATRIX.md` — דרישה → מימוש → בדיקה → milestone.
- `11-OPERATIONS.md` — סביבות, פריסה, ניטור ושחזור.
- `CLAUDE.md` — חוקי העבודה הקצרים שקלוד קורא בכל session.
- `CHECKPOINT-TEMPLATE.md` — תבנית ראיות מחייבת.

## כלל הפעלה

Claude אינו ממשיך לשלב הבא עד שהמשתמש כותב במפורש: `המשך ל־Milestone N`.

