import { maskCheckNumber, normaliseLenderName } from '@family-finance/contracts';
import { checkApproval, proposeCheckMatch } from '@family-finance/local-store';
import { notFound } from 'next/navigation';

import {
  approveBatchAction,
  correctRowAction,
  matchCheckAction,
  rejectBatchAction,
  reverseBatchAction,
  reviewAllAction,
  reviewRowAction,
} from '../../../lib/actions/imports';
import { AppShell } from '../../../components/app-shell';
import {
  ActionForm,
  HiddenValue,
  MoneyField,
  SelectField,
  TextField,
} from '../../../components/form';
import { DueDateLines } from '../../../components/due-date';
import { NoHousehold } from '../../../components/screen';
import {
  Badge,
  Card,
  Disclosure,
  Figure,
  Money,
  Notice,
  SectionTitle,
  StatRow,
} from '../../../components/ui';
import { gemach } from '../../../lib/copy/gemach';
import { screens } from '../../../lib/copy/screens';
import { loadDashboardView } from '../../../lib/dashboard/load';
import { formatBasisPoints, formatBusinessDate, toAmountInput } from '../../../lib/format';

/**
 * The review workspace: what the document said, what we read it as, and what you
 * decide.
 *
 * This screen is the approval boundary made visible. Three things it never does,
 * because doing any of them would make the boundary a formality:
 *
 *  - it never pre-selects rows as included, so the family's silence is not taken
 *    as agreement;
 *  - it never hides the source text behind the parsed value, so "did the bank say
 *    this?" is always answerable in one click;
 *  - it never shows the approve button as available while anything is undecided —
 *    it says what is missing instead.
 *
 * The layout puts the summary first because that is what tells a person whether
 * the right file was uploaded at all, and the per-row work second because most
 * rows need nothing.
 */

export const dynamic = 'force-dynamic';

export default async function ImportReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const view = await loadDashboardView();

  if (view.document === null) {
    return (
      <NoHousehold
        active="/upload"
        title={screens.review.title}
        reason={view.descriptor.reason}
      />
    );
  }

  const { document } = view;
  const batch = document.importBatches.find((candidate) => candidate.id === id);
  if (batch === undefined) notFound();

  const proposals = document.importProposals.filter(
    (proposal) => proposal.batchId === batch.id,
  );
  const check = checkApproval(document, batch.id);
  const currency = document.settings.currency;

  const accounts = document.accounts
    .filter((account) => account.closedAt === null)
    .map((account) => ({ value: account.id, label: account.name }));
  const debts = document.debts
    .filter((debt) => debt.status === 'active')
    .map((debt) => ({ value: debt.id, label: debt.creditorName }));

  const accountName = (accountId: string | null): string =>
    accounts.find((account) => account.value === accountId)?.label ?? screens.common.none;

  /**
   * The lender a proposed debt would collide with, if there is one.
   *
   * Names are compared folded, so "גמ״ח אור החיים" and "גמח אור החיים" are the
   * same lender for the purposes of asking. The answer is a question for the
   * family, never an automatic merge: `checkApproval` blocks the batch until
   * they say which lender the row belongs to.
   */
  const existingLenderFor = (creditorName: string) =>
    document.debts.find(
      (debt) =>
        debt.status !== 'written_off' &&
        normaliseLenderName(debt.creditorName) === normaliseLenderName(creditorName),
    ) ?? null;

  /**
   * The checks a row could be the clearing of.
   *
   * Computed once per row and only for outgoing movements attached to an
   * account: an income row is not a check coming out, and a row with no account
   * has nothing to match against. Returns null when there is nothing to offer,
   * so the block does not appear on the ninety rows that are ordinary shopping.
   */
  const matchFor = (proposal: (typeof proposals)[number]) => {
    const payload = proposal.correction ?? proposal.proposed;
    if (payload.kind !== 'transaction') return null;
    if (payload.value.direction !== 'outflow') return null;
    if (proposal.targetAccountId === null) return null;

    const proposal_ = proposeCheckMatch(document, {
      accountId: proposal.targetAccountId,
      amountMinor: payload.value.amountMinor,
      transactionDate: payload.value.transactionDate,
      reference: payload.value.description,
    });

    return proposal_.candidates.length === 0 ? null : proposal_;
  };

  if (batch.status === 'failed') {
    return (
      <AppShell
        source={view.descriptor}
        active="/upload"
        title={screens.review.title}
        subtitle={batch.file.displayName}
      >
        <Notice tone="danger" title={screens.review.failed}>
          <p>
            {batch.failureCode === null
              ? ''
              : (screens.review.failureCodes[batch.failureCode] ?? '')}
          </p>
          {batch.summary.hasImageOnlyPages ? (
            <p className="mt-2">{screens.upload.scanNote}</p>
          ) : null}
        </Notice>
        <Card title={screens.entry.title}>
          <p className="text-text-secondary">{screens.entry.subtitle}</p>
          <div className="mt-3">
            <a
              href="/entry"
              className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
            >
              {screens.entry.title}
            </a>
          </div>
        </Card>
      </AppShell>
    );
  }

  const decided = batch.status !== 'needs_review';

  return (
    <AppShell
      source={view.descriptor}
      active="/upload"
      title={screens.review.title}
      subtitle={screens.review.subtitle}
      status={
        <Badge
          tone={
            batch.status === 'approved'
              ? 'success'
              : batch.status === 'needs_review'
                ? 'attention'
                : 'neutral'
          }
        >
          {batch.status === 'approved'
            ? screens.review.approved
            : batch.status === 'rejected'
              ? screens.review.rejected
              : batch.status === 'reversed'
                ? screens.review.reversed
                : screens.review.pending}
        </Badge>
      }
    >
      {decided ? null : (
        <Notice tone="attention" title={screens.review.pending}>
          {screens.upload.promise}
        </Notice>
      )}

      <Card title={screens.review.summaryTitle}>
        <StatRow label={screens.review.file} value={batch.file.displayName} />
        <StatRow
          label={screens.review.documentType}
          value={screens.review.documentTypes[batch.documentType] ?? batch.documentType}
          hint={
            batch.documentTypeConfidenceBp < 5_000
              ? (screens.review.warnings['low_confidence_document_type'] ?? undefined)
              : undefined
          }
        />
        {batch.summary.sheetNames.length > 0 ? (
          <StatRow label={screens.review.sheets} value={batch.summary.sheetNames.join(' · ')} />
        ) : null}
        {batch.summary.pageCount === null ? null : (
          <StatRow
            label={screens.review.pages}
            value={<Figure>{batch.summary.pageCount}</Figure>}
          />
        )}
        <StatRow
          label={screens.review.rowsTitle}
          value={screens.review.rowsFound(batch.summary.rowsProposed)}
          hint={screens.review.rowsSkipped(batch.summary.rowsSkipped)}
        />
        {batch.documentType !== 'private_debt_list' ? null : (
          <div className="mt-3">
            <Notice tone="attention" title="הכותרות בקובץ לא אומרות מה יש בעמודות">
              <p>קראנו את העמודות לפי התוכן שלהן. כך הבנו אותן:</p>
              <ul className="mt-2 flex list-inside list-disc flex-col gap-1">
                <li>שם המלווה — העמודה שבה יש שמות</li>
                <li>יתרת החוב — העמודה שבה יש סכומים</li>
                <li>מועד או הערה — העמודה שאחריה</li>
              </ul>
              <p className="mt-2">
                כדאי לעבור שורה־שורה ולוודא. שורות ריקות, שורות סיכום ושורות שהיתרה בהן אפס לא
                הוצעו כחוב — הן מופיעות בקובץ אבל אינן חוב פעיל.
              </p>
            </Notice>
          </div>
        )}
        {batch.summary.dateRangeStart === null || batch.summary.dateRangeEnd === null ? null : (
          <StatRow
            label={screens.review.dateRange(
              batch.summary.dateRangeStart,
              batch.summary.dateRangeEnd,
            )}
            value=""
          />
        )}
        {batch.summary.accountHints.length === 0 ? null : (
          <StatRow
            label={screens.review.accountsFound}
            value={batch.summary.accountHints.join(' · ')}
          />
        )}

        {batch.warnings.length === 0 ? null : (
          <div className="mt-3">
            <Notice tone="attention" title={screens.review.needsAttention}>
              <ul className="flex list-inside list-disc flex-col gap-1">
                {batch.warnings.map((warning) => (
                  <li key={warning}>{screens.review.warnings[warning] ?? warning}</li>
                ))}
              </ul>
            </Notice>
          </div>
        )}
      </Card>

      {decided ? null : (
        <Card title={screens.review.rowsTitle}>
          <div className="flex flex-wrap gap-3">
            <ActionForm
              action={reviewAllAction}
              submitLabel={screens.review.includeAll}
              tone="secondary"
            >
              <>
                <HiddenValue name="batchId" value={batch.id} />
                <HiddenValue name="reviewState" value="included" />
                <HiddenValue name="onlyPending" value="on" />
              </>
            </ActionForm>
            <ActionForm
              action={reviewAllAction}
              submitLabel={screens.review.excludeAll}
              tone="secondary"
            >
              <>
                <HiddenValue name="batchId" value={batch.id} />
                <HiddenValue name="reviewState" value="excluded" />
                <HiddenValue name="onlyPending" value="on" />
              </>
            </ActionForm>
          </div>
        </Card>
      )}

      {proposals.map((proposal) => {
        const payload = proposal.correction ?? proposal.proposed;
        const isTransaction = payload.kind === 'transaction';
        const value = isTransaction ? payload.value : null;

        return (
          <Card
            key={proposal.id}
            title={
              payload.kind === 'debt'
                ? payload.value.creditorName
                : value === null
                  ? (screens.review.columnRole[proposal.kind] ?? proposal.kind)
                  : value.description
            }
            subtitle={screens.review.sourceAt(
              proposal.location.sheetName,
              proposal.location.page,
              proposal.location.row,
            )}
            tone={proposal.reviewState === 'included' ? 'primary' : 'neutral'}
          >
            <div className="mb-3 flex flex-wrap gap-2">
              <Badge
                tone={
                  proposal.reviewState === 'included'
                    ? 'success'
                    : proposal.reviewState === 'excluded'
                      ? 'neutral'
                      : 'attention'
                }
              >
                {screens.review.rowState[proposal.reviewState] ?? proposal.reviewState}
              </Badge>
              {proposal.duplicateVerdict === 'new' ? null : (
                <Badge tone="attention">
                  {proposal.duplicateVerdict === 'likely_duplicate'
                    ? screens.review.duplicateLikely
                    : screens.review.duplicatePossible}
                </Badge>
              )}
              {proposal.correction === null ? null : (
                <Badge tone="primary">{screens.common.fix}</Badge>
              )}
            </div>

            {value === null ? null : (
              <>
                <StatRow
                  label={screens.entry.amount}
                  value={<Money amountMinor={value.amountMinor} currency={currency} />}
                  hint={screens.entry.directions[value.direction]}
                />
                <StatRow
                  label={screens.entry.date}
                  value={formatBusinessDate(value.transactionDate)}
                />
                <StatRow
                  label={screens.entry.account}
                  value={accountName(proposal.targetAccountId)}
                />
              </>
            )}

            {payload.kind !== 'debt' ? null : (
              <>
                <StatRow
                  label="יתרת החוב"
                  value={<Money amountMinor={payload.value.balanceMinor} currency={currency} />}
                  hint="תירשם כ״יתרת פתיחה״ בכרטיס המלווה"
                />
                <StatRow
                  label="תאריך היבוא"
                  value={formatBusinessDate(payload.value.openedOn)}
                />
                {payload.value.dueDate === undefined ? null : (
                  <div className="border-b border-border py-2">
                    <p className="mb-1 text-text-secondary">מועד לתשלום</p>
                    <DueDateLines due={payload.value.dueDate} />
                  </div>
                )}
                {payload.value.note == null ? null : (
                  <StatRow label="הערה מהקובץ" value={payload.value.note} />
                )}
                {existingLenderFor(payload.value.creditorName) === null ? null : (
                  <div className="mt-3">
                    <Notice tone="attention" title="המלווה הזה כבר קיים">
                      כבר יש כרטיס בשם הזה. צריך לומר אם מדובר באותו מלווה — ואז הסכום ייווסף
                      להיסטוריה שלו — או להוציא את השורה. בלי החלטה היבוא לא יאושר.
                    </Notice>
                  </div>
                )}
              </>
            )}

            {proposal.warnings.length === 0 ? null : (
              <ul className="mt-3 flex list-inside list-disc flex-col gap-1 text-small text-attention">
                {proposal.warnings.map((warning) => (
                  <li key={warning}>{screens.review.warnings[warning] ?? warning}</li>
                ))}
              </ul>
            )}

            <Disclosure summary={screens.review.sourceTitle}>
              <dl className="flex flex-col">
                {proposal.raw.map((cell) => (
                  <div
                    key={cell.column}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-border py-1.5 last:border-b-0"
                  >
                    <dt className="text-text-secondary">{cell.column}</dt>
                    <dd>
                      <bdi dir="auto">{cell.text}</bdi>
                    </dd>
                  </div>
                ))}
              </dl>
              {proposal.location.snippet === null ? null : (
                <p className="mt-3 rounded-control bg-surface-muted p-3 text-small text-text-secondary">
                  <bdi dir="auto">{proposal.location.snippet}</bdi>
                </p>
              )}
            </Disclosure>

            {/*
              A bank debit that looks like one of the family's own checks.
              
              Offered, never applied. Two checks that a statement cannot tell
              apart stay ambiguous and both are listed, because the family knows
              which check they wrote and we do not — and choosing for them would
              reduce the wrong month's obligation while looking competent.
            */}
            {matchFor(proposal) === null ? null : (
              <div className="mt-4 rounded-control border border-border bg-surface-muted/50 p-3">
                <p className="font-medium">{gemach.matchTitle}</p>
                <p className="mt-1 text-small text-text-secondary">{gemach.matchIntro}</p>

                {proposal.targetCheckId === null ? null : (
                  <p className="mt-2 text-small font-medium">{gemach.matchChosen}</p>
                )}

                {matchFor(proposal)?.ambiguous === true ? (
                  <p className="mt-2 text-small text-attention">{gemach.matchAmbiguous}</p>
                ) : null}

                <ul className="mt-3 flex flex-col gap-3">
                  {(matchFor(proposal)?.candidates ?? []).map((candidate) => (
                    <li
                      key={candidate.checkId}
                      className="border-t border-border pt-3 first:border-t-0 first:pt-0"
                    >
                      <p>
                        <Money amountMinor={candidate.check.amountMinor} currency={currency} />
                        {' · '}
                        <Figure>{formatBusinessDate(candidate.check.dueDate)}</Figure>
                        {candidate.check.checkNumber === null ? null : (
                          <>
                            {' · '}
                            <Figure>{maskCheckNumber(candidate.check.checkNumber)}</Figure>
                          </>
                        )}
                      </p>
                      <p className="mt-1 text-small text-text-secondary">
                        {gemach.matchConfidence}:{' '}
                        <Figure>{formatBasisPoints(candidate.confidenceBp)}</Figure> ·{' '}
                        {candidate.reasons
                          .map((reason) => gemach.matchReasons[reason] ?? reason)
                          .join(' · ')}
                      </p>
                      {proposal.targetCheckId === candidate.checkId ? (
                        <div className="mt-2">
                          <ActionForm
                            action={matchCheckAction}
                            submitLabel={gemach.matchClear}
                            tone="secondary"
                          >
                            <>
                              <HiddenValue name="proposalId" value={proposal.id} />
                              <HiddenValue name="batchId" value={batch.id} />
                            </>
                          </ActionForm>
                        </div>
                      ) : (
                        <div className="mt-2">
                          <ActionForm
                            action={matchCheckAction}
                            submitLabel={gemach.matchChoose}
                            tone="secondary"
                          >
                            <>
                              <HiddenValue name="proposalId" value={proposal.id} />
                              <HiddenValue name="batchId" value={batch.id} />
                              <HiddenValue name="checkId" value={candidate.checkId} />
                            </>
                          </ActionForm>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {decided ? null : (
              <div className="mt-3 flex flex-wrap gap-3">
                <ActionForm
                  action={reviewRowAction}
                  submitLabel={screens.review.include}
                  tone={proposal.reviewState === 'included' ? 'primary' : 'secondary'}
                >
                  <>
                    <HiddenValue name="proposalId" value={proposal.id} />
                    <HiddenValue name="batchId" value={batch.id} />
                    <HiddenValue name="reviewState" value="included" />
                    {proposal.targetAccountId === null ? null : (
                      <HiddenValue name="targetAccountId" value={proposal.targetAccountId} />
                    )}
                    {proposal.targetCheckId === null ? null : (
                      <HiddenValue name="checkId" value={proposal.targetCheckId} />
                    )}
                  </>
                </ActionForm>
                <ActionForm
                  action={reviewRowAction}
                  submitLabel={screens.review.exclude}
                  tone="secondary"
                >
                  <>
                    <HiddenValue name="proposalId" value={proposal.id} />
                    <HiddenValue name="batchId" value={batch.id} />
                    <HiddenValue name="reviewState" value="excluded" />
                  </>
                </ActionForm>
              </div>
            )}

            {decided || value === null ? null : (
              <Disclosure summary={screens.review.editTitle} tone="action">
                <ActionForm action={correctRowAction} submitLabel={screens.entry.save}>
                  <>
                    <HiddenValue name="proposalId" value={proposal.id} />
                    <HiddenValue name="batchId" value={batch.id} />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <MoneyField
                        name="amountMinor"
                        label={screens.entry.amount}
                        defaultValue={toAmountInput(value.amountMinor)}
                      />
                      <TextField
                        name="transactionDate"
                        label={screens.entry.date}
                        type="date"
                        defaultValue={value.transactionDate}
                      />
                    </div>
                    <TextField
                      name="description"
                      label={screens.entry.merchant}
                      defaultValue={value.description}
                      maxLength={300}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <SelectField
                        name="direction"
                        label={screens.entry.direction}
                        defaultValue={value.direction}
                        options={[
                          {
                            value: 'outflow',
                            label: screens.entry.directions['outflow'] ?? '',
                          },
                          { value: 'inflow', label: screens.entry.directions['inflow'] ?? '' },
                        ]}
                      />
                      <SelectField
                        name="categoryKey"
                        label={screens.entry.category}
                        required={false}
                        emptyLabel={screens.entry.categoryNone}
                        defaultValue={value.categoryKey ?? ''}
                        options={[
                          { value: 'food', label: 'מזון' },
                          { value: 'housing_and_bills', label: 'דיור וחשבונות' },
                          { value: 'transport_and_fuel', label: 'תחבורה ודלק' },
                          { value: 'health', label: 'בריאות' },
                          { value: 'education', label: 'חינוך' },
                          { value: 'clothing', label: 'ביגוד' },
                          { value: 'celebrations_and_gifts', label: 'שמחות ומתנות' },
                          { value: 'cash_and_small', label: 'מזומן והוצאות קטנות' },
                          { value: 'holidays', label: 'חגים' },
                          { value: 'other', label: 'שונות' },
                        ]}
                      />
                    </div>
                  </>
                </ActionForm>
              </Disclosure>
            )}

            {decided || accounts.length === 0 ? null : (
              <Disclosure summary={screens.entry.account}>
                <ActionForm action={reviewRowAction} submitLabel={screens.entry.save}>
                  <>
                    <HiddenValue name="proposalId" value={proposal.id} />
                    <HiddenValue name="batchId" value={batch.id} />
                    <SelectField
                      name="targetAccountId"
                      label={screens.entry.account}
                      defaultValue={proposal.targetAccountId ?? ''}
                      emptyLabel={screens.common.none}
                      required={false}
                      options={accounts}
                    />
                    {(payload.kind === 'debt_payment' || payload.kind === 'debt') &&
                    debts.length > 0 ? (
                      <SelectField
                        name="targetDebtId"
                        label={
                          payload.kind === 'debt'
                            ? 'מלווה שכבר קיים (להשאיר ריק אם זה מלווה חדש)'
                            : screens.entry.debtTitle
                        }
                        defaultValue={proposal.targetDebtId ?? ''}
                        emptyLabel={screens.common.none}
                        required={false}
                        options={debts}
                      />
                    ) : null}
                  </>
                </ActionForm>
              </Disclosure>
            )}
          </Card>
        );
      })}

      {decided ? null : (
        <>
          <SectionTitle>{screens.review.approveTitle}</SectionTitle>
          <Card tone={check.canApprove ? 'primary' : 'attention'}>
            {check.canApprove ? (
              <p className="text-text-secondary">
                {screens.review.approveExplain(check.includedCount)}
              </p>
            ) : (
              <>
                <p className="font-medium text-attention">{screens.review.approveBlocked}</p>
                <ul className="mt-2 flex list-inside list-disc flex-col gap-1 text-text-secondary">
                  {check.pendingCount > 0 ? (
                    <li>{screens.review.approvePending(check.pendingCount)}</li>
                  ) : null}
                  {check.includedCount === 0 ? (
                    <li>{screens.review.approveNoneIncluded}</li>
                  ) : null}
                  {check.blocking.length > 0 ? (
                    <li>{screens.review.approveNeedsAccount}</li>
                  ) : null}
                </ul>
              </>
            )}

            {check.duplicateIncludedCount > 0 ? (
              <div className="mt-3">
                <Notice tone="attention" title={screens.review.duplicates}>
                  {screens.approvals.rows(check.duplicateIncludedCount)}
                </Notice>
              </div>
            ) : null}

            {check.canApprove ? (
              <div className="mt-4">
                <ActionForm action={approveBatchAction} submitLabel={screens.review.approve}>
                  <HiddenValue name="batchId" value={batch.id} />
                </ActionForm>
              </div>
            ) : null}

            <Disclosure summary={screens.review.reject}>
              <p className="mb-3 text-small text-text-secondary">{screens.review.rejectHint}</p>
              <ActionForm
                action={rejectBatchAction}
                submitLabel={screens.review.reject}
                tone="danger"
              >
                <HiddenValue name="batchId" value={batch.id} />
              </ActionForm>
            </Disclosure>
          </Card>
        </>
      )}

      {batch.status !== 'approved' ? null : (
        <Card title={screens.review.resultTitle} tone="success">
          <p className="text-text-secondary">
            {screens.review.resultCreated(
              document.transactions.filter(
                (transaction) => transaction.importBatchId === batch.id,
              ).length,
            )}
          </p>
          <p className="mt-2 text-small text-text-secondary">{screens.review.fileDeleted}</p>

          <Disclosure summary={screens.review.reverse}>
            <p className="mb-3 text-small text-text-secondary">{screens.review.reverseHint}</p>
            <ActionForm
              action={reverseBatchAction}
              submitLabel={screens.review.reverse}
              tone="danger"
            >
              <>
                <HiddenValue name="batchId" value={batch.id} />
                <TextField name="reason" label={screens.review.reverseReason} maxLength={300} />
              </>
            </ActionForm>
          </Disclosure>
        </Card>
      )}

      {batch.status !== 'reversed' ? null : (
        <Notice tone="neutral" title={screens.review.reversed}>
          {screens.review.reverseHint}
        </Notice>
      )}
    </AppShell>
  );
}
