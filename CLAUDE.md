# CLAUDE.md

## מטרה

מקור אמת זוגי לבית, עסק וחובות. אמינות ושלמות קודמות למהירות ולמראה.

## קרא לפני כל milestone

README, PRODUCT, FINANCIAL, UX/DESIGN, ARCHITECTURE, SECURITY, TEST, MILESTONES, TRACEABILITY ו־MILESTONE_STATUS. אין להסתמך על זיכרון chat במקום specs.

## פקודות

Package manager: **npm**, נעול (`ADR-0001`). אין החלפה ללא ADR. cache פנימי: `.npm-cache` — אין התקנה global.

פעילות היום: `npm ci --ignore-scripts` (install) · `format` / `format:check` · `typecheck` · `lint` · `unit` (Vitest) · `dev` · `build` · `check:shell` · `scan:forbidden` · `check:traceability` · **`npm run verify`** (כל השערים ברצף).

מוגדרות ויופעלו ב־milestone שלהן (`ADR-0003`): integration/RLS (2) · property (5) · E2E, axe, RTL visual (6).

החוזה המלא: `docs/COMMANDS.md`. השערים: `docs/CI-GATES.md`. פקודה נכנסת ל־`package.json` רק כשהיא רצה באמת — אין script שמדפיס "not implemented" ואין script ריק שמחזיר 0.

ב־pipeline יש לשמר קוד יציאה אמיתי: `set -o pipefail`, לכידת `$?` מיד, `exit "$code"`. קוד יציאה של `tail`/`grep` אינו ראיה.

## כללי כסף

integer minor units; amount non-negative + direction; UTC/Asia-Jerusalem; transfer net zero; settlement לא כפול; draft לא truth; uncertain לא safe; AI לא מחשב; כל result עם breakdown/assumptions/warnings/freshness/confidence/version.

## גבולות

finance-engine pure ונפרד; DB דרך layers; AI דרך tools; integrations דרך adapters; schema רק migration; private table תמיד RLS+negative test; service role רק שרת.

## עבודה

רק milestone שאושר. בדוק git ושמור עבודה קיימת. אין refactor מחוץ ל־scope. ADR לשינוי מהותי. לפני UI: contracts/schema/RLS/tests. בסוף gates, status, evidence ועצירה.

## אין השלמה מדומה

אין PASS עם TODO/FIXME פונקציונלי, mock/stub/fake production, placeholder כיכולת, skip/only, assertion ריקה, catch ריק, @ts-ignore לא מאושר, lint disabled, hard-coded success, migration לא בדוקה, production seed, secret/PII log, או בדיקה שלא הורצה. Mock מקומי רק adapter+dev/test+flag off+fail closed.

## Evidence

“עובד” = קוד + בדיקה מהותית + פקודה שהורצה + תוצאה מתועדת + אין כשל מוסתר. עצור לאחר כל checkpoint; אין מעבר ללא הוראה מפורשת.


## Local machine safety boundary — mandatory

- The only authorized filesystem scope is the current project root and its descendants.
- Never read, list, search, create, edit, move, copy, delete, or execute files outside this project.
- Never access parent directories, sibling projects, Desktop, Documents, Downloads, OneDrive, personal media, AppData, credentials, SSH keys, cloud configuration, registry, or system directories.
- Never use `cd ..`, `/add-dir`, `--add-dir`, an absolute path outside the project, or any command intended to discover files elsewhere on the computer.
- Never request or use `--dangerously-skip-permissions`, bypass mode, an unsandboxed escape, or persistent always allow approval.
- Never modify `.claude/settings.json` or weaken any security, permission, privacy, audit, or isolation rule.
- Never install global packages or change Windows, PowerShell profiles, environment variables, registry, services, scheduled tasks, startup items, or system configuration.
- Install dependencies locally inside this project only.
- Before every filesystem command, verify that every target resolves inside the project root.
- Use project-relative paths whenever possible.
- If an external file or credential is required, stop and ask the user to place the minimum necessary copy inside the project. Do not retrieve it yourself.
- If any requested task appears to require access outside the project, stop and explain the blocker. Do not attempt a workaround.
