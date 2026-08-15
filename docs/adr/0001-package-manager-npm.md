# ADR-0001: npm כ־package manager, עם cache בתוך הפרויקט

- **Status**: Accepted
- **Date**: 2026-08-15
- **Milestone**: 0
- **Requirement IDs**: —

## הקשר

`CLAUDE.md` קובע שאין החלפת package manager ללא ADR, ולכן הבחירה הראשונה עצמה מחייבת ADR. `05-ARCHITECTURE-DATA.md` אינו מכתיב package manager. גבול הבטיחות של המכונה אוסר התקנות global וכתיבה מחוץ לשורש הפרויקט.

מצב המכונה שנמדד ב־bootstrap: Node `v24.18.1`, npm `11.16.0`, corepack `0.35.0` זמין, pnpm אינו מותקן.

## החלטה

**npm** הוא ה־package manager של הפרויקט, נעול דרך `packageManager: "npm@11.16.0"` ב־`package.json`.

ה־cache נקבע ב־`.npmrc` ל־`cache=.npm-cache`, כלומר בתוך שורש הפרויקט, כדי שהתקנה לא תקרא ולא תכתוב מחוץ לו. `.npm-cache/` נמצא ב־`.gitignore`.

`.npmrc` קובע גם `save-exact=true` (גרסאות מדויקות, בלי טווחי `^`) ו־`engine-strict=true` (אכיפת `engines.node`).

## חלופות שנשקלו

| חלופה | יתרון | חיסרון | מדוע נדחתה |
|---|---|---|---|
| pnpm דרך corepack | דיסק יעיל, workspaces חזק | corepack מוריד את pnpm ל־cache ברמת המשתמש, מחוץ לשורש הפרויקט | מפר את גבול הבטיחות של הפרויקט |
| pnpm בהתקנה global | סטנדרטי | התקנה global אסורה מפורשות | נדחתה |
| Yarn Berry | PnP, zero-install | הגדרה נוספת, חיכוך ידוע עם Next/TS toolchain | תועלת לא מצדיקה סיכון |
| npm (נבחר) | מגיע עם Node, אפס התקנות חיצוניות, workspaces מובנה | resolution איטי יותר, node_modules גדול יותר | — |

## השלכות

- חיוביות: אפס תלות בכלי חיצוני; התקנה כולה project-local; `npm ci` דטרמיניסטי מ־`package-lock.json` ב־CI.
- שליליות: התקנות איטיות יותר מ־pnpm ו־node_modules כפול בין workspaces.
- לאימות: `npm ci` חייב לעבור על checkout נקי ב־CI; `npm config get cache` חייב להחזיר נתיב בתוך הפרויקט.

## תנאי ביטול

מעבר ל־pnpm ייבחן רק אם זמן ההתקנה או נפח הדיסק יהפכו לחסם מדיד, ורק אם ניתן להתקין את pnpm בתוך הפרויקט בלבד. מעבר כזה מחייב ADR חדש שיחליף ADR זה.
