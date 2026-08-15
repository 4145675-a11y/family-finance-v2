/**
 * Foundation shell.
 *
 * Milestone 1 delivers the buildable repository and the Hebrew RTL shell — nothing more.
 * There is deliberately no dashboard, no onboarding and no number here: 09-MILESTONES.md
 * places every financial surface in later milestones, and CLAUDE.md forbids showing a
 * placeholder as though it were a working capability.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-6 px-4 py-12">
      <header className="flex flex-col gap-3">
        <h1 className="text-[32px] leading-tight font-bold text-text-primary">
          מרכז השליטה הכלכלי המשפחתי
        </h1>
        <p className="text-text-secondary">
          בסיס הפרויקט הוקם. עדיין אין כאן נתונים פיננסיים, מסכים או חישובים — הם ייבנו בשלבים
          הבאים.
        </p>
      </header>

      <section
        aria-labelledby="shell-check-heading"
        className="rounded-card border border-border bg-surface p-6"
      >
        <h2 id="shell-check-heading" className="mb-3 text-[20px] font-semibold">
          בדיקת מעטפת
        </h2>
        <dl className="flex flex-col gap-2 text-small">
          <div className="flex flex-wrap gap-2">
            <dt className="text-text-secondary">כיוון המסמך:</dt>
            <dd>עברית מימין לשמאל</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="text-text-secondary">רוחבי יעד:</dt>
            {/* Digits inside Hebrew text need their own direction so the sequence
                does not reorder. This is the bidi isolation case from 04-DESIGN-SYSTEM.md. */}
            <dd dir="ltr">360 · 390 · 768 · 1280</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
