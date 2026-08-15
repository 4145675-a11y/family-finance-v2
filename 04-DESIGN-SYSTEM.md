# DESIGN SYSTEM

## אופי

פשוט, משפחתי, רגוע ואמין; לא בנק קר, לא משחק ילדותי ולא הנהלת חשבונות עמוסה. Light theme ב־v1; dark theme מחוץ לתכולה.

## Tokens ראשוניים

יש לאמת ניגודיות לפני נעילה:

- background: `#F7F8F5`
- surface: `#FFFFFF`
- text-primary: `#18302B`
- text-secondary: `#5E706C`
- primary: `#285E61`
- primary-hover: `#204E50`
- success: `#2F7D62`
- attention: `#A66A16`
- danger: `#B43A3A`
- border: `#DDE5E1`
- focus: `#2B6CB0`

Spacing scale: 4, 8, 12, 16, 24, 32, 48. Radius: 8 controls, 14 cards, 18 hero. Shadow עדין בלבד. Motion 120–200ms; כבה לפי prefers-reduced-motion.

Typography: Assistant preferred, Heebo fallback, system sans. Body 16px/1.55; small 14; headings 20/24/32 לפי היררכיה. מספרים עם `dir=ltr` נקודתי בתוך RTL ובידוד bidi נכון; מטבע/סימן לא מתהפכים.

## Components

- AppShell, BottomNav, Sidebar.
- MoneyHero עם safe/conditional/unavailable.
- FreshnessBadge, ConfidenceIndicator.
- AccountCard, DebtCard, BusinessCard, ForecastCard.
- ProgressBar עם טקסט חלופי.
- Alert: info/attention/danger; danger רק לנזק מיידי.
- FormField, AmountInput, DateInput, CategoryPicker.
- BottomSheet, Dialog, Toast, InlineError.
- ApprovalCard ו־BatchToolbar.
- DataTable בדסקטופ ו־CardList במובייל.
- Skeleton מותאם למבנה, לא spinner יחיד.

כל component כולל default, hover, focus, disabled, loading, error, stale ו־selected לפי העניין. touch target מינימום 44×44. פעולה ראשית אחת במסך. icon לעולם אינו הסבר יחיד.

לפני הרחבת UI: לאשר snapshots של Home, Approval Inbox ו־Onboarding ב־390/768/1280. אין להפיץ שפה עיצובית לא מאושרת לכל המוצר.

