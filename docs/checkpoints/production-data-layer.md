# CHECKPOINT — Production Data Layer

- **Result**: **PASS — implemented, verified against the real database, and validated live end to end through Supabase Auth and PostgREST**
- **Branch**: `production-data-layer` (מסתעף מ־`main` ב־`a55a257`) · commits `e13124a`, `d682700` ומעלה
- **Environment**: local (Windows 11, Node v24.19.0 — `.nvmrc` נועל 24.18.1, פער מתועד; npm 11.17.0) · Supabase PostgreSQL 17.6
- **Date**: 2026-09-14 → 2026-09-15
- **ADR**: `ADR-0032`

> **מה הושג**: האפליקציה קוראת וכותבת את משק הבית דרך Supabase כמשתמש מחובר, ו־RLS הוא הסמכות בכל statement. הדלת (`householdStore()`) לא זזה; מה שעומד מאחוריה נקבע מתצורת הפריסה בלבד, ותהליך המוגדר למסד לעולם אינו בונה את חנות הקובץ. כל 32 הטבלאות מוכחות התנהגותית. שום דבר לא מוזג ל־`main` ולא נפרס.
>
> **הריצה החיה (2026-09-15)**: `npm run validate:production-path` — **13/13**: כניסה דרך Supabase Auth, הקמת משק בית, תנועות, יבוא ואישור, תקציב/חוב/גמ״ח/משימה, ייצוא תחת אימות־מחדש, הזמנה והצטרפות, בידוד בין משקי בית על המסך ודרך ה־transport, יציאה — והמסד נקי אחריה. שני פגמים נמצאו ותוקנו (ראה "אירועים" 7–8).

## Scope

### הושלם לפי Requirement IDs

| ID | מה הוכח | ראיה |
|---|---|---|
| `PROD-RLS-BEHAVIOUR-001` | allow/deny לכל 32 הטבלאות: חבר מותר, זר נדחה, anon נדחה, הפניה חוצת־משק נדחית, append-only, person-scoped | 7 קובצי `rls-*.integration.test.ts`, **214 בדיקות** מול המסד ב־rollback |
| `PROD-DOMAIN-PERSIST-001` | תשעה תחומים (זהות, חשבונות, תנועות, יבוא, תקציב, חובות, גמ״ח/צ׳קים, דוחות, תפעול) דרך `SupabaseHouseholdStore` → `apply_household_changes()` | `store.integration.test.ts` **17 בדיקות** מול המסד; parity: אותו snapshot מהמסד ומתוצאת הפקודה |
| `PROD-AUTHDB-001` | כל גישה כמשתמש מחובר; `security invoker`; service role בשום מקום | `lib/store/server.ts`, `SupabaseHouseholdTransport` (supabase-js עם session), `boundary.test.ts` |
| `PROD-SECRET-BOUNDARY-001` | דפדפן: URL + publishable בלבד; `proxy.ts` קורא רק אותם; health ללא host/ref/מפתח | `check:client-secrets` PASS · `health.test.ts` · fail-closed "without naming the project or host" |
| `PROD-DATASOURCE-001` | `supabase` רק עם session + household; אחרת `none`, לעולם לא קובץ/fixture | `source.test.ts` **24** (6 חדשות) |
| `PROD-PARTIAL-FAILCLOSED-001` | מסד לא נגיש → health `not_ready` 503, השרת עולה ואינו מגיש מקור אחר | `check:fail-closed` **9/9** (2 חדשות) |
| `PROD-HEALTH-002` | configuration / authenticatedDataSource / database / schema / readiness — ללא סודות | `health.test.ts` **6**, gate |

### לא הושלם, סיבה והשפעה

- **טפסי server actions** (כניסה, יצירת חשבון וכו׳) לא הופעלו אוטומטית; הריצה החיה בודקת עמודים מרונדרים ואת ה־transport, לא לחיצות. אימות ידני בדפדפן נשאר.
- **Passkeys בייצור** — נדחה במפורש (החלטה 2). **ארכוב/אנונימיזציה** — נדחה (החלטה 11). **שחזור מגיבוי לתוך המסד** — מסורב בשם (`unsupported_in_backend`), ראה ADR-0032 §השלכות. **גיבוי בייצור** — הורדה (`/api/export/backup.json`) ולא כתיבה לדיסק.

### Out-of-scope שלא שונה

מסמכי החוקה `01`–`09`, `11`. המיגרציות שהוחלו קודם — לא נערכו. `main` — לא מוזג. שום פריסה.

## Changes

**סכמה** — `supabase/migrations/20260914120000_production_data_layer.sql` (הוחלה על המסד ב־2026-09-14 דרך `tools/apply-migration.mjs`, טרנזקציה אחת): `version` ל־`setup_progress`/`notification_preferences` (פגם: אף UPDATE לא יכול היה להצליח); `audit_row_change` עם `entity_id` לטבלאות ללא `id`; `businesses.operating_reserve_minor`; שדות `family_tasks` + `task_origin` + `dismissed`; `import_batches.summary/warnings/rejected_at`; provenance של יבוא על תנועות/snapshots/אירועי חוב/פריטים; `voided_at`/`removed_at` + trigger `only_void_mark_changes`; `create_household()`, `create_household_invitation()`, `load_household_document()`, `apply_household_changes()`. policies ששונו קיבלו שם `_v2`. `apply-all.sql` נבנה מחדש (16).

**חבילה חדשה** — `packages/household-store`: `port.ts`, `rows.ts`, `document-mapping.ts`, `transport.ts`, `supabase-store.ts`, `supabase-transport.ts`, בדיקות.

**אפליקציה** — `lib/store/server.ts` (הדלת, אסינכרונית, per-request cache), `lib/auth/{backend,supabase}.ts`, `guard.ts`/`session.ts` (ענף לפי backend), `lib/auth/store.ts` (מסרב לפתוח את קובץ הכניסה תחת supabase), `lib/actions/auth.ts`, `lib/health.ts`, `proxy.ts`, עמודים `/login` `/reauth` `/join` `/account`, `components/invite-form.tsx`, `reauth-gate` (ענף), `backup`/`settings`/`setup`/`security`/`lock`/`more` (ענף), `api/export/backup.json`, `dashboard/source.ts` (`supabase` kind), 44 call sites → `await householdStore()`.

**חוזה** — `packages/contracts/src/imports.ts`: batch מבוטל שומר את `approvedAt` (באג מקומי סמוי: ביטול יבוא דרך חנות הקובץ נכשל באימות בכתיבה; נמצא ע"י המסד, תוקן, בדיקה נוספה).

**כלים** — `tools/apply-migration.mjs`, `tools/db-cleanliness.mjs`, scripts `db:apply`, `db:cleanliness`, `validate:production-path`; `check-fail-closed.mjs` +2 בדיקות; `vitest.validation.config.ts`.

**תיעוד** — ADR-0032, checkpoint זה, `docs/PRODUCTION-DATA-LAYER.md`, `supabase/README.md`, `docs/COMMANDS.md`, `docs/CI-GATES.md`, `REQUIREMENTS`, `TRACEABILITY`, `MILESTONE_STATUS`, `apps/web/.env.example`.

## Commands & Evidence

| Gate | Command | Result | Counts |
|---|---|---|---|
| Format | `npm run format:check` | **PASS** | exit 0 |
| Typecheck | `npm run typecheck` | **PASS** | שורש + 8 workspaces |
| Lint | `npm run lint` | **PASS** | `--max-warnings=0` |
| Unit | `npm run unit` | **PASS** | **1810 passed**, 53 קבצים, 0 מדולגות |
| Property | `npm run property` | **PASS** | **41/41** |
| Build | `npm run build` | **PASS** | כולל `ƒ Proxy (Middleware)` ומסלולי `/login` `/reauth` `/join` `/account` |
| Built-shell | `npm run check:shell` | **PASS** | 14/14 מול השרת הרץ |
| **Fail-closed** | `npm run check:fail-closed` | **PASS** | **9/9** — כולל "not ready when the database cannot be reached" ו־"without naming the project or host" |
| Client secrets | `npm run check:client-secrets` | **PASS** | 0 ממצאים (bundle + source) |
| No env files | `npm run check:no-env-files` | **PASS** | 0 במעקב, 0 ב־build |
| RLS coverage | `npm run check:rls-coverage` | **PASS** | 32/32, 17 מיגרציות |
| Manual bundle | `npm run db:check` | **PASS** | 17 מיגרציות |
| Forbidden scan | `npm run scan:forbidden` | **PASS** | 0 |
| Traceability | `npm run check:traceability` | **PASS** | 66 דרישות |
| **Aggregate** | `npm run verify` | **PASS** | exit 0 אמיתי |
| **Integration (real DB)** | `npm run integration` | **PASS** | **8 קבצים, 233 בדיקות**, ~6 דקות; rollback בלבד |
| **DB cleanliness** | `npm run db:cleanliness` | **PASS** | 0 households · 0 profiles · 0 `@example.test` · 0 audit · 32/32 RLS forced · guards 2/2 + void-guards 2/2 |
| **Migration apply** | `npm run db:apply` ×2: `20260914120000_production_data_layer.sql`, `20260915090000_invitation_bootstraps_profile.sql` | **applied** | sha256 מודפס, טרנזקציה אחת לכל קובץ |
| **Production-path validation (live)** | `npm run validate:production-path` | **PASS** | **13/13**, ~24s; Supabase Auth + PostgREST + עמודים מרונדרים; ניקוי עצמי אומת |
| **CI (GitHub Actions)** | push של `e13124a`, `d682700` | **success** | שני הריצות ירוקות |

## Negative verification

| מה נשבר בכוונה | תוצאה |
|---|---|
| חבר של B מנסה לקרוא/לכתוב את A דרך ה־store | `StoreNotInitialisedError` בקריאה; `not a member` 42501 ב־`apply` |
| `apply_household_changes` עם version ישן | `40001` → `ConcurrentModificationError`; המסד לא השתנה |
| `voided_at` יחד עם שינוי סכום | `42501` מה־trigger; un-void → `42501` |
| חבר מוסיף חבר בשם (`addMember`) תחת supabase | `PersistenceError('unsupported_in_backend')` **לפני** שנשלח משהו |
| `removePlannedItem` | `removed_at` נסמן; `load_household_document` אינו מחזיר את השורה; השורה קיימת |
| `reverseBatch` | תנועות `void`; batch `reversed` ושומר `approvedAt` |
| שרת ייצור עם URL־מסד שאין מאחוריו מסד | עולה, `/api/health` **503 not_ready**, `database: unreachable`, ללא host |
| `/`, `/accounts`, `/setup`, `/account`, `/backup`, `/reports` ללא session (בריצה החיה) | redirect ל־`/login` |
| `lib/auth/store.ts` תחת backend supabase | זורק `unsupported_backend` — קובץ הכניסה לא נפתח |

## אירועים — מה המסד לימד

1. **`setup_progress` ו־`notification_preferences` לא ניתנו לעדכון** (trigger `touch_updated_at` ללא עמודת `version`). נמצא ע"י בדיקות ה־RLS; תוקן במיגרציה.
2. **`audit_row_change` רשם `entity_id = NULL`** לטבלאות שמפתחן `household_id`/`profile_id`. תוקן.
3. **סדר הנעילות**: ה־triggers `assert_*_references` (SECURITY DEFINER, BEFORE) רצים לפני ה־`WITH CHECK`; הפניה חוצת־משק נדחית עם `P0001` ולא `42501`. הבדיקות אומרות זאת במפורש במקום לנחש.
4. **ביטול יבוא לא היה ניתן לשמירה מקומית** — החוזה דרש `approvedAt === null` לכל מה שאינו `approved`; הבדיקות המקומיות מעולם לא פירסרו batch מבוטל. תוקן בחוזה + בדיקה.
5. **אין מסלול שבו יוצר household הופך לחבר** — `household_members` בלי INSERT policy בכוונה, וללא פונקציית יצירה. `create_household()` נוספה.
6. **החוזים והסכמה סטו** (`operating_reserve_minor`, שדות משימות, `dismissed` מול `dropped`, summary של batch) — מיושר במיגרציה, החוזים לא שונו.
7. **הזמנה על store טרי** (הריצה החיה): `SupabaseHouseholdStore.invite()`/`invitations()` דרשו household שכבר נטען, ו־store של בקשה חדשה מתחיל ריק → `StoreNotInitialisedError` מפעולת ההזמנה. תוקן (`resolveHousehold`) + 2 בדיקות יחידה.
8. **מוזמן ללא פרופיל** (הריצה החיה): אדם שנרשם ב־Supabase Auth ומעולם לא הקים משק בית אין לו שורת `profiles`; `accept_household_invitation()` נכשל ב־FK (`23503`). כל הבדיקות הקודמות זרעו פרופילים. מיגרציה קדימה `20260915090000`: הפונקציה יוצרת את הפרופיל (שם מ־`display_name` ב־user_metadata, אחרת החלק המקומי של האימייל) לפני החברות. הוחלה; 2 בדיקות אינטגרציה.
9. **תצורה מקומית**: `apps/web/.env.local` הכיל URL עם project ref שאינו קיים ב־DNS ושורת מפתח עם טקסט נלווה. תוקן מקומית (הקובץ ב־`.gitignore`, שום ערך לא הודפס): ה־URL נגזר מה־ref של חיבור המסד ואומת (`/rest/v1/rpc` כ־anon → `42501`), שורת המפתח נחתכה לטוקן הראשון.

## החלטות שהתקבלו כאן (מסמכי הסמכות תומכים)

- **סימון במקום מחיקה** לביטול יבוא ולהסרת פריט צפוי (`02-FINANCIAL-RULES`: "void/correction, לא מחיקה"; שער המיגרציות: `transaction_splits` היא טבלת ה־DELETE היחידה). החנות המקומית — נתיב פיתוח מקומי בלבד — לא שונתה.
- **recent-auth בייצור = הזנת סיסמה מחדש**, נקראת מ־`amr` ב־JWT חתום; לא cookie שהאפליקציה כותבת.
- **הבייטים של מסמך מיובא לא נשמרים** בשרת מארח (`retention_state = purged` על `import_source_files`); Supabase Storage — נדחה.
- **הוספת חבר = הזמנה באימייל** (זהות אמיתית), קוד חד־פעמי מוצג פעם אחת.

## החסימה הוסרה

המפתח סופק ב־2026-09-15; הריצה החיה עברה 13/13 (ראה למעלה). ספק Email/Password ב־Supabase Auth פעיל (הכניסה הצליחה).

## Risks & rollback

| סיכון | חומרה | טיפול |
|---|---|---|
| טעינת מסמך שלם לכל פעולה | נמוכה למשק אחד; תיבדק תחת נתונים אמיתיים | ADR-0032 § תנאי ביטול |
| policy הוכחה דרך JWT אמיתי לתחומים שהריצה החיה עוברת; היתר דרך `pg` עם אותם claims | נמוכה — אותה מכניקה | — |
| `local_json` עדיין מוחק פיזית בביטול יבוא | מקומי בלבד | מתועד ב־ADR-0032 |

**Rollback**: הענף לא מוזג; `git checkout main`. המיגרציה קדימה בלבד; ביטולה = מיגרציה נוספת (העמודות והפונקציות אינן משפיעות על הקוד ב־`main`, שאינו קורא להן).

## Stop declaration

**לא מוזג ל־`main`. לא נפרס. לא יובאו נתונים אמיתיים. המסד ריק ומוגן (אומת אחרי הריצה החיה: 0/0/0, identities 0, invitations 0).**
