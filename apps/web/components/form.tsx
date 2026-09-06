'use client';

import { createContext, useActionState, useContext, useId, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

import { idleForm, type FormState } from '../lib/forms';
import { screens } from '../lib/copy/screens';

/**
 * The form pieces every entry screen is built from.
 *
 * Three properties they all hold, because breaking any one of them is what makes
 * a form feel like software rather than a way to write something down:
 *
 *  - every input has a real `<label>` tied to it by id, so a screen reader
 *    announces it and a tap on the words focuses the field;
 *  - an error appears *next to the field it belongs to*, with `aria-describedby`
 *    and `aria-invalid`, and never only as a banner at the top;
 *  - the submit button says what it is doing while it does it, and the result is
 *    announced in a live region rather than only appearing.
 *
 * The field errors reach the fields through context rather than through props.
 * That is not a style choice: a server component cannot pass a function — or a
 * render prop — to a client component, so the form's state cannot travel down as
 * an argument from the page. Context is how a client subtree shares state that a
 * server parent never sees, and it removes a whole class of mistake with it,
 * because no page has to remember to wire an error prop to the matching field.
 */

const FormStateContext = createContext<FormState>(idleForm);

/** The error for one field, if the last submission produced one. */
export function useFieldError(name: string): string | undefined {
  const state = useContext(FormStateContext);
  return state.errors.find((error) => error.field === name)?.message;
}

export interface ActionFormProps {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  submitLabel: string;
  children: ReactNode;
  /** Reset the fields after a successful submit. Right for "add another". */
  resetOnSuccess?: boolean;
  className?: string;
  /** A quieter variant for a form embedded in a list row. */
  tone?: 'primary' | 'secondary' | 'danger';
}

export function ActionForm({
  action,
  submitLabel,
  children,
  resetOnSuccess = false,
  className = '',
  tone = 'primary',
}: ActionFormProps) {
  const [state, formAction] = useActionState(action, idleForm);

  return (
    <FormStateContext.Provider value={state}>
      <form
        action={formAction}
        className={`flex flex-col gap-4 ${className}`}
        // Remounting on success is what clears the fields; the key changes only
        // when the caller asked for that behaviour.
        key={resetOnSuccess && state.status === 'success' ? state.message : 'form'}
      >
        {children}
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton label={submitLabel} tone={tone} />
          <FormMessage />
        </div>
      </form>
    </FormStateContext.Provider>
  );
}

export function SubmitButton({
  label,
  tone = 'primary',
}: {
  label: string;
  tone?: 'primary' | 'secondary' | 'danger';
}) {
  const { pending } = useFormStatus();

  const styles: Record<string, string> = {
    primary: 'bg-primary text-surface hover:bg-primary-hover',
    secondary:
      'border border-border-interactive bg-surface text-text-primary hover:bg-surface-muted',
    danger: 'border border-danger/40 bg-surface text-danger hover:bg-danger/5',
  };

  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex min-h-11 items-center justify-center rounded-control px-4 py-2 font-medium transition-colors disabled:opacity-60 ${styles[tone] ?? styles['primary']}`}
    >
      {pending ? screens.common.saving : label}
    </button>
  );
}

/**
 * What the server said, announced.
 *
 * `role="status"` with `aria-live="polite"` means a screen reader hears the
 * outcome without the focus moving, which is what a person filling a form
 * actually wants.
 */
export function FormMessage({ state }: { state?: FormState }) {
  const fromContext = useContext(FormStateContext);
  const current = state ?? fromContext;

  if (current.status === 'idle' || current.message === '') {
    return <span role="status" aria-live="polite" className="sr-only" />;
  }

  return (
    <span
      role="status"
      aria-live="polite"
      className={`text-small font-medium ${
        current.status === 'error' ? 'text-danger' : 'text-success'
      }`}
    >
      {current.message}
    </span>
  );
}

interface BaseFieldProps {
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
}

function FieldShell({
  id,
  label,
  hint,
  error,
  required,
  children,
}: BaseFieldProps & { id: string; error: string | undefined; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-medium">
        {label}
        {required === false ? (
          <span className="mr-1.5 text-small font-normal text-text-secondary">
            ({screens.common.optional})
          </span>
        ) : null}
      </label>
      {hint === undefined ? null : (
        <p id={`${id}-hint`} className="text-small text-text-secondary">
          {hint}
        </p>
      )}
      {children}
      {error === undefined ? null : (
        <p id={`${id}-error`} className="text-small font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const inputStyles =
  'min-h-11 w-full rounded-control border border-border-interactive bg-surface px-3 py-2 text-body text-text-primary placeholder:text-text-secondary/70 aria-[invalid=true]:border-danger';

function describedBy(
  id: string,
  hint: string | undefined,
  error: string | undefined,
): string | undefined {
  const parts = [
    hint === undefined ? null : `${id}-hint`,
    error === undefined ? null : `${id}-error`,
  ].filter((value): value is string => value !== null);
  return parts.length === 0 ? undefined : parts.join(' ');
}

export function TextField({
  name,
  label,
  hint,
  required = true,
  type = 'text',
  defaultValue,
  placeholder,
  inputMode,
  autoComplete = 'off',
  maxLength,
}: BaseFieldProps & {
  type?: 'text' | 'date' | 'number' | 'month';
  defaultValue?: string | undefined;
  placeholder?: string;
  inputMode?: 'text' | 'decimal' | 'numeric';
  autoComplete?: string;
  maxLength?: number;
}) {
  const id = useId();
  const error = useFieldError(name);

  return (
    <FieldShell
      id={id}
      name={name}
      label={label}
      {...(hint === undefined ? {} : { hint })}
      error={error}
      required={required}
    >
      <input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue ?? ''}
        placeholder={placeholder ?? ''}
        inputMode={inputMode ?? 'text'}
        autoComplete={autoComplete}
        maxLength={maxLength ?? undefined}
        required={required}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={inputStyles}
        // A money field and a date read left to right even inside a Hebrew form.
        // Everything else inherits the document's direction; declaring `rtl`
        // again would put a second direction declaration in the tree, which makes
        // the root contract ambiguous and is what `check:shell` refuses.
        {...(inputMode === 'decimal' || type === 'date' || type === 'month' || type === 'number'
          ? { dir: 'ltr' as const }
          : {})}
      />
    </FieldShell>
  );
}

export function MoneyField(props: BaseFieldProps & { defaultValue?: string }) {
  return (
    <TextField
      {...props}
      type="text"
      inputMode="decimal"
      placeholder="0"
      hint={props.hint ?? screens.entry.amountHint}
    />
  );
}

export function SelectField({
  name,
  label,
  hint,
  required = true,
  options,
  defaultValue,
  emptyLabel,
}: BaseFieldProps & {
  options: readonly { value: string; label: string }[];
  defaultValue?: string | undefined;
  /** When present, a first option with an empty value. */
  emptyLabel?: string;
}) {
  const id = useId();
  const error = useFieldError(name);

  return (
    <FieldShell
      id={id}
      name={name}
      label={label}
      {...(hint === undefined ? {} : { hint })}
      error={error}
      required={required}
    >
      <select
        id={id}
        name={name}
        defaultValue={defaultValue ?? ''}
        required={required && emptyLabel === undefined}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={inputStyles}
      >
        {emptyLabel === undefined ? null : <option value="">{emptyLabel}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function TextAreaField({
  name,
  label,
  hint,
  required = false,
  defaultValue,
  rows = 3,
}: BaseFieldProps & { defaultValue?: string; rows?: number }) {
  const id = useId();
  const error = useFieldError(name);

  return (
    <FieldShell
      id={id}
      name={name}
      label={label}
      {...(hint === undefined ? {} : { hint })}
      error={error}
      required={required}
    >
      <textarea
        id={id}
        name={name}
        rows={rows}
        defaultValue={defaultValue ?? ''}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={`${inputStyles} min-h-24`}
      />
    </FieldShell>
  );
}

export function CheckboxField({
  name,
  label,
  hint,
  defaultChecked = false,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
}) {
  const id = useId();

  return (
    <div className="flex flex-col gap-1">
      {/*
        The box itself is 20px, which is as large as a checkbox is allowed to look.
        The label is what makes the target 44px: it is tied to the input by id, it
        fills the row, and clicking anywhere on it toggles the box.
      */}
      <label
        htmlFor={id}
        className="flex min-h-11 cursor-pointer items-center gap-2.5 font-medium"
      >
        <input
          id={id}
          name={name}
          type="checkbox"
          defaultChecked={defaultChecked}
          className="h-5 w-5 shrink-0 rounded border-border-interactive accent-primary"
        />
        {label}
      </label>
      {hint === undefined ? null : <p className="text-small text-text-secondary">{hint}</p>}
    </div>
  );
}

export function FileField({ name, label, hint, accept }: BaseFieldProps & { accept: string }) {
  const id = useId();
  const error = useFieldError(name);

  return (
    <FieldShell
      id={id}
      name={name}
      label={label}
      {...(hint === undefined ? {} : { hint })}
      error={error}
      required
    >
      <input
        id={id}
        name={name}
        type="file"
        accept={accept}
        required
        aria-invalid={error !== undefined}
        aria-describedby={describedBy(id, hint, error)}
        className="min-h-11 w-full cursor-pointer rounded-control border border-dashed border-border-interactive bg-surface-muted/50 px-3 py-2.5 file:mx-0 file:ml-3 file:cursor-pointer file:rounded-control file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-surface"
      />
    </FieldShell>
  );
}

/** A hidden value the form carries from the list that rendered it. */
export function HiddenValue({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}
