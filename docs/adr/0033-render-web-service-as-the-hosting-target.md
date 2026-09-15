# ADR-0033: Render Web Service כיעד האירוח

- **Status**: Accepted — **תוקן אחרי הפריסה הראשונה** (2026-09-15, `ADR-0034`): `NODE_ENV` הוסר מה־blueprint, ההתקנה היא `npm ci --ignore-scripts --include=dev`
- **Date**: 2026-09-15
- **Milestone**: Hosting & Production Origin
- **Requirement IDs**: `PROD-ORIGIN-001`, `PROD-HOSTING-001`, `PROD-COOKIE-001`, `PROD-AUTHURL-001`

## הקשר

שכבת הנתונים של הייצור ממוזגת (`ADR-0032`): האפליקציה קוראת וכותבת דרך Supabase כמשתמש מחובר, נכשלת סגור בתצורה חסרה, ומדווחת מוכנות ב־`/api/health`. מה שחסר הוא המקום שבו התהליך הזה ירוץ ודומיין שהמשפחה מגיעה אליו.

מה המאגר כבר קבע, לפני ADR זה:

- **תהליך מתמשך.** `ADR-0031`: "instrumentation.ts … `process.exit(1)` ולא `throw`: שגיאה שנזרקת נתפסת ע"י ה־framework והשרת ממשיך להאזין — בדיוק המצב שהקובץ נועד למנוע". הסירוב־לעלות הוא מנגנון של תהליך אחד ארוך־חיים (`next start`), לא של פונקציה לכל בקשה.
- **בריאות שאינה "התהליך חי".** `/api/health` מחזיר `503 not_ready` כשהמסד לא נגיש או הסכמה לא מיושרת (`PROD-HEALTH-002`). זה שימושי רק אם המארח משתמש בו כדי **לא** להעביר תעבורה לפריסה כזו.
- **אין קובץ סביבה ב־image** (`check:no-env-files`, `ADR-0031`): "ב־Render זו חור ולא נוחות". שלושה מקומות במאגר כבר מניחים Render (`ADR-0031`, `lib/config/deployment.ts`, `tools/check-no-env-files.mjs`), והבעלים מכיר אותו.
- `11-OPERATIONS.md`: "secrets במנהל סודות … CSP/HSTS, domains … backups".

## החלטה

**Render — Web Service, runtime Node, מתוך המונורפו הזה, עם `render.yaml` בשורש.**

- `npm ci --ignore-scripts` → `npm run build` → `npm run start` (root; `next start` ב־`apps/web`, נקשר ל־`0.0.0.0:$PORT`).
- Node **24.18.1** — הגרסה ש־`.nvmrc` נועל — נקבעת במפורש ב־`NODE_VERSION`.
- `healthCheckPath: /api/health`. פריסה שאינה `200 ok/ready` אינה מקבלת תעבורה; הגרסה הקודמת ממשיכה לשרת. זה ה־rollback האוטומטי, ו־rollback ידני הוא "Redeploy" של deploy קודם.
- משתני הסביבה ב־render.yaml הם **שמות בלבד** (`sync: false`) למעט שני ערכים שאינם סוד ומוגדרים במלואם מהקוד: `FAMILY_FINANCE_DATA_BACKEND=supabase`, `NODE_VERSION`. אין secret ב־Render כלל במילסטון הזה: לאפליקציה אין service-role ואין `SUPABASE_DB_URL` (הוא של כלי הבדיקות בלבד, מקומי).
- דומיין: תת־דומיין `*.onrender.com` ל־smoke ראשון, ואז דומיין משפחתי עם TLS מנוהל. שניהם `https`, ולכן שניהם עוברים את `readDeploymentConfig`.
- אזור: Frankfurt (הקרוב לישראל מבין אזורי Render). מומלץ שפרויקט Supabase יהיה באזור EU קרוב; אם אינו — נמדד, לא מונחש.

ההחלטה אינה פריסה. יצירת השירות, הזנת המשתנים, חיבור הדומיין ושינויי Supabase Auth הם פעולות בעלים, מתועדות ב־`docs/HOSTING-RENDER.md`.

## חלופות שנשקלו

| חלופה | יתרון | חיסרון | מדוע נדחתה |
|---|---|---|---|
| **Vercel** | Next.js "native", דומיין ו־TLS קלים, חינמי | מודל serverless: `process.exit` ב־instrumentation אינו "סירוב לעלות"; אין health-check שמונע תעבורה; `proxy.ts` רץ ב־edge בברירת מחדל (Node ב־Next 16 אך שונה בהתנהגות); קובץ `.env` אינו הסיכון אבל "פונקציה שעולה תמיד" כן | סותר את מנגנון ה־fail-closed של `ADR-0031` |
| **Fly.io** | תהליך מתמשך, health checks, אזורים | דורש Dockerfile + CLI + ניהול machines; עקומת תפעול לבעלים לא־טכני | מורכבות תפעולית ללא יתרון על Render למקרה הזה |
| **Docker על VPS** | שליטה מלאה | TLS, עדכונים, גיבוי מערכת ההפעלה, ניטור — הכול עלינו | הפוך ל־"non-technical owner" |
| **Supabase Edge / static** | קרבה למסד | Next server actions, proxy ו־RSC אינם static; edge functions אינן Next | לא תואם לאפליקציה |
| **Render (נבחר)** | תהליך מתמשך; deploy מותנה בריאות עם rollback; env/secret files; דומיין+TLS; חינמי (עם spin-down) או Starter; מוכר לבעלים; המאגר כבר מניח אותו | Free tier נרדם אחרי חוסר פעילות (כניסה ראשונה איטית); Starter עולה כסף — **החלטת הוצאה של הבעלים** | — |

## השלכות

- חיוביות: אפס קונפיגורציית Docker; אותו `npm run build` כמו מקומית ו־CI; בריאות = מוכנות אמיתית; שום סוד אינו נדרש בפלטפורמה.
- שליליות ועלות: Free plan נרדם (הבחירה בין Free ל־Starter היא של הבעלים); ~~Render מגדיר `NODE_ENV=production` רק אם נאמר לו — ולכן נאמר לו ב־render.yaml~~ **בוטל**: `next build`/`next start` מגדירים אותו בעצמם, ובסביבה הוא גורם ל־`npm ci` להשמיט devDependencies (הפריסה הראשונה נכשלה על כך — `ADR-0034`); Turbopack build על Free plan עלול להיות איטי — נמדד בפריסה הראשונה.
- מה נדרש לאמת: `render.yaml` תקין מבנית (בדיקה); `npm run start` נקשר ל־`$PORT`; health מחזיר 503 בלי מסד ו־200 איתו (`check:fail-closed`, הריצה החיה); cookies של session עם `Secure; HttpOnly; SameSite=Lax` על origin https (`PROD-COOKIE-001`).

## תנאי ביטול

Render מסיר תמיכה ב־Node persistent services או ב־health-check-gated deploys; או שנדרש edge/CDN לביצועים שהמשפחה מרגישה — ואז ADR חדש, לא שינוי שקט.
