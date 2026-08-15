# FINANCIAL RULES — סמכות עליונה לכל מספר

## מוסכמות

- `FIN-MONEY-001`: `amount_minor` הוא integer לא־שלילי; המשמעות נגזרת מ־direction/type. אין סכום חתום במקביל.
- ILS הוא מטבע ברירת המחדל. currency נשמר מפורשות.
- זמן נשמר UTC; תצוגה וכללים עסקיים לפי `Asia/Jerusalem`.
- שמור בנפרד transaction_date, posting_date, value_date, due_date, expected_date.
- עיגול: half-up לאגורה בסוף כל רכיב חישוב שנדרש; אין עיגול ביניים מצטבר ללא תיעוד. ריבית מחושבת ב־decimal ומומרת לאגורות בנקודת החיוב.
- כל חישוב מחזיר result, breakdown, assumptions, warnings, freshness, confidence, input_hash ו־calculation_version.

## Scopes ותנועות

- household, business, consolidated.
- transfer אינו הכנסה/הוצאה ב־consolidated.
- העברה מהעסק לבית: owner draw בצד עסק, owner contribution בצד בית, net zero מאוחד.
- settlement של כרטיס בבנק אינו הוצאה נוספת.
- משיכת מזומן היא transfer ל־cash wallet; שימוש הוא expense.
- refund מקושר לפעולת המקור. void אינו נספר. correction יוצר היסטוריה, לא מחיקה.
- splits חייבים להסתכם בדיוק לסכום הפעולה.

## נזילות מול ודאות

ודאות (`possible/probable/certain`) אינה מצב מזומן. גם `certain` שטרם התקבל אינו liquid.

- `safe`: כסף קיים או הכנסה ביתית ודאית, בניכוי כל המחויבויות והרזרבות.
- `conditional`: תלוי בהכנסה סבירה שטרם התקבלה; לעולם אינו מספר ההוצאה הראשי.
- `unavailable`: מסים, התחייבויות, רזרבה, חוב או סכום שמור.

## מצבי ההתנהלות

`FIN-MODE-001`:

1. `emergency`: צפוי אי־תשלום של צורך חיוני/משכנתה/מינימום חוב או חריגה מיידית.
2. `stabilization`: אין כשל מיידי, אך אין רזרבה והחוב עלול לגדול.
3. `stop_new_debt`: חודש יכול להסתיים ללא חוב חדש אם עומדים בתוכנית.
4. `repayment`: יש רזרבה מינימלית ומרחב להחזר נוסף.
5. `buffer_building`: החוב בשליטה והכרית מתרחבת.
6. `growth`: מטרות ארוכות טווח לאחר יציבות.

המערכת אינה נותנת אותה המלצה בכל מצב. מעבר mode דורש תנאים מדידים ונשמר ב־snapshot.

`emergency` מופעל בין השאר כאשר בתוך 14 יום אין כיסוי לצורך חיוני, משכנתה, מס, תשלום מינימום או התחייבות בסיכון; צפויה חריגה/החזרת חיוב; או נקודת השפל נמוכה מהרצפה. במצב זה נעצרות המלצות להוצאה לא חיונית, חיסכון למטרות ופירעון מואץ.

`repayment` מותר רק כשאין פיגור חיוני/משפטי, כל המינימום מכוסה, הרזרבה קיימת, התחזית השמרנית אינה שלילית ו־stress tests בסיסיים עוברים. הופעת trigger חמור מחזירה אוטומטית למצב מחמיר ומתועדת.

## מפל הקצאת כסף

`FIN-WATERFALL-001` — כל כסף פנוי מוקצה בסדר:

1. צרכים חיוניים עד סוף החודש.
2. משכנתה והתחייבויות שאי־תשלומן יוצר נזק מהותי.
3. מסים וכספים שאינם שייכים למשפחה.
4. תשלומי מינימום לכל החובות.
5. רזרבה תפעולית מינימלית שמונעת חוב חדש.
6. חוב בסיכון משפטי או דרישת מלווה דחופה.
7. חוב יקר לפי עלות אפקטיבית.
8. קרנות להוצאות מחזוריות קרובות.
9. הרחבת כרית הביטחון.
10. מטרות ארוכות טווח.

אין החזר מואץ אם הוא מוריד את הרזרבה מתחת לרצפה או יוצר הסתברות ממשית לחוב חדש.

## נוסחאות

`reliable_income = fixed_net_salaries + fixed_benefits + approved_safe_business_transfer`

`debt_service_ratio = mandatory_monthly_debt_payments / max(reliable_income, 1)`

היחס הוא מדד סיכון, לא הוראה אוטומטית. אם ההכנסה העסקית טרם מומשה, אינה במכנה.

`business_operating_profit = received_business_income - approved_business_expenses`

`realized_business_cash_profit = received_business_income - paid_business_expenses - accrued_tax_reserve - certain_business_obligations`

`business_available_cash = liquid_business_balances - reserved_taxes - certain_business_obligations - operating_reserve - overdue_business_payables`

`safe_business_transfer = max(0, min(cumulative_realized_profit, business_available_cash, household_need_until_month_end))`

`safe_household_spend = max(0, verified_liquid_household_cash + certain_income_received_or_due_before_need + approved_safe_business_transfer - essential_needs_until_period_end - certain_due_items - mortgage_and_debt_minimums - protected_reserves - household_safety_floor - unresolved_negative_reconciliation_gaps)`

התוצאה השלילית אינה נבלעת; היא מוצגת בנפרד כ־`funding_gap` עם מועד ורכיבי סיכון.

`net_consumer_debt_change = consumer_debt_end - consumer_debt_start`

`net_total_debt_change = total_debt_including_mortgage_end - total_debt_including_mortgage_start`

## רזרבה מינימלית

אין לקבוע “3–6 חודשים” ככלל ראשון. בתחילת ייצוב, הרצפה היא הגבוה מבין:

- סכום מינימום ידני מאושר;
- צרכים חיוניים עד כניסת ההכנסה הוודאית הבאה;
- buffer לתקלה סבירה שהוגדרה;
- סכום שנדרש למנוע שימוש חדש באשראי מתגלגל.

המערכת מציגה למה נבחרה הרצפה. שינוי שלה הוא החלטה מהותית.

## חובות לאנשים

לכל חוב פרטי: יתרה, הבטחה/סיכום, מועד אם קיים, דרישה אחרונה, דחיפות, רגישות מערכת יחסים, אפשרות לתשלום חלקי, תאריך שיחה אחרונה והערות. יחס אישי אינו מתורגם אוטומטית לריבית; הוא שיקול מוסבר ונפרד.

## גלגול חוב והחלפת נושה

כאשר הלוואה חדשה משמשת לפירעון חוב קיים, המערכת שומרת שלוש עובדות נפרדות: החוב הישן נפרע, חוב חדש נוצר, וקישור `rollover` מסביר מה מימן את הפירעון. אסור למזג נושים, לשכתב את היסטוריית החוב הישן או להציג את סגירתו כירידה בחוב הכולל.

המד הקובע הוא שינוי היתרות בין שתי נקודות זמן, לא מחזור התשלומים:

```text
consumer_debt_total(t) = sum(active non-mortgage debt balances at t)
total_debt(t) = consumer_debt_total(t) + mortgage_balance(t)
net_consumer_debt_change = consumer_debt_total(end) - consumer_debt_total(start)
```

- תוצאה שלילית: ירידה אמיתית בחוב.
- אפס: החוב לא ירד, גם אם נושה אחד נפרע והוחלף באחר.
- תוצאה חיובית: החוב גדל.

לצד המד הקובע יוצגו מדדי הסבר: `gross_principal_repaid`, `new_debt_originated`, `rollover_funded_repayment`, `income_funded_principal_reduction`, `interest_and_fees_paid`, `rollover_count`, `creditor_churn` ו-`rollover_ratio`. תיקוני יתרה מוצגים בנפרד ואינם הישג או הידרדרות.

קישור rollover שמוסק לפי סכום/זמן הוא הצעה בלבד עד אישור משתמש. הלוואה אפשרית מאדם אחר לעולם אינה נחשבת מקור זמין בתחזית. המערכת תחשב גם תלות בגלגולים וסיכון קריאה: סכום חוב פרטי שעלול להידרש בתוך 7/30/90 יום, מספר גלגולים בתקופה, זמן ההתראה הממוצע וריכוז אצל מלווים.

דוגמה: פירעון 5,000 ₪ למשה באמצעות 5,000 ₪ חדשים מישראל מוצג כך: משה נפרע; נוצר חוב לישראל; פירעון ברוטו 5,000; חוב חדש 5,000; שינוי נטו 0; גלגול 5,000. אין חגיגת "החוב ירד".

## קדימות חובות

1. legal/enforcement risk.
2. urgent creditor demand.
3. effective interest/cost.
4. cash-flow release ויכולת ביצוע.

אין snowball אוטומטי. כל המלצה מציגה חלופה שנייה ואת מחירה. ריבית חסרה מונעת טענת חיסכון מדויקת.

## Stress tests

הרץ לפחות:

- אפס הכנסה עסקית נוספת עד סוף החודש.
- ירידה של 30% בתקבולים העסקיים.
- תקבול `certain` מתעכב 14 יום.
- דרישת חוב פרטית פתאומית.
- הוצאה חיונית בלתי צפויה בגובה רצפת הרזרבה.
- חיוב כרטיס גדול שטרם סווג.

החזר: נקודת שפל, יום כשל, פער, התחייבויות בסיכון ופעולות אפשריות. תחזית אינה הבטחה.

הוצאה גדולה, העברה מהעסק או פירעון נוסף אינם `safe` אם תרחיש שמרני סביר גורם לפגיעה בצורך חיוני, אי־עמידה במינימום, שבירת הרזרבה, הגדלת מינוס, שימוש בכספי מס או צורך צפוי בחוב חדש.

## פלט החלטה מחייב

כל החלטה מחזירה: status (`safe|conditional|not_safe|insufficient_data`), result_minor, funding_gap_minor, breakdown, assumptions, warnings, missing_data, data_quality, stress_test_results, operating_mode, calculation_snapshot_id, calculation_version ו־policy_version. UI ו־AI אינם רשאים להציג result בלי גישה לפירוט ולעדכניות.

## אינווריאנטים

- transfer אינו משנה הון מאוחד.
- סיווג קטגוריה אינו משנה יתרה.
- void אינו נספר.
- splits שווים למקור.
- import כפול אינו מכפיל.
- settlement אינו מכפיל הוצאה.
- safe אינו כולל non-liquid או uncertain.
- תשלום חוב מוריד מזומן וחוב באותו סכום קרן; ריבית נפרדת.
- תשלום שאחריו נוצר חוב גדול יותר אינו “התקדמות”.
- approved draft בלבד משנה truth.
- stale/offline snapshot אינו בסיס להחלטה מחייבת.

## איכות נתונים

ציון 0–100 לפי: עדכניות יתרות, שיעור אישור, התאמות, מזומן לא מסווג, פעולות בלי scope/category/date, חובות בלי יתרה/ריבית/מועד, תקבולים לא ממומשים. אין hard-coded משקל סופי בלי ADR ובדיקות; כל score מציג רכיבים.
