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
