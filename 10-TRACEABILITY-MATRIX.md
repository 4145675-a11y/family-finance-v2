# TRACEABILITY MATRIX

יש להרחיב בכל milestone. אין לסמן Done בלי קוד ובדיקה.

מרשם המזהים המלא נמצא ב־`docs/REQUIREMENTS.md`. ההתאמה בין המרשם, המטריצה ומסמכי הסמכות נאכפת על ידי `npm run check:traceability`.

| Requirement | מקור | מימוש צפוי | בדיקה | Milestone | סטטוס |
|---|---|---|---|---:|---|
| PROD-CORE-001 | Product | dashboard + finance-engine | unit/E2E | 5–6 | Planned |
| PROD-CORE-002 | Product | debt snapshots | property/E2E | 4–6 | Planned |
| PROD-CORE-003 | Product | recommendation service | integration/E2E | 6/12 | Planned |
| FIN-MONEY-001 | Financial | contracts/DB | property/migration | 3/5 | Planned |
| FIN-MODE-001 | Financial | policy engine | unit/property | 5 | Planned |
| FIN-WATERFALL-001 | Financial | allocation engine | property/scenario | 5 | Planned |
| UX-HOME-001 | UX | home route | usability/E2E | 6 | Planned |
| UX-TRUST-001 | UX | breakdown sheet | E2E | 6 | Planned |
| UX-RTL-001 | UX | design system | visual | 1/6 | In progress — shell verified in M1 (lang/dir/bidi unit tests); pixel overflow at 4 widths pending M6 |
| SEC-RLS-001 | Security | policies | negative integration | 2+ | Planned |
| OFF-SYNC-001 | Architecture | sync engine | E2E/property | 7 | Planned |
| IMP-DRAFT-001 | Architecture | import pipeline | integration | 8 | Planned |
| AI-TOOL-001 | Architecture | advisor boundary | injection/integration | 12 | Planned |
| FIN-ROLL-001 | Financial | debt events + rollover links + aggregate meter | property/integration/E2E | 4–6 | Planned |
| UX-DEBT-002 | UX | "מה קרה באמת לחוב" + linked timeline | E2E/visual | 6 | Planned |
| PROD-KPI-001 | Product | approval inbox + classification flow | E2E/usage metric | 8 | Planned |
| PROD-KPI-002 | Product | reconciliation flow + freshness prompts | integration/E2E | 3/8 | Planned |
| PROD-KPI-003 | Product | safe spend hero + breakdown sheet | usability/E2E | 6 | Planned |
| PROD-KPI-004 | Product | safe business transfer service | property/E2E | 11 | Planned |
| PROD-KPI-005 | Product | net debt trend meter | property/E2E | 4–6 | Planned |
| PROD-KPI-006 | Product | summaries + limited real-data UAT | UAT | 14 | Planned |
| UX-A11Y-001 | UX | design system + core screens | axe/keyboard/visual | 1/6/14 | In progress — palette contrast + focus ring + reduced motion verified in M1; axe/keyboard pending M6 |
| UX-STATE-001 | UX | core screen state matrix | E2E/visual | 6+ | Planned |
