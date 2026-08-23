# CHECKPOINT — Milestone 5: Finance Engine

- **Result**: **PASS**
- **Branch**: `milestone-2-identity-isolation` · לא בוצע merge
- **Environment**: local, Windows 11 Pro, Node v24.19.0, npm 11.17.0
- **Date**: 2026-08-23

> **למה PASS ולא PARTIAL**: המנוע טהור ודטרמיניסטי. אין לו תלות במסד, ברשת או בשעון המערכת — `asOf` מוזרק. כל מה שהוא מבטיח ניתן להרצה ונבדק, ולכן החסימה של Supabase אינה נוגעת לו.

## Scope

### הושלם ואומת

| רכיב | קובץ | ראיה |
|---|---|---|
| מוסכמות כסף | `money.ts` | 21 בדיקות; half-up כולל חצי שלילי, `-0` מנוטרל |
| לוח שנה עסקי | `dates.ts` | 23 בדיקות; מעברי DST, סוף פברואר מעוברת, יום 31 בחודש קצר |
| `safe_household_spend` | `household.ts` | 18 בדיקות; ה־breakdown משחזר את התוצאה בדיוק |
| רזרבה (`FIN-RESERVE-001`) | `household.ts` | הגבוה מארבעה רכיבים, והרכיב שקבע מוחזר |
| נוסחאות העסק | `business.ts` | 15 בדיקות; רווח חשבונאי ≠ רווח ממומש |
| מפל (`FIN-WATERFALL-001`) | `waterfall.ts` | 13 unit + 4 property; אין דילוג על שלב |
| מצבים (`FIN-MODE-001`) | `modes.ts` | 18 בדיקות; ששת המצבים נגישים בפועל |
| תחזית ונקודת שפל | `forecast.ts` | שמרן מול צפוי; יום כשל ראשון |
| תרחישי לחץ (`FIN-STRESS-001`) | `stress.ts` | ששת התרחישים מ־§ Stress tests |
| איכות נתונים (`FIN-QUALITY-001`) | `quality.ts` | משקלים ב־`ADR-0016`, סכום 100 נאכף בבדיקה |
| מעטפת החלטה (`FIN-DECISION-001`) | `decision.ts` | 14 שדות; snapshot id נגזר מ־hash הקלט |
| הרכבה | `snapshot.ts` | 19 בדיקות end-to-end |

### באג אמיתי שנתפס על ידי בדיקות ה־property

`toSigned({ amountMinor: 0, direction: 'outflow' })` החזיר `-0`. הערך עובר כל בדיקה שסכום מאוחסן צריך לעבור — הוא שלם ואינו קטן מאפס — אך שונה מ־`0` תחת `Object.is`, ולכן יכול היה להגיע לרשומה ול־`inputHash` ולשבור השוואת snapshots. תוקן ב־`money.ts` (`normaliseZero`), ונעול בבדיקת unit נוספת שמתעדת את המקור.

זו בדיוק הסיבה ש־`08-TEST-PLAN.md` דורש property tests לצד unit: הדוגמה שכותב הבדיקה חשב עליה לא הייתה תופסת את זה.

### לא בוצע, ובכוונה

`sinking_funds` ו־`long_term_goals` תובעים 0 במפל. אין להם נתונים עד Milestone 10, והשלבים מוצגים ריקים כדי שההיעדר יהיה גלוי ולא שקוף. דירוג חובות מומלץ — Milestone 12.

## Commands & Evidence

| Gate | Command | Result | Counts |
|---|---|---|---|
| Unit | `npm run unit` | **PASS** | 581 passed (מתוכן 206 של המנוע), 0 skipped |
| **Property** | `npm run property` | **PASS** | **24 passed**, seed 20260823, 300 runs לכל property |
| Typecheck | `npm run typecheck` | **PASS** | כולל workspace חדש |
| Lint | `npm run lint` | **PASS** | `--max-warnings=0` |
| Aggregate | `npm run verify` | **PASS** | exit 0 אמיתי |

שער ה־property עלה ב־milestone הזה בדיוק כפי ש־`docs/CI-GATES.md` קבע מראש, עם config נפרד ו־seed קבוע כדי שכשל יהיה ניתן לשחזור.

## Negative verification

| מה נשבר בכוונה | תוצאה |
|---|---|
| `Math.round(-2.5)` מול `roundHalfUp(-2.5)` | −2 מול −3; הבדיקה מתעדת למה לא משתמשים ב־`Math.round` |
| הכנסה `probable` נוספת לתמונה | `safe` אינו זז; `conditional` עולה — נבדק כ־property על טווח שלם |
| צורך חיוני גדול יותר | התוצאה לעולם אינה עולה — property מונוטוניות |
| מפל עם כסף חלקי | שלב מאוחר אינו מקבל דבר לפני ששלב מוקדם מולא — property |
| חבילת תרחישים ריקה | `stressTestsPassed([])` מחזיר `false`, לא `true` |

## Reviews

- **Code**: אין `any`, אין `@ts-ignore`, אין catch ריק. המנוע אינו מייבא UI, DB או AI.
- **Financial invariants**: כל האינווריאנטים מ־§ אינווריאנטים שניתן לבטא על הקלט של המנוע מכוסים ב־`invariants.property.test.ts`.
- **Security/privacy**: המנוע אינו נוגע בסודות ואינו כותב ללוג.

## Risks

| סיכון | חומרה | טיפול |
|---|---|---|
| `inputHash` הוא FNV-1a ולא hash קריפטוגרפי | נמוכה | מתועד בקוד: מזהה קלט לשחזור, לא גבול אבטחה |
| `allMinimumsCovered` נגזר בקירוב ב־`snapshot.ts` | בינונית | מוצהר; יתחדד כשיהיו נתוני תשלום בפועל (M8) |
| תרחישי הלחץ מניחים שהעברה מאושרת היא כל כסף העסק בתחזית הבית | בינונית | מוצהר בקוד; יתחדד ב־M11 |

## Stop declaration

לא מוזג ל־`main`. המנוע אינו מחובר למסד ואינו נקרא על ידי שום שירות שרת — רק על ידי הדשבורד של M6.
