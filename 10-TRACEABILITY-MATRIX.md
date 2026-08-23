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
| UX-HOME-001 | UX | home route | usability/E2E | 6 | Planned |
| UX-TRUST-001 | UX | breakdown sheet | E2E | 6 | Implemented in M6 — כל מספר מרכזי פותח breakdown |
| UX-RTL-001 | UX | design system | visual | 1/6 | In progress — shell verified in M1 (lang/dir/bidi unit tests); pixel overflow at 4 widths pending M6 |
| SEC-RLS-001 | Security | policies | negative integration | 2+ | Implemented in M2–M4 — 15 טבלאות RLS enabled+forced; **הרצה מול DB טרם בוצעה** |
| SEC-INVITE-001 | Security | household_invitations + accept function | negative integration | 2 | Implemented in M2 — tests written, NOT RUN |
| SEC-AUDIT-001 | Security | audit_events + append-only triggers | negative integration | 2+ | Implemented in M2–M4 — טריגר audit אוטומטי; **לא הורץ** |
| SEC-KEY-001 | Security | env contract + client-secret gate | source + bundle scan | 2+ | **Verified in M2** — gate passes, negative test confirms it fails on a planted secret |
| OFF-SYNC-001 | Architecture | sync engine | E2E/property | 7 | Planned |
| IMP-DRAFT-001 | Architecture | import pipeline | integration | 8 | Planned |
| AI-TOOL-001 | Architecture | advisor boundary | injection/integration | 12 | Planned |
| FIN-ROLL-001 | Financial | debt events + rollover links + aggregate meter | property/integration/E2E | 4–6 | **Verified in M5** — 5,000 שנפרעו ב־5,000 שנלוו = שינוי נטו 0 |
| UX-DEBT-002 | UX | "מה קרה באמת לחוב" + linked timeline | E2E/visual | 6 | Implemented in M6 — כרטיס "מה קרה באמת לחוב" + ציר זמן |
| PROD-KPI-001 | Product | approval inbox + classification flow | E2E/usage metric | 8 | Planned |
| PROD-KPI-002 | Product | reconciliation flow + freshness prompts | integration/E2E | 3/8 | Planned |
| PROD-KPI-003 | Product | safe spend hero + breakdown sheet | usability/E2E | 6 | Implemented in M6 — hero + breakdown; בדיקת משתמש ב־M14 |
| PROD-KPI-004 | Product | safe business transfer service | property/E2E | 11 | Planned |
| PROD-KPI-005 | Product | net debt trend meter | property/E2E | 4–6 | Implemented in M4–M6 |
| PROD-KPI-006 | Product | summaries + limited real-data UAT | UAT | 14 | Planned |
| UX-A11Y-001 | UX | design system + core screens | axe/keyboard/visual | 1/6/14 | In progress — palette contrast + focus ring + reduced motion verified in M1; axe/keyboard pending M6 |
| UX-STATE-001 | UX | core screen state matrix | E2E/visual | 6+ | Partial in M6 — empty/partial נבדקו; loading/stale/offline/conflict ב־M7+ |
| FIN-ACCOUNT-001 | Architecture | financial_accounts + balance snapshots | contract/migration/integration | 3 | Implemented in M3 — 18 בדיקות חוזה; **מיגרציה לא הוחלה** |
| FIN-SCOPE-001 | Financial | record scope + engine aggregation | unit/property | 3/5 | **Verified in M5** — transfer נטו אפס כ־property |
| FIN-DEBT-001 | Financial | debt_events + replayDebtBalances | unit/property/integration | 4 | Implemented in M4 — 27 unit + 3 property; **מיגרציה לא הוחלה** |
| FIN-RESERVE-001 | Financial | reserveFloor | unit | 5 | **Verified in M5** — הרכיב שקבע את הרצפה מוחזר ומוצג |
| FIN-STRESS-001 | Financial | runStressTests | unit/scenario | 5 | **Verified in M5** — ששת התרחישים רצים ומדווחים |
| FIN-QUALITY-001 | Financial | scoreDataQuality | unit | 5 | **Verified in M5** — סכום המשקלים 100 נאכף (ADR-0016) |
| FIN-DECISION-001 | Financial | buildDecision | unit | 5 | **Verified in M5** — 14 שדות המעטפת נבדקים |
| UX-SOURCE-001 | UX | dashboard data-source gate | unit | 6 | **Verified in M6** — 15 בדיקות; ייצור סגור בכל ערך דגל |
