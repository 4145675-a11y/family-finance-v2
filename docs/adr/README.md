# ADR — Architecture Decision Records

`CLAUDE.md` מחייב ADR לכל שינוי מהותי. ADR נדרש עבור: בחירת או החלפת stack/package manager, שינוי מודל נתונים או גבול ארכיטקטוני, שינוי כלל פיננסי או משקל ב־data quality, ויתור על שער איכות או הוספת החרגה, שינוי מודל הרשאות/RLS, ושינוי מדיניות retention או פרטיות.

## נוהל

1. העתק את `0000-template.md` למספר הפנוי הבא: `NNNN-kebab-title.md`.
2. מלא הקשר, החלטה, חלופות שנשקלו והשלכות. חלופה שנדחתה מקבלת סיבה.
3. ADR שהתקבל אינו נמחק ואינו נערך בדיעבד. החלפה נעשית ב־ADR חדש עם `Superseded by`.
4. ADR מוזכר בדוח ה־Checkpoint של ה־milestone שבו התקבל.

## אינדקס

| ADR | כותרת | סטטוס | Milestone |
|---|---|---|---:|
| [0001](0001-package-manager-npm.md) | npm כ־package manager, עם cache בתוך הפרויקט | Accepted | 0 |
| [0002](0002-stack-version-baseline.md) | תיעוד גרסאות stable שנמדדו ב־bootstrap | Accepted | 0 |
| [0003](0003-no-dependencies-in-milestone-0.md) | Milestone 0 אינו מתקין תלויות; חוזה פקודות במקום scripts מדומים | Accepted | 0 |
| [0004](0004-requirements-registry.md) | מרשם דרישות נפרד במקום עריכת מסמכי הסמכות | Accepted | 0 |
| [0005](0005-forbidden-scan-self-exclusion.md) | טבלת הכללים של ה־forbidden scan מוחרגת ומכוסה בבדיקות | Accepted | 0 |
| [0006](0006-locked-dependency-versions.md) | נעילת גרסאות — שתי סטיות מהבסיס של ADR-0002 | Accepted | 1 |
| [0007](0007-workspace-layout.md) | מבנה workspaces — רק חבילות עם תוכן אמיתי | Accepted | 1 |
| [0008](0008-design-token-contrast.md) | שתי התאמות ב־palette לאחר אימות ניגודיות | Accepted | 1 |
| [0009](0009-single-test-runner.md) | Vitest כ־runner יחיד; בדיקות ללא JSX | Accepted | 1 |
| [0010](0010-framework-telemetry-disabled.md) | טלמטריית Next מושבתת ב־CI | Superseded by 0011 | 1 |
| [0011](0011-next-launcher-telemetry.md) | launcher שאוכף חסימת טלמטריה בכל פלטפורמה | Accepted | 1 |
| [0012](0012-no-generated-agent-instruction-files.md) | אף תלות אינה כותבת קובצי הוראות לסוכנים במאגר | Accepted | 1 |
| [0013](0013-publishable-key-everywhere.md) | publishable key בלקוח ובשרת; אין service role במסלול בקשה | Accepted | 2 |
| [0014](0014-isolation-by-membership.md) | בידוד לפי חברות בלבד; אין הצטרפות עצמית ואין מחיקה | Accepted | 2 |
| [0015](0015-idempotent-migrations.md) | כל migration ניתן להרצה חוזרת | Accepted | 2 |
| [0016](0016-data-quality-weights.md) | משקלי ציון איכות הנתונים | Accepted | 5 |
| [0017](0017-development-fixture-data-source.md) | מקור נתוני פיתוח מאחורי דגל, חסום בייצור | Accepted | 6 |
| [0018](0018-extensionless-relative-imports.md) | ייבוא יחסי ללא סיומת בקוד שנארז | Accepted | 6 |
| [0019](0019-single-apply-all-bundle.md) | חבילת החלה אחת לכל המיגרציות | Accepted | 3 |
| [0020](0020-visual-language-revision.md) | רענון השפה הוויזואלית אחרי צפייה במוצר רץ | Accepted | 6b |
| [0021](0021-daily-dashboard-versus-detail-screens.md) | מסך יומי מול מסכי חקירה | Accepted | 6b |
| [0022](0022-plain-hebrew-copy-layer.md) | המנוע מחזיר קודים; העברית נמצאת בשכבה אחת | Accepted | 6b |
| [0023](0023-deterministic-budget-and-food-week.md) | תקציב חודשי והנחיה שבועית לאוכל כדומיין דטרמיניסטי | Accepted | 6b |
| [0024](0024-local-store-before-the-database.md) | חנות מקומית מבוססת קובץ כמקור האמת עד שיש מסד מאומת | Accepted | 7 |
| [0025](0025-document-parsers-written-not-installed.md) | קוראי המסמכים נכתבים ולא מותקנים | Accepted | 7 |
| [0026](0026-pdf-export-through-the-browser.md) | ייצוא PDF דרך הדפסת הדפדפן, לא דרך מחולל בשרת | Accepted | 7 |
| [0027](0027-shell-gate-runs-against-the-server.md) | שער ה־shell נבדק מול השרת הרץ | Accepted | 7 |
| [0028](0028-authentication-state-outside-the-household-document.md) | מצב הכניסה נשמר בקובץ נפרד ממסמך משק הבית | Accepted | 8 |
| [0029](0029-passkeys-live-at-localhost-not-at-an-address.md) | מפתחות הכניסה חיים ב־localhost, לא בכתובת IP | Accepted | 8 |
| [0030](0030-a-check-is-not-a-payment.md) | צ׳ק שנמסר אינו תשלום | Accepted | 8 |
| [0031](0031-production-refuses-the-local-store.md) | ייצור מסרב לעלות עם החנות המקומית | Accepted | 9 |
| [0032](0032-supabase-as-the-production-data-layer.md) | Supabase כשכבת הנתונים של הייצור | Accepted | PDL |
| [0033](0033-render-web-service-as-the-hosting-target.md) | Render Web Service כיעד האירוח; `render.yaml` בשורש, בריאות = מוכנות | Accepted (תוקן: בלי `NODE_ENV`, `--include=dev`) | HPO |
| [0034](0034-a-misconfigured-process-serves-refusals.md) | תהליך עם תצורה פגומה מגיש סירובים (503 + health `misconfigured`), לא exit ולא throw; ה־build של הייצור הוא שער | Accepted | HPO hotfix |
| [0035](0035-two-calendars-and-a-debt-list-with-no-headers.md) | זיהוי חובות לפי ערכים כשהכותרות ריקות מתוכן; הלוח העברי כאזרח מן המניין דרך `@hebcal/core`, עם שכבת סירוב — תאריך לא ודאי אינו תאריך | Accepted | DEBT-CAL |
| [0036](0036-a-classifier-that-can-be-argued-with.md) | סיווג תנועות דטרמיניסטי שאפשר להתווכח איתו: טבלת כללים, קיפול טקסט עברי, שלוש רמות ביטחון, קישור הלוואה שלעולם אינו ניחוש, וכללים של משק בית שמוצעים ולא נלקחים | Accepted | TXN-INT |
| [0037](0037-the-code-may-arrive-before-the-schema.md) | הקוד עלול להגיע לפני הסכמה: נפילה אחורה לפונקציה הקודמת לרשומות, סירוב בקול למה שבאמת אינו יכול להישמר, הודעה שאפשר לפעול לפיה, ותשלום ידני שנרשם פעם אחת | Accepted | HOTFIX |
| [0038](0038-the-submission-names-the-record.md) | ההגשה היא שמזהה את הרשומה: מפתח האידמפוטנטיות הוא המפתח הראשי, הדפדפן טובע אותו לכל טופס, חזרה היא הצלחה במשפט משלה, והגשה בלי מפתח עדיין מתקבלת | Accepted | M2 |
| [0039](0039-a-sentence-is-a-proposal.md) | משפט הוא הצעה ולא רישום: פירוש דטרמיניסטי ומקומי בחבילה טהורה, שישה מצבים שרק אחד מהם מאפשר אישור, קול שקוף שההקלדה שקולה לו, אישור שקורא מחדש בשרת ועובר בפקודות הקיימות | Accepted | Q1 |
| [0040](0040-the-browser-is-a-gate.md) | הדפדפן הוא שער: חבילת Playwright על ה־build האמיתי מול חנות קבצים בתיקייה זמנית — בלי סודות ולכן ב־CI — חבילה חיה נפרדת לכניסה ול־RLS שמודדת את הניקוי שלה, כפילות שמוכחת בגבול הנתונים ולא בכפתור מושבת, ו־smoke קריאה־בלבד מול הפריסה | Accepted | B1 |
| [0041](0041-a-model-may-propose-and-nothing-else.md) | מודל רשאי להציע ותו לא: אין writer בנתיב הקריאה, `safeToConfirm` נקבע בשרת, שם לעולם אינו מזהה ולעולם אינו פותח מלווה, הקשר מינימלי כרשימה לבנה, נתיב כתיבה אחד לשני הקוראים, וחוסר תצורה שנאמר בקול | Accepted | B2 |
| [0042](0042-one-flow-and-one-card.md) | זרימה אחת וכרטיס אחד: כפתור אחד שהקורא שלו נבחר בשרת ונפילה שקטה לטבלת הכללים כחוסן ולא כמוצר שני, מתאם מלווים משותף, מודל שאינו יכול לבטא מזהה מלווה, "עוד" מול כרטיס קיים שהוא תוספת ולא כרטיס שני, מועד פירעון כשדה נפרד שנרשם ולא רק מוצג, וכרטיס בן חמש שורות ששאלתו היא כפתורים | Accepted | תיקון |
