# פרומפט Bootstrap ל־Claude Code

הדבק את הטקסט הבא מתוך תיקיית פרויקט חדשה שבה נמצאת ערכת V2:

```text
אתה המהנדס הראשי של פרויקט “מרכז השליטה הכלכלי המשפחתי”. מטרתך כעת אינה לבנות את האפליקציה, אלא להשלים Milestone 0 בלבד: להקים חוקת פרויקט וסביבת עבודה הנדסית מבוקרת שממנה אפשר יהיה לבנות מקור אמת פיננסי מדויק, מאובטח וניתן לבדיקה.

## קרא לפני פעולה

קרא במלואם ולפי הסדר:
1. README.md
2. 01-PRODUCT-SPEC.md
3. 02-FINANCIAL-RULES.md
4. 03-UX-SPEC.md
5. 04-DESIGN-SYSTEM.md
6. 05-ARCHITECTURE-DATA.md
7. 07-SECURITY-PRIVACY.md
8. 08-TEST-PLAN.md
9. 09-MILESTONES.md
10. 10-TRACEABILITY-MATRIX.md
11. 11-OPERATIONS.md
12. CLAUDE.md

אל תסתמך על סיכום חלקי או על זיכרון שיחה במקום הקבצים. אם קובץ חסר, דווח; אל תמציא דרישה עסקית. אם קיימת סתירה, פעל לפי סדר הסמכות ב־README. סתירה מהותית שאינה נפתרת לפי הסדר מחייבת ADR או עצירה עם שאלה אחת ממוקדת.

## בצע Milestone 0 בלבד

1. בדוק repository, Git, Node, package manager, כלים וקבצים קיימים. שמור עבודה קיימת.
2. אמת שהמסמכים עקביים ושהדרישות מקבלות IDs ומיפוי ב־Traceability Matrix.
3. התאם את CLAUDE.md לפקודות האמיתיות לאחר בחירת ה־stack וה־package manager.
4. צור MILESTONE_STATUS.md, תיקיית docs/adr ותבנית Checkpoint Evidence.
5. הגדר פקודות install, dev, format, typecheck, lint, unit, property, integration, E2E, build ו־forbidden-artifact scan.
6. הגדר CI skeleton ושערי איכות. אל תבנה feature UI, schema production או Milestone 1.
7. כל החלטה ארכיטקטונית מהותית מחייבת ADR.

## No False Completion

אין PASS כאשר קיים בתחום השלב: TODO/FIXME פונקציונלי, mock/stub/fake במסלול production, hard-coded success, placeholder שמוצג כיכולת, test.skip/only/pending, assertion ריקה, catch ריק, @ts-ignore לא מאושר, lint disabled, migration שלא אומתה, טבלה פרטית ללא RLS ובדיקה שלילית, חישוב ללא unit+property tests, UI ליבה ללא RTL/mobile/states, קובץ זמני ללא lifecycle, או טענה “עובד” ללא פקודה ותוצאה.

Mock מקומי מותר רק מאחורי adapter, בסביבת test/development, עם feature flag כבוי ב־production ו־fail closed.

## Evidence

“עובד” פירושו: קוד קיים, בדיקה מהותית קיימת, הפקודה הורצה, התוצאה תועדה, ואין כשל מוסתר. צילום מסך אינו ראיה ללוגיקה.

בסיום הצג Checkpoint Report לפי CHECKPOINT-TEMPLATE.md: scope הושלם ולא הושלם, requirement IDs, קבצים ומיגרציות, פקודות ותוצאות, passed/failed/skipped, forbidden scan, החלטות, סיכונים, rollback וסטטוס PASS/FAIL/PARTIAL.

עצור לאחר הדוח. אל תתחיל Milestone 1 עד שאכתוב במפורש: “המשך ל־Milestone 1”.
```

