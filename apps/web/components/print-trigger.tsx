'use client';

/**
 * The print button on the printable report.
 *
 * `print:hidden` keeps it out of the printed page, so the PDF a family saves has
 * no stray button in the corner. It does not open the dialogue automatically:
 * a page that starts printing the moment it loads is startling, and a person may
 * have opened it just to read.
 */
export function PrintTrigger({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-11 w-fit items-center justify-center rounded-control border border-border-interactive bg-surface px-4 py-2 font-medium print:hidden"
    >
      {label}
    </button>
  );
}
