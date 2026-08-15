# OPERATIONS

- סביבות: local, preview, staging פיקטיבי, production.
- secrets במנהל סודות; feature flags ל־AI/OCR/email/CRM/passkey.
- migrations בלבד; אין schema manual production.
- CI: format, typecheck, lint, unit, property, integration, RLS, build, smoke E2E, forbidden scan.
- ניטור: failed sync/import/OCR/recommendation/report/retention jobs; בלי תוכן אישי בדשבורד.
- גיבוי מוצפן, restore לסביבה מבודדת, runbook, RPO/RTO מתועדים.
- retention job למסמכים 24h, audit של מחיקה, alert על כשל מחיקה.
- production readiness: RLS, secrets, CSP/HSTS, domains, email templates, monitoring, backups, restore, incident contacts, feature flags off-by-default.

