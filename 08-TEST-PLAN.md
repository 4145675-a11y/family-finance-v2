# TEST PLAN

## שער גלובלי

אין PASS עם failed/skipped/only tests, flaky rerun ללא חקירה, build/type/lint כושלים, private table בלי RLS+negative test, חישוב בלי unit+property test, UI core בלי states/RTL/mobile, או טענה ללא evidence.

## שכבות

- Unit: finance-engine, parsers, normalization, duplicate matching, authorization helpers, notification dedup.
- Property: כל invariants ב־FINANCIAL-RULES.
- Integration: RLS, audit, migrations, idempotency, document deletion, recommendation proposed-only.
- E2E: onboarding, שני משתמשים, opening picture, offline/sync/conflict, import→draft→approval, dashboard, budget/debt/business, reports.
- Security: IDOR, upload abuse, injection, secret exposure, auth/recent-auth.
- Accessibility/visual: axe, keyboard, focus, text scaling, 360/390/768/1280, RTL golden screenshots.
- Performance: weak mobile network, large dataset, import/report latency, Lighthouse budgets שנקבעים ב־ADR.

## זמן וכסף

שעון דטרמיניסטי; UTC + Asia/Jerusalem; סוף חודש/שנה, שעון קיץ, leap year, תשלום בחצות, months of different lengths. סכומי 0/גדולים/refund/rounding.

## Migrations

בדיקה על DB נקי ועל snapshot קיים רלוונטי; recovery/rollback strategy. אין שינוי production ידני. Seed/fixtures אנונימיים ל־test בלבד; production seed אסור.

## Evidence

לכל requirement ID מיפוי test. דוח כולל command, exit/result, counts passed/failed/skipped, artifact/screenshot כשנדרש. אין “all tests passed” בלי פקודה ותוצאה.

## גלגולי חוב

- פירעון 5,000 וחוב חדש 5,000 משאירים את החוב המצרפי ללא שינוי.
- פירעון 5,000 שמומן ב-4,000 חוב חדש מציג ירידה נטו של 1,000 בלבד.
- סגירת נושה אינה מפעילה חגיגת ירידת חוב כאשר החוב הועבר לנושה אחר.
- קישור rollover אינו יוצר או מוחק יתרה ואינו משנה דוחות.
- rollover מוצע אינו מאושר אוטומטית; אישור כפול הוא idempotent.
- הלוואה עתידית אפשרית מאדם אינה נכנסת ל-safe spend או לתחזית השמרנית.
- סכום החוב ב-snapshot שווה לסכום יתרות החובות הפעילים, גם לאחר שרשרת גלגולים.
- תיקון יתרה מסומן בנפרד ואינו נספר כפירעון, חוב חדש או התקדמות.
