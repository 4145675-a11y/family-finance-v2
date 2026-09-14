# ADR-0018: ייבוא יחסי ללא סיומת בקוד שנארז

- **Status**: Accepted
- **Date**: 2026-08-23
- **Milestone**: 6

## הקשר

עד Milestone 6 כל הקוד ב־`packages/` וב־`apps/web/lib/` השתמש בסיומת `.js` בייבוא יחסי — `import { readPublicEnv } from '../env.js'` — הסגנון הנכון ל־ESM ב־Node.

הסגנון הזה מעולם לא נבחן בפועל: אף אחד מהמודולים האלה לא נכלל ב־bundle. `apps/web/lib/supabase/client.ts` נסרק על ידי `check:client-secrets` אבל לא יובא משום עמוד, ו־`packages/design-system` נרשם ב־`transpilePackages` בלי שיובא.

ברגע ש־Milestone 6 ייבא את `finance-engine` מתוך עמוד, `next build` נכשל ב־20 שגיאות:

```
Module not found: Can't resolve './money.js'
Module not found: Can't resolve '../lib/dashboard/load.js'
```

Turbopack אינו ממפה מפרט `.js` לקובץ `.ts` תואם. TypeScript עושה זאת תחת `moduleResolution: bundler`, ולכן `npm run typecheck` עבר בזמן שהבילד נשבר — שני כלים שקוראים את אותו קובץ ומגיעים למסקנות שונות.

## החלטה

בכל קוד שנארז — `apps/web/**` ו־`packages/*/src/**` — ייבוא יחסי נכתב **בלי סיומת**:

```ts
import { safeHouseholdSpend } from './household';
```

זה תקף גם ל־`import()` דינמי.

הכלל אינו חל על `tools/*.mjs`. אלה רצים כ־ESM אמיתי ב־Node, שם הסיומת חובה, והם ממשיכים לייבא `./sql-guard.mjs` כמו קודם.

## חלופות שנשקלו

- **להשאיר `.js` ולהגדיר `resolveExtensions` ב־Turbopack** — נדחה. הגדרה שמלמדת את ה־bundler ש־`.js` הוא בעצם `.ts` מסתירה את אי־ההתאמה במקום לפתור אותה, ומשפיעה על כל מודול בגרף.
- **לבנות את החבילות ל־JavaScript לפני הצריכה** — נדחה כרגע. `ADR-0007` בחר בחבילות שמשלחות TypeScript מקור; הוספת שלב build לכל חבילה היא שינוי מבני שאין לו הצדקה כאן.
- **סיומת `.ts` מפורשת** — נדחה. `verbatimModuleSyntax` דוחה זאת, וזו גם לא הצורה שכלי ה־bundle מצפים לה.

## השלכות

- Vitest, TypeScript ו־Turbopack מסכימים על אותו מפרט.
- `transpilePackages` מונה כעת גם את `@family-finance/contracts` ו־`@family-finance/finance-engine`: הן משלחות מקור TypeScript, ובלי זה Next אינו מקמפל אותן.
- `npm run build` הוא מעתה השער שתופס רגרסיה כזו. `typecheck` לבדו אינו מספיק, וזה מתועד כאן כדי שלא ייבדק שוב מאפס.
