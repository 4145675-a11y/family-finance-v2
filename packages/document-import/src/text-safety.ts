/**
 * Removing characters that are not text.
 *
 * A control character in a file name or in a spreadsheet cell is either an
 * accident or an attack — a NUL that truncates a path, a carriage return that
 * splits a log line into two, an escape sequence that moves a terminal cursor.
 * None of them belongs in a value this product displays or stores.
 *
 * Done by code point rather than by a regular expression, deliberately. A regex
 * over the control range needs `no-control-regex` suppressed, and CLAUDE.md
 * treats a disabled lint rule as a forbidden artifact — correctly, because a
 * suppression is a rule turned off in the one place somebody was in a hurry. A
 * loop needs no exception, and reads more plainly than the escape ranges did.
 */

/** Tab, line feed and carriage return are text; the rest of C0 and C1 are not. */
function isControl(code: number): boolean {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return false;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

/** Drops every control character, keeping tabs and newlines. */
export function stripControlCharacters(text: string): string {
  let out = '';
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (!isControl(code)) out += character;
  }
  return out;
}

/**
 * Drops every character XML 1.0 cannot carry.
 *
 * Stricter than the above: XML forbids tab-adjacent controls too, and a document
 * containing one is rejected by every reader rather than displayed oddly. An
 * export that a spreadsheet refuses to open is worse than one missing a byte
 * nobody could see.
 */
export function stripXmlForbiddenCharacters(text: string): string {
  let out = '';
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const legal =
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0d ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff);
    if (legal) out += character;
  }
  return out;
}
