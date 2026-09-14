/**
 * What the engine says, without saying it in any particular language.
 *
 * Until now the engine returned finished Hebrew sentences. That put product
 * wording inside the deterministic core, where it could not be reviewed as copy,
 * could not be tested for tone, and quietly made the domain layer responsible for
 * how a family is spoken to.
 *
 * A notice is a stable machine code plus the numbers that belong in the sentence.
 * The engine decides *what is true*; `apps/web/lib/copy` decides *how to say it*.
 * The code is part of the engine's contract — renaming one is a breaking change,
 * exactly like renaming a field.
 */

/** Values a sentence may interpolate. Money stays in minor units. */
export type NoticeParams = Readonly<Record<string, number | string>>;

export interface EngineNotice {
  readonly code: string;
  readonly params?: NoticeParams;
}

export function notice(code: string, params?: NoticeParams): EngineNotice {
  return params === undefined ? { code } : { code, params };
}
