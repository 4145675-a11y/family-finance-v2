# ARCHITECTURE & DATA

## Stack

Next.js stable, TypeScript strict, App Router, React, Tailwind, Radix/shadcn מותאם RTL, TanStack Query, RHF+Zod, Dexie/IndexedDB, service worker/PWA, Supabase PostgreSQL/Auth/RLS/Storage זמני. AI/OCR/email/CRM/reporting מאחורי adapters. אמת גרסאות stable בזמן bootstrap ותעד ADR לסטייה.

## גבולות

- `packages/finance-engine`: pure deterministic domain, ללא UI/AI/DB.
- `packages/contracts`: Zod/types/versioned schemas.
- `packages/design-system`: tokens/components.
- `apps/web`: routes, UI, PWA.
- server application services: authorization, transactions, snapshots, imports, advisor tools.
- data access אינו נגיש ישירות מ־client components.
- AI מקבל JSON מצומצם רק מכלים מאומתים.

## Schema מינימלי

profiles, households, household_members, businesses, financial_accounts, account_balance_snapshots, credit_card_statements, transactions, transaction_splits, categories, recurring_rules, budgets, budget_lines, cashflow_items, financial_snapshots, debts, debt_events, debt_plans, debt_plan_items, business_receivables, business_tax_reserves, business_profit_periods, import_batches, import_drafts, import_templates, document_extractions, advisor_recommendations, tasks, notifications, integrations, integration_connections, external_entity_links, sync_runs, webhook_events, audit_events.

לגלגולי חוב נדרשים `debt_rollovers` או `debt_event_links` מפורשים: `from_debt_id`, `to_debt_id`, אירוע פירעון, אירוע יצירת החוב, `amount_minor`, תאריך, מקור (`user_confirmed`/`system_suggested`), confidence, notes, version ו-audit. הקישור אינו משנה את היתרות בעצמו; אירועי החוב הם האמת והקישור מסביר את מקור המימון. Snapshot חוב שומר בנפרד חוב צרכני, משכנתה, פירעון קרן ברוטו, חוב חדש, גלגול, ריבית/עמלות ושינוי נטו.

בכל טבלה רלוונטית: UUID, timestamps, actor, scope, version. FKs ו־delete behavior מפורשים. כספים לא נמחקים; void/correction. audit append-only באמצעות DB function/trigger. indexes ל־household, dates, status, external/idempotency keys.

## Reconciliation

יתרה מחושבת מול `account_balance_snapshot` מאומת. פער אינו נהפך אוטומטית ל“שונות”; מוצעות פעולות חסרות/כפילויות ונדרשת התאמה מאושרת. reconciliation נרשם ב־audit.

## Offline

מותר: shell, snapshot אחרון עם timestamp, יצירת פעולה/קול/צילום זמני ועריכת unsynced draft. אסור offline: החלטת AI, שינוי תקציב פעיל, אישור debt plan, binding safe transfer, merge/reconciliation/export.

כל mutation: client_mutation_id, device_id, entity_id, base_version, payload, client time, state. השרת מבצע idempotency, optimistic concurrency ו־server timestamp. אין silent overwrite; conflicts מוצגים.

## Imports

private temp upload → MIME/size/malware checks → deterministic parser/OCR → normalization → duplicate detection → draft → approval → truth → deletion. CSV/XLSX generic mapper ותבניות ניתנות לגרסה להפועלים, פאג״י/בינלאומי, ישראכרט, MAX וכאל. קובץ לא מאושר נמחק בתוך 24 שעות; מאושר/נדחה נמחק מיד. local copy נמחק לאחר sync/expiry לפי state machine.

## Advisor tools

get_month_snapshot, get_debt_snapshot, get_business_profit_snapshot, simulate_budget_change, simulate_business_transfer, run_stress_tests, list_due_items, create_proposed_plan. כל tool מחזיר snapshot/version/policy. recommendation תמיד proposed.

## CRM

Boundary בלבד עד יציבות CRM: HMAC webhook, timestamp+nonce, replay protection, idempotency, retry/reconciliation, versioned API. מועברים רק external IDs, amount, expected date, certainty ו־status; לא תוכן משפטי.

## Reports

Server-side snapshot-bound PDF/Excel; embedded Hebrew font; RTL golden files; filters, timestamp, confirmed/unconfirmed indicator.
