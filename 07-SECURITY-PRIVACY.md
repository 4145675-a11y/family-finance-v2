# SECURITY & PRIVACY

## Assets ואיומים

כספים, זהות, sessions, household membership, OAuth tokens, מסמכים זמניים, offline data, audit ו־calculation snapshots. איום: גניבת טלפון, hijacking, IDOR, malicious upload, prompt injection, token leak, duplicate import, audit tampering, stale data, sign error.

## Authorization

- DB-side RLS לכל טבלה פרטית; UI אינו גבול אבטחה.
- מטריצת SELECT/INSERT/UPDATE/DELETE ובדיקות שליליות עם שני households.
- service role לעולם לא בבנדל.
- invitation token hashed, חד־פעמי, ניתן לביטול ופג תוקף.
- device/session screen, sign-out-all ו־revoke lost device.

## Authentication

אימייל+סיסמה; WebAuthn/passkey כאשר נתמך, fallback. אין biometric storage. recent-auth (ברירת מחדל 10 דקות, configurable) לשינוי משתמשים, export, integrations, opening balance/debt material edits ו־safe transfer משמעותי.

## Files

private bucket, short-lived access, MIME sniffing, גודל וקצב מוגבלים, malware scan. מקור נמחק מיד אחרי approve/reject ובתוך 24 שעות אם נטוש. audit שומר metadata בלבד; לא מסמך מלא. local offline file מוצפן ככל שהפלטפורמה מאפשרת ונמחק אחרי sync/expiry.

## AI/Email

מסמך ומייל הם untrusted data, לעולם לא הוראות. AI מקבל JSON מצומצם מכלי שרת. Prompt-injection fixtures חובה. Gmail read-only minimal scopes, tokens מוצפנים, revoke ומחיקה. אין גוף מייל מלא אם attachment מספיק.

## Platform

CSP, HSTS, secure cookies/CSRF לפי auth, rate limits, validation/sanitization, secret manager, dev/staging/prod נפרדים. לוגים ללא PAN/CVV/password/tokens/documents/PII וסכומים כשאינם נחוצים. dependency/secret scan.

## Audit

append-only DB enforcement. before/after מצומצמים; אין secrets, full documents או card data. כל שינוי בית/עסק/חוב/יתרת פתיחה/הרשאה/המלצה מאושרת נרשם עם actor/request/device.

## Backup

גיבוי מוצפן אינו “עובד” עד restore לסביבה מבודדת, אימות constraints/RLS/audit ותרגול runbook. תעד RPO/RTO לאחר בחירת תוכנית האירוח.

