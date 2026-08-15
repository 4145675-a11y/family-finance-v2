# MILESTONES

כל milestone הוא יחידה סגורה. לפני קוד: Context Refresh, scope/out-of-scope, קבצים, סיכונים, tests ו־rollback. בסוף: review קוד/פיננסי/אבטחה/UX, verification מלא, Checkpoint, ואז עצירה לאישור.

## 0 — Bootstrap

סביבה, מסמכי חוקה, CLAUDE.md, status, ADR, commands, CI skeleton, traceability וגייטים. ללא feature UI.

## 1 — Repository Foundation

Next/TS strict, package manager נעול, formatting/lint/test runners, CI, tokens, Hebrew RTL shell. Build עובר; אין feature screens.

## 2 — Identity & Isolation

Supabase boundary, Auth, profiles/households/members, invitation, migrations, RLS, שני households בבדיקות חיוביות ושליליות, threat model.

## 3 — Financial Accounts & Opening Picture

חשבונות, כרטיסים, מזומן, עסק, יתרות פתיחה, future items, manual transactions, audit.

## 4 — Debt Domain

סוגי חוב, private debt fields, events, minimums, consumer/total debt, verification ו־audit.

## 5 — Finance Engine

money/date conventions, scopes, transfers, safe/conditional/restricted, modes, waterfall, formulas, stress tests, breakdown ו־property tests.

## 6 — Dashboard Source of Truth

freshness/confidence, safe spend, forecast/low point, debt trend, house/business, one action. Reference screenshots before expansion.

## 7 — PWA & Offline

installable shell, IndexedDB queue, idempotency, conflict UI, stale safeguards, E2E offline.

## 8 — Imports & Approval Inbox

CSV/XLSX mapper, batches/drafts, duplicate detection, approval flows, settlement matching, temp deletion.

## 9 — OCR/Voice/Email Adapters

receipt extraction, voice draft, untrusted boundary; Gmail behind feature flag אם חסרים credentials.

## 10 — Budget & Sinking Funds

suggested categories, first-month low-confidence draft, planned/actual/pending/committed/projected, periodic funds.

## 11 — Business & Safe Transfer

received/receivables, taxes, reserve, realized profit, safe transfer, before/after ו־stress tests.

## 12 — Debt Plan & Advisor

explainable ranking, private debt, proposed plan, three core questions, tool-only AI, injection tests.

## 13 — Summaries, Notifications & Reports

daily/weekly, dedup/quiet hours, PDF/Excel/print, RTL golden files.

## 14 — Hardening & Production

full E2E/security/a11y/performance, backup/isolated restore, limited real-data UAT, P0/P1 fixes, runbooks ו־deployment.

לכל milestone יש ליצור prompt נקודתי מהתבנית: בצע N בלבד; קרא מסמכים; הצג Context Refresh; אל תשנה out-of-scope; הרץ gates; עדכן status; עצור.

