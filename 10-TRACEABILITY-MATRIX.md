# TRACEABILITY MATRIX

יש להרחיב בכל milestone. אין לסמן Done בלי קוד ובדיקה.

מרשם המזהים המלא נמצא ב־`docs/REQUIREMENTS.md`. ההתאמה בין המרשם, המטריצה ומסמכי הסמכות נאכפת על ידי `npm run check:traceability`.

| Requirement | מקור | מימוש צפוי | בדיקה | Milestone | סטטוס |
|---|---|---|---|---:|---|
| PROD-CORE-001 | Product | dashboard + finance-engine | unit/E2E | 5–6 | Implemented in M5–M6 — finance-engine + מסך הבית; לא אומת מול נתוני אמת |
| PROD-CORE-002 | Product | debt snapshots | property/E2E | 4–6 | Implemented in M4–M6 — מד חוב נטו על שחזור אירועים |
| PROD-CORE-003 | Product | recommendation service | integration/E2E | 6/12 | Implemented in M6 — פעולה אחת נגזרת דטרמיניסטית מהמצב |
| FIN-MONEY-001 | Financial | contracts/DB | property/migration | 3/5 | **Verified in M3/M5** — contracts, DB checks, unit + property |
| FIN-MODE-001 | Financial | policy engine | unit/property | 5 | **Verified in M5** — 18 בדיקות, ששת המצבים נגישים |
| FIN-WATERFALL-001 | Financial | allocation engine | property/scenario | 5 | **Verified in M5** — 13 unit + 4 property על הסדר |
| UX-HOME-001 | UX | home route | usability/E2E | 6 | Structure built in M6b — סדר ההיררכיה נאכף ב־screens.test.ts; בדיקת משתמש ב־M14 |
| UX-TRUST-001 | UX | breakdown sheet | E2E | 6 | **Verified in M6b** — כל מספר מרכזי פותח פירוט; כיסוי ניסוח נאכף ב־copy.test.ts |
| UX-RTL-001 | UX | design system | visual | 1/6 | In progress — shell verified in M1 (lang/dir/bidi unit tests); pixel overflow at 4 widths pending M6 |
| SEC-RLS-001 | Security | policies | negative integration | 2+ | **Verified in M2 (2026-09-14)** — 38/38 בדיקות שליליות מול Supabase, 5 טבלאות M2; 32/32 טבלאות RLS enabled+forced במסד; allow/deny ל־M3+ טרם |
| SEC-INVITE-001 | Security | household_invitations + accept function | negative integration | 2 | **Verified in M2 (2026-09-14)** — 7 בדיקות מול DB: hash, פדיון יחיד, replay/שגוי/פג/מבוטל/anon נדחים |
| SEC-AUDIT-001 | Security | audit_events + append-only triggers | negative integration | 2+ | **Verified in M2 (2026-09-14)** — UPDATE/DELETE נדחים גם לבעלים; מגבלת מחיקה מתועדת, ארכוב/אנונימיזציה בעתיד |
| SEC-KEY-001 | Security | env contract + client-secret gate | source + bundle scan | 2+ | **Verified in M2** — gate passes, negative test confirms it fails on a planted secret |
| OFF-SYNC-001 | Architecture | sync engine | E2E/property | 7 | Planned |
| IMP-DRAFT-001 | Architecture | import pipeline | integration | 8 | Planned |
| AI-TOOL-001 | Architecture | advisor boundary | injection/integration | 12 | Planned |
| FIN-ROLL-001 | Financial | debt events + rollover links + aggregate meter | property/integration/E2E | 4–6 | **Verified in M5** — 5,000 שנפרעו ב־5,000 שנלוו = שינוי נטו 0 |
| UX-DEBT-002 | UX | "מה קרה באמת לחוב" + linked timeline | E2E/visual | 6 | Implemented in M6 — כרטיס "מה קרה באמת לחוב" + ציר זמן |
| PROD-KPI-001 | Product | approval inbox + classification flow | E2E/usage metric | 8 | Planned |
| PROD-KPI-002 | Product | reconciliation flow + freshness prompts | integration/E2E | 3/8 | Planned |
| PROD-KPI-003 | Product | safe spend hero + breakdown sheet | usability/E2E | 6 | Implemented in M6b — Hero יחיד בשפה פשוטה; בדיקת משתמש ב־M14 |
| PROD-KPI-004 | Product | safe business transfer service | property/E2E | 11 | Planned |
| PROD-KPI-005 | Product | net debt trend meter | property/E2E | 4–6 | Implemented in M4–M6 |
| PROD-KPI-006 | Product | summaries + limited real-data UAT | UAT | 14 | Planned |
| UX-A11Y-001 | UX | design system + core screens | axe/keyboard/visual | 1/6/14 | Partial in M6b — 23 זוגות ניגודיות AA, focus, 44px, טקסט חלופי למד; **axe/מקלדת בדפדפן לא הורצו** |
| UX-STATE-001 | UX | core screen state matrix | E2E/visual | 6+ | Partial in M6b — empty/incomplete/stale/demo/coming-soon נבדקו; offline/conflict ב־M7 |
| FIN-ACCOUNT-001 | Architecture | financial_accounts + balance snapshots | contract/migration/integration | 3 | Implemented in M3 — 18 בדיקות חוזה; **מיגרציה לא הוחלה** |
| FIN-SCOPE-001 | Financial | record scope + engine aggregation | unit/property | 3/5 | **Verified in M5** — transfer נטו אפס כ־property |
| FIN-DEBT-001 | Financial | debt_events + replayDebtBalances | unit/property/integration | 4 | Implemented in M4 — 27 unit + 3 property; **מיגרציה לא הוחלה** |
| FIN-RESERVE-001 | Financial | reserveFloor | unit | 5 | **Verified in M5** — הרכיב שקבע את הרצפה מוחזר ומוצג |
| FIN-STRESS-001 | Financial | runStressTests | unit/scenario | 5 | **Verified in M5** — ששת התרחישים רצים ומדווחים |
| FIN-QUALITY-001 | Financial | scoreDataQuality | unit | 5 | **Verified in M5** — סכום המשקלים 100 נאכף (ADR-0016) |
| FIN-DECISION-001 | Financial | buildDecision | unit | 5 | **Verified in M5** — 14 שדות המעטפת נבדקים |
| UX-SOURCE-001 | UX | dashboard data-source gate | unit | 6 | **Verified in M6** — 15 בדיקות; ייצור סגור בכל ערך דגל |
| UX-DAILY-001 | Product | home screen hierarchy | static/unit | 6b | **Verified in M6b** — סדר, Hero יחיד, תקציב לא על הבית |
| UX-COPY-001 | UX | copy layer + tone gate | unit | 6b | **Verified in M6b** — 31 בדיקות; כל כלל נורה על fixture |
| FIN-BUDGET-001 | Financial | calculateBudget + budget tables | unit/property/migration | 6b | **Verified in M6b** — 24 unit + 6 property; **מיגרציה לא הוחלה** |
| FIN-FOODWEEK-001 | Financial | calculateFoodWeek | unit/property | 6b | **Verified in M6b** — 28 unit + 4 property |
| LOCAL-STORE-001 | Architecture | packages/local-store | unit/atomicity | 7 | **Verified in M7** — כתיבה ב־rename, תור כתיבות, ולידציה לפני כתיבה, revision ישן נדחה |
| LOCAL-BACKUP-001 | Operations | packages/local-store/src/backup.ts | unit/negative | 7 | **Verified in M7** — שישה סוגי דחייה בשמם; הסיכום מחושב מהנתונים ולא נקרא מהקובץ |
| IMP-PARSE-001 | Architecture | packages/document-import | unit/fixture | 7 | **Verified in M7** — 107 בדיקות; גיליון, עמוד ושורה נשמרים לכל הצעה |
| IMP-SAFETY-001 | Security | document-import/limits + signature + zip | negative/unit | 7 | **Verified in M7** — פצצת דחיסה, מאקרו, XXE, הרצה בשם csv, ‎.xls בינארי — כולם נדחים בשמם |
| IMP-APPROVE-001 | Architecture | local-store/src/imports.ts | integration/negative | 7 | **Verified in M7** — 30 בדיקות; אישור כפול נדחה, היפוך אינו נוגע במה שהוזן ידנית |
| ENTRY-MANUAL-001 | Product | apps/web/app/entry + accounts + debts | unit/browser | 7 | **Verified in M7** — אותו מנתח סכומים לטופס ולקובץ; כל שדה נבדק ב־forms.test.ts |
| REP-EXPORT-001 | Architecture | apps/web/lib/reports + api/export | unit/roundtrip | 7 | **Verified in M7** — יבוא ממתין אינו בשום סכום; ה־workbook נקרא חזרה עם הסכומים במדויק |
| PWA-INSTALL-001 | Architecture | apps/web/app/manifest + public/service-worker.js | unit/source | 7 | **Verified in M7** — ניווט תמיד לרשת; אין push ואין background sync שאין להם שרת |
| AUTH-PASSKEY-001 | Security | packages/webauthn + apps/web/lib/auth | unit/negative | 8 | **Verified in M8** — origin, RP ID, אתגר, UV, חתימה ומונה — כל בדיקה נבדקת גם בכישלונה |
| AUTH-NOBIO-001 | Security | apps/web/lib/auth/model.ts | unit/schema | 8 | **Verified in M8** — אין שדה שיכול להחזיק תבנית ביומטרית |
| AUTH-SESSION-001 | Security | apps/web/lib/auth/session.ts | unit | 8 | **Verified in M8** — אתגר חוזר נדחה; פעילות אינה מאריכה מעבר ל־12 שעות |
| AUTH-REAUTH-001 | Security | apps/web/lib/auth/session.ts + api/export | unit/route | 8 | **Verified in M8** — "מחובר" אינו "אומת עכשיו" |
| GEM-MODEL-001 | Financial | packages/contracts/src/checks.ts + local-store/src/checks.ts | unit/property | 8 | **Verified in M8** — כל מצב שאפשר להגיע אליו הוא מסמך תקין |
| GEM-DELIVERY-001 | Financial | local-store/src/checks.ts | unit/property | 8 | **Verified in M8** — מסירה אינה יוצרת תנועה ואינה יוצרת אירוע חוב |
| GEM-FORECAST-001 | Financial | local-store/src/projection.ts | integration | 8 | **Verified in M8** — פריט אחד לכל צ׳ק, לפי מזהה הצ׳ק |
| GEM-MATCH-001 | Architecture | local-store/src/check-match.ts | unit/integration | 8 | **Verified in M8** — יבוא חוזר של אותו דף אינו פורע צ׳ק פעמיים |
| PROD-FAILCLOSED-001 | Architecture | apps/web/lib/config/deployment.ts + instrumentation.ts | unit/gate | 9 | **Verified in M9** — השרת הבנוי מסרב לעלות; התצורה התקינה כן עולה |
| PROD-HEALTH-001 | Operations | apps/web/app/api/health/route.ts | gate | 9 | **Verified in M9** — שמות הגדרות בלבד, לעולם לא ערכים |
| PROD-NOENV-001 | Security | tools/check-no-env-files.mjs | gate | 9 | **Verified in M9** — נמצא כש־.env.local סיפק תצורה בשקט לשער אחר |
| PROD-SCHEMA-001 | Architecture | supabase/migrations/20260908* | migration | 9 | **Applied (2026-09-14)** — 32 טבלאות, 94 policies קיימות במסד; בדיקות התנהגות ל־M9 טרם |
| PROD-CHECKS-DB-001 | Financial | post_dated_checks constraints + unique indexes | migration | 9 | **Applied (2026-09-14), behaviour untested on DB** — צ׳ק אחד ↔ תנועה אחת ↔ אירוע חוב אחד |
| PROD-APPROVAL-DB-001 | Architecture | app.assert_batch_ready_for_approval() | migration | 9 | **Applied (2026-09-14), behaviour untested on DB** — שתיקה אינה הסכמה, גם בשכבת המסד |
| PROD-RLS-COVER-001 | Security | tools/check-rls-coverage.mjs | gate | 9 | **Verified in M9** — סטטי; **אומת במסד 2026-09-14**: 32/32 forced, 94 policies |
| PROD-PERSON-SCOPE-001 | Security | webauthn_credentials / push_subscriptions policies | migration | 9 | **Applied (2026-09-14), allow/deny untested** — משק בית משותף אינו זהות משותפת |
| PROD-NOTIFY-PRIVACY-001 | Privacy | notification_deliveries | migration | 9 | **Applied (2026-09-14)** — subject_key בלבד, ללא גוף הודעה |
