-- Write the due-date columns a debt now carries.
--
-- ADR-0035 added ten `due_date*` columns to `public.debts`, but the function
-- that writes debts lists its columns explicitly and was written before they
-- existed. A due date therefore reached the database and was dropped on the way
-- in, without an error — the family would have been told their date was saved
-- and found it gone.
--
-- Composed rather than restated, for the reason ADR-0037 gives: the five hundred
-- lines of `apply_household_changes` have been exercised against a real
-- database, and the last time one of its functions was restated to add a key, a
-- transcription slip emptied `importSourceFiles` and stopped every household
-- loading. So this adds a second, small function and calls it from the same
-- entry point, inside the same transaction.
--
-- Additive only. No column is dropped, no row is rewritten, and the statement is
-- safe to run twice.

create or replace function app.apply_debt_due_dates(
  p_household_id uuid,
  p_changes jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_changes ? 'debts' then
    /*
     * Only the rows that actually carry the key are touched. A change set built
     * from a debt that has never had a due date does not mention these columns
     * at all, and such a row must keep whatever it already had rather than be
     * blanked by an absent value.
     */
    update public.debts d set
      due_date                    = (r.value ->> 'due_date')::date,
      due_date_hebrew_year        = (r.value ->> 'due_date_hebrew_year')::integer,
      due_date_hebrew_month       = (r.value ->> 'due_date_hebrew_month')::integer,
      due_date_hebrew_day         = (r.value ->> 'due_date_hebrew_day')::integer,
      due_date_is_hebrew          = coalesce((r.value ->> 'due_date_is_hebrew')::boolean, false),
      due_date_source_text        = r.value ->> 'due_date_source_text',
      due_date_review_reason      = r.value ->> 'due_date_review_reason',
      due_date_recurs_annually    = coalesce((r.value ->> 'due_date_recurs_annually')::boolean, false),
      due_date_adar_choice        = r.value ->> 'due_date_adar_choice',
      due_date_missing_day_choice = r.value ->> 'due_date_missing_day_choice'
    from jsonb_array_elements(coalesce(p_changes -> 'debts' -> 'upsert', '[]'::jsonb)) as r(value)
    where d.household_id = p_household_id
      and d.id = (r.value ->> 'id')::uuid
      and r.value ? 'due_date';
  end if;
end
$$;

revoke all on function app.apply_debt_due_dates(uuid, jsonb) from public, anon;
grant execute on function app.apply_debt_due_dates(uuid, jsonb) to authenticated;

-- The entry point, now composing three: the records, this household's rules, and
-- the due dates a debt carries. One statement, therefore one transaction: the
-- version check inside `apply_household_changes` raises on a conflict and rolls
-- all of it back together.
create or replace function public.apply_household_document(
  p_household_id uuid,
  p_expected_version integer,
  p_changes jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  v_result := public.apply_household_changes(p_household_id, p_expected_version, p_changes);
  perform app.apply_learned_rule_changes(p_household_id, p_changes);
  perform app.apply_debt_due_dates(p_household_id, p_changes);
  return v_result;
end
$$;

comment on function public.apply_household_document(uuid, integer, jsonb) is
  'Applies a document change set: records, household classification rules, and '
  'the due-date columns a debt carries. One transaction.';

revoke all on function public.apply_household_document(uuid, integer, jsonb) from public, anon;
grant execute on function public.apply_household_document(uuid, integer, jsonb) to authenticated;
