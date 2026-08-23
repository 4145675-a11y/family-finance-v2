/**
 * `FIN-MODE-001` — the six operating modes.
 *
 * The product does not give the same advice in every situation. A household that
 * cannot cover an essential need within a fortnight needs a different answer from
 * one that is choosing between two loans, and 02-FINANCIAL-RULES.md § מצבי
 * ההתנהלות makes that explicit.
 *
 * Every transition here is a measurable condition on numbers the engine already
 * produced. Nothing is a judgement call, nothing is a mood, and the reasons that
 * selected the mode are returned so the user can be told why.
 */

export const OPERATING_MODES = [
  'emergency',
  'stabilization',
  'stop_new_debt',
  'repayment',
  'buffer_building',
  'growth',
] as const;

export type OperatingMode = (typeof OPERATING_MODES)[number];

export interface ModeInputs {
  /** Shortfall against obligations falling due within the next 14 days. */
  readonly fundingGapWithin14DaysMinor: number;
  /** Lowest projected balance between today and the end of the period. */
  readonly lowPointMinor: number;
  readonly reserveFloorMinor: number;
  readonly liquidCashMinor: number;
  readonly allMinimumsCovered: boolean;
  /** An essential bill or a legally enforceable debt already in arrears. */
  readonly hasEssentialOrLegalArrears: boolean;
  /** Projected end-of-period balance under the conservative scenario. */
  readonly conservativeForecastEndMinor: number;
  readonly stressTestsPassed: boolean;
  readonly netConsumerDebtChangeMinor: number;
  readonly newDebtOriginatedMinor: number;
  /** Consumer debt outstanding now. Zero is what separates growth from repayment. */
  readonly consumerDebtMinor: number;
}

export interface ModeAssessment {
  readonly mode: OperatingMode;
  /** Why this mode and not a milder one. */
  readonly reasons: readonly string[];
  /** Conditions that would force a stricter mode if they became true. */
  readonly watchList: readonly string[];
}

/**
 * Selects the operating mode.
 *
 * Evaluated strictest first. A single severe trigger returns the household to a
 * stricter mode automatically, which is the behaviour § מצבי ההתנהלות requires:
 * "הופעת trigger חמור מחזירה אוטומטית למצב מחמיר ומתועדת".
 */
export function determineOperatingMode(inputs: ModeInputs): ModeAssessment {
  const reasons: string[] = [];

  // 1. emergency
  if (inputs.fundingGapWithin14DaysMinor > 0) {
    reasons.push('אין כיסוי לחיוב מחייב בתוך 14 יום.');
  }
  if (inputs.lowPointMinor < 0) {
    reasons.push('נקודת השפל הצפויה שלילית — צפויה חריגה.');
  }
  if (inputs.hasEssentialOrLegalArrears) {
    reasons.push('קיים פיגור בצורך חיוני או בחוב עם סיכון משפטי.');
  }
  if (!inputs.allMinimumsCovered) {
    reasons.push('לא כל תשלומי המינימום לחובות מכוסים.');
  }
  if (reasons.length > 0) {
    return {
      mode: 'emergency',
      reasons,
      watchList: ['סגירת הפער המיידי היא התנאי היחיד ליציאה ממצב חירום.'],
    };
  }

  // 2. stabilization — nothing is failing now, but there is no cushion.
  if (inputs.liquidCashMinor < inputs.reserveFloorMinor) {
    return {
      mode: 'stabilization',
      reasons: ['אין כשל מיידי, אך המזומן הנזיל נמוך מרצפת הרזרבה.'],
      watchList: [
        'ירידה של נקודת השפל מתחת לאפס מחזירה למצב חירום.',
        'חוב חדש בתקופה הנוכחית מרחיק את היציבות.',
      ],
    };
  }

  // 3. stop_new_debt — the reserve exists but the month still creates debt.
  if (inputs.newDebtOriginatedMinor > 0 || inputs.netConsumerDebtChangeMinor > 0) {
    return {
      mode: 'stop_new_debt',
      reasons: ['הרזרבה קיימת, אך בתקופה הנוכחית נוצר חוב חדש או שהחוב הצרכני גדל.'],
      watchList: ['חודש שמסתיים ללא חוב חדש מאפשר מעבר למצב פירעון.'],
    };
  }

  // 4. repayment — every condition in § מצבי ההתנהלות must hold at once.
  const repaymentBlockers: string[] = [];
  if (inputs.conservativeForecastEndMinor < 0) {
    repaymentBlockers.push('התחזית השמרנית מסתיימת בשלילי.');
  }
  if (!inputs.stressTestsPassed) {
    repaymentBlockers.push('לפחות תרחיש לחץ בסיסי אחד אינו עובר.');
  }

  if (repaymentBlockers.length > 0) {
    return {
      mode: 'stop_new_debt',
      reasons: [
        'הרזרבה קיימת ואין חוב חדש, אך עדיין אין תנאים לפירעון מואץ.',
        ...repaymentBlockers,
      ],
      watchList: ['תחזית שמרנית חיובית ותרחישי לחץ עוברים פותחים את מצב הפירעון.'],
    };
  }

  const bufferAboveFloorMinor = inputs.liquidCashMinor - inputs.reserveFloorMinor;

  // 6. growth — long-term goals, and only after stability is real: no consumer
  // debt left and a cushion of at least three times the floor.
  if (inputs.consumerDebtMinor === 0 && bufferAboveFloorMinor >= inputs.reserveFloorMinor * 2) {
    return {
      mode: 'growth',
      reasons: ['אין חוב צרכני והכרית עומדת על שלושה מונים מרצפת הרזרבה.'],
      watchList: ['חוב צרכני חדש מחזיר מיד למצב עצירת חוב חדש.'],
    };
  }

  // 5. buffer_building — debt is falling and the cushion is above its floor.
  if (
    inputs.netConsumerDebtChangeMinor < 0 &&
    bufferAboveFloorMinor >= inputs.reserveFloorMinor
  ) {
    return {
      mode: 'buffer_building',
      reasons: ['החוב הצרכני יורד נטו והכרית גדולה מכפליים הרצפה.'],
      watchList: ['עלייה בחוב הצרכני מחזירה למצב עצירת חוב חדש.'],
    };
  }

  return {
    mode: 'repayment',
    reasons: [
      'אין פיגור, כל המינימום מכוסה, קיימת רזרבה, התחזית השמרנית אינה שלילית ותרחישי הלחץ עוברים.',
    ],
    watchList: [
      'ירידת המזומן מתחת לרצפת הרזרבה מחזירה למצב ייצוב.',
      'חוב חדש מחזיר למצב עצירת חוב חדש.',
    ],
  };
}

/**
 * Whether a mode permits recommending discretionary spending.
 *
 * § מצבי ההתנהלות stops recommendations for non-essential spending, goal saving
 * and accelerated repayment while in emergency.
 */
export function allowsDiscretionaryRecommendations(mode: OperatingMode): boolean {
  return mode !== 'emergency';
}
