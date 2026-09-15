# ADR-0034: תהליך עם תצורה פגומה מגיש סירובים, לא את האפליקציה

- **Status**: Accepted (מתקן את מנגנון הסירוב של `ADR-0031`; `ADR-0033` מתוקן בהתאם)
- **Date**: 2026-09-15
- **Milestone**: Hosting & Production-Origin — hotfix אחרי הפריסה הראשונה
- **Requirement IDs**: `PROD-FAILCLOSED-001`, `PROD-HOSTING-001`, `PROD-HEALTH-002`

## הקשר

הפריסה הראשונה ב־Render נכשלה ב־`npm run build`:

```
apps/web/instrumentation.ts:51:5
A Node.js API is used (process.exit at line 51) which is not supported in the Edge Runtime
Ecmascript file had an error
```

`ADR-0031` קבע שסירוב־לעלות ייעשה ב־`process.exit(1)` מתוך `register()` של `instrumentation.ts`, ולא ב־`throw` — "שגיאה שנזרקת נתפסת ע"י ה־framework והשרת ממשיך להאזין". ההנמקה הזו נכונה גם היום (נמדדה שוב, ראו להלן). מה שלא נלקח בחשבון: **Next מקמפל את `instrumentation.ts` גם ל־Edge runtime — תמיד**, גם כשאין שום route או proxy ב־edge (`.next/server/instrumentation/middleware-manifest.json` מכיל `instrumentation.files` ב־`server/edge/chunks`). בגרסת ה־Edge הפונקציה מקופלת ל־`async function(){}` כי `process.env.NEXT_RUNTIME` מוחלף בזמן קומפילציה — אבל הניתוח הסטטי קורא את **המקור**, לא את מה שרץ, ומסמן כל Node API בקובץ. מקומית זו אזהרה ו־exit 0; עם `NODE_ENV=production` בסביבה (כפי ש־Render מגדיר) מודפס גם `Ecmascript file had an error`, וב־Linux ה־build נכשל.

ממצא שני מאותה פריסה: `NODE_ENV=production` בסביבת ה־build גורם ל־`npm ci` **להשמיט devDependencies** (נמדד: `removed 389 packages`). TypeScript, Tailwind ו־PostCSS הם devDependencies. ה־build לא יכול היה להצליח גם בלי השגיאה הראשונה.

## מה נמדד לפני ההחלטה

| מנגנון | מה קורה ב־`next start` 16.3.1 (נמדד) | fail-closed? |
|---|---|---|
| `process.exit(1)` ב־`instrumentation.ts` | התהליך יוצא; **אבל ה־build נכשל** ב־Render בגלל ניתוח ה־Edge | לא — אין build |
| `process.exit(1)` במודול Node שמיובא דינמית מאחורי `NEXT_RUNTIME` | ה־build נקי (ה־import המת אינו נעקב); התהליך יוצא | כן, אך שביר: תלוי בכך שהניתוח לא יעקוב אחרי import דינמי, וה־exit חותך את ה־framework באמצע אתחול |
| `throw` מ־`register()` | Next מדפיס `Failed to prepare server` + `unhandledRejection`, **ממשיך להאזין**, ועונה **500 לכל בקשה — כולל `/api/health`** | לא — תהליך חי, לא מאובחן, health לא עונה JSON |
| **סירוב לכל בקשה + health `misconfigured`** | התהליך רץ; ה־proxy עונה 503 לכל בקשה; `/api/health` עונה `503 misconfigured` עם **שמות** ההגדרות; הבדיקה של המארח נכשלת וה־deploy אינו מקודם | **כן** — בלי Node API, בתוך מה ש־Next תומך, נצפה מבחוץ |

## החלטה

1. **`instrumentation.ts` אינו מכיל שום Node API.** רק `process.env.NEXT_RUNTIME`, import דינמי אחד מאחורי הבדיקה, וקריאה שמכריזה על הפסק־דין בלוג (`announceStartupVerdict`). לא exit, לא throw.
2. **הפסק־דין נאכף בכל בקשה.** `proxy.ts` (Node runtime ב־Next 16) קורא `deploymentVerdict()` — מחושב פעם אחת לתהליך — ועונה `503 text/plain` בלי שמות ובלי ערכים לכל בקשה כל עוד יש בעיות. `/api/health` (מחוץ ל־matcher בכוונה) עונה `503 {"status":"misconfigured", problems:[שמות]}`. שום דבר מהאפליקציה אינו רץ.
3. **ה־build של הייצור הוא שער.** `npm run check:build` מריץ את ה־build עם `NODE_ENV=production` כפי ש־Render מריץ, ו**כל** דיאגנוסטיקה של Turbopack — אזהרה או שגיאה — מפילה אותו. `verify` ו־CI בונים דרכו. `tools/edge-safe.test.mjs` אומר איזו שורה, במילישניות, לפני build.
4. **ההתקנה כוללת devDependencies במפורש**: `npm ci --ignore-scripts --include=dev` ב־`render.yaml` וב־CI. `NODE_ENV` **אינו** מוגדר ב־blueprint — `next build` ו־`next start` מגדירים אותו בעצמם, ובסביבה הוא מגיע גם ל־`npm ci`.

## מה זה אומר ל־Render

deploy עם תצורה פגומה: ה־build מצליח, התהליך עולה, `/api/health` עונה 503 → הבדיקה של Render נכשלת → ה־deploy אינו מקבל תעבורה, הקודם ממשיך. בלוג: `[family-finance] refusing to serve.` ורשימת ההגדרות **בשמן**. זה מה ש־`PROD-FAILCLOSED-001` דורש: "אינו מגיש את האפליקציה" — לא "התהליך מת".

## השלכות

- `check:fail-closed` נכתב מחדש: 22 בדיקות. שלושת מקרי הסירוב מוכיחים שהתהליך **רץ**, ש־health הוא `503 misconfigured` בשם ההגדרה, שכל נתיב אפליקטיבי (`/`, `/accounts`, `/api/export/backup.json`, `/auth/callback`, נתיב לא קיים) עונה 503 טקסט ללא markup, שהלוג מכריז בשם, ושאף ערך לא הודפס. המקרה התקין מוכיח שהאפליקציה עונה (לא 503).
- `ADR-0031`: הסעיף "היכן זה נאכף" מתוקן — הסירוב אינו exit; `resolveDataSource` ו־health נשארים כפי שהם.
- `ADR-0033`: `NODE_ENV` הוסר מה־blueprint; `--include=dev` נוסף.
- מגבלה ידועה: תהליך "רץ" שאינו מגיש עלול להיראות חי ברשימת תהליכים. התשובה היא health — ולכן health הוא מה שהמארח בודק, ולא "התהליך חי".

## תנאי ביטול

אם Next יספק hook רשמי לסירוב עלייה (startup failure שמסיים את התהליך) שאינו דורש Node API בקובץ ה־instrumentation — ADR חדש. אם Next יפסיק לקמפל `instrumentation.ts` ל־Edge — ההחלטה נשארת; היא נכונה גם אז.
