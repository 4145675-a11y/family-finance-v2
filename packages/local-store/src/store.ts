import {
  buildFinancialSnapshot,
  calculateBudget,
  calculateFoodWeek,
  type BudgetResult,
  type EngineInput,
  type FinancialSnapshot,
  type FoodWeekGuidance,
} from '@family-finance/finance-engine';

import { emptyDocument, type StoreDocument } from './document';
import { FileStore } from './file-store';
import type { StorePaths } from './paths';
import {
  periodEndFor,
  periodStartFor,
  toBudgetInput,
  toEngineInput,
  toFoodWeekInput,
} from './projection';
import type { CommandContext, CommandResult } from './commands';

/**
 * The one door between the application and the household's data.
 *
 * Screens read a `HouseholdView` and never a document. That is not a style
 * preference: a screen that could reach into the raw records would eventually add
 * two of them together, and then the dashboard and the engine would disagree about
 * what "safe" means. Everything numeric a screen shows comes from the engine
 * snapshot this builds.
 *
 * Writes go through `run`, which takes one of the pure commands, applies it inside
 * the file store's queue and writes the result atomically. A command that throws
 * leaves the stored document exactly as it was.
 */

export interface HouseholdView {
  readonly document: StoreDocument;
  readonly input: EngineInput;
  readonly snapshot: FinancialSnapshot;
  readonly budget: BudgetResult | null;
  readonly food: FoodWeekGuidance | null;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly asOf: string;
}

/**
 * A check that runs before the household's truth is read or written.
 *
 * The store does not know what a passkey is and must not: it is given a
 * function that throws when the application is locked, and calls it at every
 * door. Keeping the policy outside and the enforcement inside is what stops a
 * screen added next month from quietly reading a balance without one.
 */
export type StoreGuard = () => Promise<void>;

export interface CreateHouseholdInput {
  readonly householdName: string;
  readonly profileName: string;
  readonly currency?: string;
  readonly timeZone?: string;
}

export class HouseholdStore {
  /** Which backend stands behind the door. The file, here. */
  readonly backend = 'local_json' as const;

  private readonly files: FileStore;
  private readonly guard: StoreGuard | null;

  constructor(paths: StorePaths, guard: StoreGuard | null = null) {
    this.files = new FileStore(paths);
    this.guard = guard;
  }

  /**
   * Refuses the operation when the application is locked.
   *
   * Called first in every method that touches the household's records. Creating
   * the household and asking whether one exists are exempt: there is nothing to
   * protect before there is a household, and refusing to say whether a file
   * exists would only mean a first-run screen that cannot decide what to show.
   */
  private async allow(): Promise<void> {
    if (this.guard !== null) await this.guard();
  }

  get paths(): StorePaths {
    return this.files.paths;
  }

  get store(): FileStore {
    return this.files;
  }

  async exists(): Promise<boolean> {
    return this.files.initialised();
  }

  /** Creates the household. The only operation that works before setup. */
  async create(input: CreateHouseholdInput, now = new Date().toISOString()): Promise<string> {
    const householdId = crypto.randomUUID();
    const profileId = crypto.randomUUID();

    const document = emptyDocument({
      householdId,
      householdName: input.householdName.trim(),
      profileId,
      profileName: input.profileName.trim(),
      now,
      currency: input.currency ?? 'ILS',
      timeZone: input.timeZone ?? 'Asia/Jerusalem',
    });

    await this.files.create(document);
    return householdId;
  }

  async readDocument(): Promise<StoreDocument> {
    await this.allow();
    const snapshot = await this.files.read();
    return snapshot.document;
  }

  async readDocumentOrNull(): Promise<StoreDocument | null> {
    await this.allow();
    const snapshot = await this.files.readOrNull();
    return snapshot?.document ?? null;
  }

  /**
   * Everything a screen needs, computed once.
   *
   * `asOf` is passed in rather than read inside the engine so that the same
   * picture can be reproduced later from the same facts — the property the audit
   * trail depends on.
   */
  async view(asOf = new Date().toISOString()): Promise<HouseholdView | null> {
    await this.allow();
    const document = await this.readDocumentOrNull();
    if (document === null) return null;
    return viewOf(document, asOf);
  }

  /** The identity every command is attributed to: the household's first profile. */
  async context(now = new Date().toISOString()): Promise<CommandContext> {
    await this.allow();
    const document = await this.readDocument();
    const profile = document.profiles[0];
    if (profile === undefined) {
      throw new Error('the household has no profile to attribute changes to');
    }
    return { actorProfileId: profile.id, now };
  }

  /**
   * Applies a command.
   *
   * The command is a pure function of the document, so it sees a consistent
   * picture and its result is validated before anything is written. A failure
   * throws before the write, which is what makes an approval all-or-nothing.
   */
  async run<T>(
    command: (document: StoreDocument, context: CommandContext) => CommandResult<T>,
    options: {
      readonly now?: string;
      readonly expectedRevision?: string;
      readonly report?: (outcome: { readonly alreadyRecorded: boolean }) => void;
    } = {},
  ): Promise<T> {
    await this.allow();
    const now = options.now ?? new Date().toISOString();

    const { result } = await this.files.mutate<T>(
      (document) => {
        const profile = document.profiles[0];
        if (profile === undefined) {
          throw new Error('the household has no profile to attribute changes to');
        }
        const outcome = command(document, { actorProfileId: profile.id, now });
        options.report?.({ alreadyRecorded: outcome.alreadyRecorded === true });
        return { document: outcome.document, result: outcome.value };
      },
      options.expectedRevision === undefined
        ? {}
        : { expectedRevision: options.expectedRevision },
    );

    return result;
  }

  /** Replaces everything. Restore only. */
  async replaceDocument(document: StoreDocument): Promise<void> {
    await this.allow();
    await this.files.replace(document);
  }
}

/** Builds the view from a document. Exported so tests can use it without a disk. */
export function viewOf(document: StoreDocument, asOf: string): HouseholdView {
  const input = toEngineInput(document, { asOf });
  const budgetInput = toBudgetInput(document, { asOf });
  const foodInput = toFoodWeekInput(document, { asOf });
  const today = asOf.slice(0, 10);

  return {
    document,
    input,
    snapshot: buildFinancialSnapshot(input),
    budget: budgetInput === null ? null : calculateBudget(budgetInput),
    food: foodInput === null ? null : calculateFoodWeek(foodInput),
    periodStart: periodStartFor(document, today),
    periodEnd: periodEndFor(document, today),
    asOf,
  };
}
