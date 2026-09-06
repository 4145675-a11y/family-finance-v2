'use server';

import {
  addAccount,
  addBusiness,
  addMember,
  declareNoBusiness,
  renameHousehold,
  updateSettings,
} from '@family-finance/local-store';
import { revalidatePath } from 'next/cache';

import { FieldReader, failed, succeeded, type FormState } from '../forms';
import { householdStore } from '../store/server';
import { describe, refreshMoneyScreens } from './errors';

/**
 * Setting the household up, and changing the few decisions that shape every
 * number after it.
 *
 * Each action validates, applies one command, and revalidates the paths whose
 * figures could have moved. `revalidatePath` is not decoration: without it a
 * family adds an account and the home screen keeps showing the old picture, which
 * is exactly the kind of quiet staleness this product exists to avoid.
 */

export async function createHouseholdAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const householdName = reader.text('householdName', 'שם משק הבית', { max: 120 });
  const profileName = reader.text('profileName', 'השם שלכם', { max: 80 });

  if (!reader.ok) return failed('בואו נשלים כמה פרטים.', reader.errors);

  const store = householdStore();
  if (await store.exists()) {
    return failed('כבר קיים כאן משק בית. אפשר להמשיך משם.');
  }

  try {
    await store.create({ householdName, profileName });
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  revalidatePath('/setup');
  return succeeded('משק הבית נוצר. אפשר להמשיך ולהוסיף חשבונות.');
}

export async function renameHouseholdAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const name = reader.text('name', 'שם משק הבית', { max: 120 });
  if (!reader.ok) return failed('בואו נשלים כמה פרטים.', reader.errors);

  try {
    await householdStore().run((document, context) =>
      renameHousehold(document, { name }, context),
    );
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  revalidatePath('/setup');
  return succeeded('השם עודכן.');
}

export async function addMemberAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const displayName = reader.text('displayName', 'שם', { max: 80 });
  if (!reader.ok) return failed('בואו נשלים כמה פרטים.', reader.errors);

  try {
    await householdStore().run((document, context) =>
      addMember(document, { displayName }, context),
    );
  } catch (error) {
    return describe(error);
  }

  revalidatePath('/setup');
  revalidatePath('/tasks');
  return succeeded(`${displayName} נוספ/ה למשק הבית.`);
}

export async function updateSettingsAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const monthStartDay = reader.integer('monthStartDay', 'היום שבו מתחיל החודש', {
    min: 1,
    max: 28,
  });
  const manualReserveFloorMinor = reader.optionalMoney(
    'manualReserveFloorMinor',
    'סכום שמשאירים בצד',
  );
  const incidentBufferMinor = reader.optionalMoney('incidentBufferMinor', 'כרית לתקלה');
  const revolvingAvoidanceMinor = reader.optionalMoney(
    'revolvingAvoidanceMinor',
    'סכום שמונע חזרה למינוס',
  );
  const protectedReservesMinor = reader.optionalMoney(
    'protectedReservesMinor',
    'כסף ששמור למטרה אחרת',
  );

  if (!reader.ok) return failed('בואו נבדוק את הסכומים.', reader.errors);

  try {
    await householdStore().run((document, context) =>
      updateSettings(
        document,
        {
          ...(monthStartDay === null ? {} : { monthStartDay }),
          manualReserveFloorMinor,
          incidentBufferMinor,
          revolvingAvoidanceMinor,
          ...(protectedReservesMinor === null ? {} : { protectedReservesMinor }),
          weeklyFoodGuidance: reader.boolean('weeklyFoodGuidance'),
          balanceFreshnessReminder: reader.boolean('balanceFreshnessReminder'),
        },
        context,
      ),
    );
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  revalidatePath('/settings');
  return succeeded('ההגדרות נשמרו.');
}

export async function acknowledgePrivacyAction(): Promise<void> {
  await householdStore().run((document, context) =>
    updateSettings(document, { privacyExplained: true }, context),
  );
  revalidatePath('/setup');
}

export async function addBusinessAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const name = reader.text('name', 'שם העסק', { max: 120 });
  const taxReserveRateBp = reader.percentBp('taxReserveRatePercent', 'אחוז לשמירה למסים');
  const operatingReserveMinor = reader.optionalMoney(
    'operatingReserveMinor',
    'כמה העסק חייב להשאיר אצלו',
  );

  if (!reader.ok) return failed('בואו נשלים כמה פרטים.', reader.errors);

  try {
    await householdStore().run((document, context) =>
      addBusiness(
        document,
        {
          name,
          taxReserveRateBp: taxReserveRateBp ?? 2_500,
          operatingReserveMinor: operatingReserveMinor ?? 0,
        },
        context,
      ),
    );
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  revalidatePath('/setup');
  return succeeded('העסק נוסף. אפשר להוסיף לו חשבון.');
}

export async function declareNoBusinessAction(): Promise<void> {
  await householdStore().run((document, context) => declareNoBusiness(document, context));
  refreshMoneyScreens();
  revalidatePath('/setup');
}

export async function addAccountAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const name = reader.text('name', 'שם החשבון', { max: 120 });
  const kind = reader.choice(
    'kind',
    'סוג',
    ['bank_account', 'credit_card', 'cash_wallet', 'other'] as const,
    'bank_account',
  );
  const scope = reader.choice(
    'scope',
    'שייך ל',
    ['household', 'business'] as const,
    'household',
  );
  const institution = reader.optionalText('institution', 'בנק או חברה', 120);
  const suffix = reader.optionalText('displaySuffix', 'ארבע ספרות אחרונות', 4);
  const openingBalanceMinor = reader.money('openingBalanceMinor', 'היתרה כרגע', {
    allowZero: true,
  });
  const direction = reader.choice(
    'openingBalanceDirection',
    'האם זה כסף שיש או כסף שחייבים',
    ['inflow', 'outflow'] as const,
    'inflow',
  );
  const openingBalanceDate = reader.date('openingBalanceDate', 'נכון לתאריך');

  if (suffix !== null && !/^[0-9]{4}$/.test(suffix)) {
    reader.problem('displaySuffix', 'ארבע ספרות אחרונות — בדיוק ארבע ספרות, או להשאיר ריק');
  }

  if (!reader.ok) return failed('בואו נשלים כמה פרטים.', reader.errors);

  try {
    const id = await householdStore().run((document, context) =>
      addAccount(
        document,
        {
          name,
          kind,
          scope,
          institution,
          displaySuffix: suffix,
          openingBalanceMinor,
          openingBalanceDirection: direction,
          openingBalanceDate,
        },
        context,
      ),
    );
    refreshMoneyScreens();
    revalidatePath('/setup');
    return succeeded(`${name} נוסף.`, id);
  } catch (error) {
    return describe(error);
  }
}
