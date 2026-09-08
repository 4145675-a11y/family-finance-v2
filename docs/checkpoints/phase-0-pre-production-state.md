# Checkpoint — Phase 0: the exact state before production work

- **תאריך**: 2026-09-08
- **מטרה**: לתעד במדויק מאיפה יוצאים, לפני שנוגעים במשהו.

## מצב המאגר

| | |
|---|---|
| שורש | `C:\Users\123\dev\family-finance-v2` |
| ענף | `milestone-2-identity-isolation` (השם מיושן; M2–M8 נבנו עליו) |
| HEAD | `1870d1586703e5228fd5671f6e85d9cdda77d47f` |
| עץ עבודה | **נקי** — 0 שורות ב־`git status --porcelain` |
| Remotes | **0** |
| `main` | `af51add` — לא נגענו בו |
| commits מעל `main` | 22 |
| קבצים במעקב | 321 |

קבצים מקומיים שמחוץ למעקב (מוכרים ומכוונים): `.claude/settings.local.json`, `.data/`,
`.npm-cache/`, `apps/web/.env.local`, `apps/web/.next/`, `next-env.d.ts`,
`tsconfig.tsbuildinfo`, `node_modules/`.

**שרת מקומי**: מאזין על `127.0.0.1:3100` בלבד. לא נחשף מעבר ללולאה המקומית.

## שערי איכות — קוד יציאה אמיתי

`npm run verify` → **exit 0**

| שער | תוצאה |
|---|---|
| format:check | PASS |
| typecheck (שורש + 7 workspaces) | PASS |
| lint (`--max-warnings=0`) | PASS |
| unit | **1518 / 1518**, 49 קבצים |
| property | **41 / 41**, 3 קבצים |
| build | PASS |
| check:shell | PASS — 14 בדיקות מול השרת הרץ |
| check:client-secrets | PASS |
| db:check | PASS |
| scan:forbidden | PASS — 0 שגיאות, 0 אזהרות |
| check:traceability | PASS — 54 דרישות, 54 במטריצה |

**לא רץ ולא נטען שרץ**: בדיקות RLS/אינטגרציה מול מסד (אין `SUPABASE_DB_URL`; שום מסד לא נגענו
בו), axe ובדיקות מקלדת אוטומטיות (Playwright לא מותקן).

## מפת הארכיטקטורה הקיימת

### מקור האמת היום

`.data/household.json` — מסמך אחד, `formatVersion: 2`, נכתב אטומית ב־rename, תור כתיבות אחד,
ולידציה מלאה לפני כל כתיבה (ADR-0024). היסטוריה נשמרת ב־`.data/history`.

**זהו הפער המרכזי מול ייצור**: `resolveDataSource` בוחר את החנות המקומית **ראשונה, ללא תנאי** —
גם ב־production. Phase 1 חייב להפוך את זה לכשל־סגור.

### מיגרציות קיימות (10 קבצים, אף אחת לא הוחלה על מסד)

`identity_foundation`, `profiles_households`, `invitations`, `audit_events`, `rls_policies`,
`financial_accounts`, `debt_domain`, `financial_row_security`, `budgets`, `budget_row_security`.

18 טבלאות עם RLS מופעל, 50 policies:
`households`, `profiles`, `household_members`, `household_invitations`, `audit_events`,
`financial_accounts`, `account_balance_snapshots`, `transactions`, `transaction_splits`,
`cashflow_items`, `categories`, `businesses`, `debts`, `debt_events`, `debt_rollovers`,
`budgets`, `budget_lines`, `budget_changes`.

### מה שקיים מקומית ואין לו טבלה — הפער ל־Phase 2

`household_settings`, `setup_progress`, `family_tasks`, `import_batches`, `import_proposals`,
`import_source_files`, **`post_dated_checks`**, **`repayment_plans`**, `webauthn_credentials`,
`webauthn_challenges`, `sessions`, `idempotency_keys`, `notification_*`, `push_subscriptions`.

### שכבות

| שכבה | מיקום | תלות |
|---|---|---|
| חוזים | `packages/contracts` | zod בלבד |
| מנוע פיננסי | `packages/finance-engine` | טהור; בלי מסד, בלי רשת, בלי שעון משלו |
| קריאת מסמכים | `packages/document-import` | `node:zlib` בלבד (ADR-0025) |
| חנות מקומית | `packages/local-store` | קובץ |
| WebAuthn | `packages/webauthn` | `node:crypto` בלבד |
| אפליקציה | `apps/web` | Next 16, 24 מסלולים, 60 server actions |

### גבול האישור

`approveBatch` היא הפונקציה **היחידה** שהופכת הצעת יבוא לרשומה פיננסית. `projection.ts` לעולם
אינו קורא `importProposals`. זהו הגבול שחייב לשרוד את המעבר לייצור ללא שינוי משמעותו.

### אימות מקומי

WebAuthn מול Windows Hello, מקור נתמך `http://localhost:3100`, RP ID `localhost` (ADR-0029).
מצב הכניסה ב־`.data/auth.json`, נפרד ממסמך משק הבית (ADR-0028).
**קיים כרגע מפתח אחד אמיתי של המשתמש** (`המחשב שלי`, ES256) — הוא מקומי, ואינו תקף לייצור.

## גיבוי קוד

`git bundle create --all` → `.data/code-backups/family-finance-v2-1870d15.bundle` (950 KB).

- `git bundle verify` → "The bundle records a complete history".
- מכיל שלושה ענפים: `main`, `milestone-1-repository-foundation`, `milestone-2-identity-isolation`.
- **היסטוריית git בלבד.** נבדק: מתוך 321 הקבצים במעקב, 0 תואמים ל־`.data/`, `.env`,
  `auth.json`, `.pem`, `.key` או `service-role`.
- יושב בתוך `.data/`, שהוא gitignored — הגיבוי עצמו לעולם אינו נכנס למאגר.

## מה נשמר ללא שינוי

`.data/household.json` — משק הבית הסינתטי מ־M7/M8, כולל שתי הלוואות הגמ״ח שנוצרו באימות.
לא נגענו בו ולא ניגע. הוא אינו עולה לייצור.

## הערכת מוכנות

המוצר המקומי שלם ועובד. המעבר לייצור אינו "להוסיף מסד" אלא להחליף את מקור האמת, ולכן
הסיכון המרכזי אינו בקוד החדש אלא בגבול: מסך שממשיך לקרוא מהחנות המקומית בייצור, או פוליסת
RLS חסרה על טבלה חדשה, הם שני הכשלים שיעברו את כל השערים הקיימים בשקט.
