'use client';

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { flushSync } from 'react-dom';
import { useFormStatus } from 'react-dom';

import { QuickProposalCard } from './quick-proposal-card';
import { Disclosure } from './ui';
import { MAX_QUICK_TEXT, idleQuick, type QuickState } from '../lib/quick/state';
import { quick } from '../lib/copy/quick';

/**
 * Saying what to update, in one sentence.
 *
 * One field, one button, one proposal. A person is never asked which machinery
 * should read their sentence — that is not a question anybody can answer, and
 * the answer would not change what can happen to their money. Whether a remote
 * reader or the local rule table produced the proposal is decided on the server
 * and is invisible here on purpose.
 *
 * Dictation is a shortcut into the same box rather than a second road. Whatever
 * the microphone produces lands in the textarea where it can be read, fixed and
 * decided on; nothing is interpreted from audio nobody has seen. A browser
 * without the API simply does not show the button, and the screen is not
 * diminished.
 *
 * What used to be here and is not: a second interpretation button, a paragraph
 * of privacy prose above the fold, and the quoted evidence for every extracted
 * field. The one sentence that remains says where the point of no return is; the
 * rest is behind `פרטים`, closed.
 */

interface SpeechResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: { readonly transcript: string };
}

interface SpeechEventLike {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: SpeechResultLike };
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type RecognitionConstructor = new () => RecognitionLike;

/** The subscription for a value that never changes: there is nothing to watch. */
const subscribeToNothing = () => () => {};

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function QuickCapture({
  propose,
}: {
  /** The one reading action. Writes nothing. */
  propose: (state: QuickState, data: FormData) => Promise<QuickState>;
}) {
  const [state, formAction, reading] = useActionState(propose, idleQuick);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const recognition = useRef<RecognitionLike | null>(null);
  const form = useRef<HTMLFormElement | null>(null);

  /** A recognition error is not a finished sentence, so it must not be read. */
  const failed = useRef(false);

  /*
   * Whether a reading is already in flight, where a callback can see it.
   *
   * The recogniser's handlers are created once, when listening starts, so they
   * close over that render's values forever. A ref is the same object every
   * time, which is what makes it safe to read from inside them.
   */
  const inFlight = useRef(false);
  useEffect(() => {
    inFlight.current = reading;
  }, [reading]);

  /**
   * Asks the server to read the sentence. Writes nothing, like the button.
   *
   * `requestSubmit` rather than calling the action directly: it goes through the
   * form, so the submission carries the same fields and the same identifier a
   * press of the button would, and there is exactly one way in.
   *
   * The sentence is taken from the form rather than from React state for the
   * same reason as the ref above — and because asking the form what it is about
   * to send is the honest question. An empty box quietly does nothing, rather
   * than producing an error message about a sentence nobody wrote.
   */
  const read = useCallback((): void => {
    const node = form.current;
    if (node === null || inFlight.current) return;
    const sentence = new FormData(node).get('text');
    if (typeof sentence !== 'string' || sentence.trim() === '') return;
    node.requestSubmit();
  }, []);

  /*
   * Whether the browser has the API is a fact about the browser: not React
   * state, unchanging while the page is open, and false on the server, which has
   * no microphone. Read as an external value so the button does not flicker.
   */
  const dictationAvailable = useSyncExternalStore(
    subscribeToNothing,
    () => recognitionConstructor() !== null,
    () => false,
  );

  // The one thing that needs tearing down: a recogniser still listening when
  // the person navigates away.
  useEffect(
    () => () => {
      recognition.current?.stop();
      recognition.current = null;
    },
    [],
  );

  function startListening() {
    const Constructor = recognitionConstructor();
    if (Constructor === null) return;

    const engine = new Constructor();
    engine.lang = 'he-IL';
    engine.continuous = true;
    engine.interimResults = false;
    engine.onresult = (event) => {
      let heard = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result === undefined || !result.isFinal) continue;
        heard += result[0]?.transcript ?? '';
      }
      if (heard === '') return;
      /*
       * Appended rather than replacing: somebody who typed half a sentence and
       * then spoke the rest keeps both.
       *
       * Flushed, because `onend` follows within the same turn and reads the box
       * to decide what to send. Without this the last thing said would still be
       * queued in React when the sentence left — words spoken and then silently
       * dropped, which is the one failure a dictation feature cannot have.
       */
      flushSync(() => {
        setText((current) => `${current} ${heard}`.trim().slice(0, MAX_QUICK_TEXT));
      });
    };
    engine.onerror = () => {
      failed.current = true;
      setListening(false);
    };
    /*
     * Ending is what starts the reading — whether the person pressed stop or the
     * recogniser stopped on its own. `onerror` fires before `onend`, so the flag
     * is what keeps a failed recording from being read as a sentence.
     */
    engine.onend = () => {
      setListening(false);
      if (failed.current) return;
      read();
    };
    failed.current = false;
    recognition.current = engine;
    engine.start();
    setListening(true);
  }

  function stopListening() {
    // Only asks it to stop. `onend` is what decides the sentence is finished,
    // so pressing stop and the recogniser ending by itself take one path.
    recognition.current?.stop();
  }

  return (
    <div className="flex flex-col gap-4">
      <form ref={form} action={formAction} className="flex flex-col gap-3">
        {/*
         * The label is the page's own heading, so it is not printed twice.
         * Present for anybody reading the page with a screen reader, absent for
         * anybody reading it with their eyes — the same words either way.
         */}
        <label htmlFor="quick-text" className="sr-only">
          {quick.captureLabel}
        </label>
        <textarea
          id="quick-text"
          name="text"
          rows={2}
          maxLength={MAX_QUICK_TEXT}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            /*
             * Enter reads the sentence; Shift+Enter writes a new line.
             *
             * A quick update is one sentence, so the key that ends a sentence
             * should be the key that sends it. `isComposing` is checked because
             * an input method uses Enter to accept a candidate, and stealing
             * that would submit half a word.
             *
             * The cost, stated plainly: a phone keyboard has no Shift, so on a
             * phone there is no longer a way to put a line break in this box.
             * For a screen whose whole premise is one sentence that is the right
             * trade, and it is the reason the box stays two rows rather than one.
             */
            if (event.key !== 'Enter' || event.shiftKey) return;
            if (event.nativeEvent.isComposing) return;
            event.preventDefault();
            read();
          }}
          placeholder={quick.placeholder}
          className="min-h-20 w-full rounded-control border border-border bg-surface px-3 py-2 text-text-primary"
        />

        <div className="flex flex-wrap items-center gap-3">
          <ProposeButton />
          {dictationAvailable ? (
            <button
              type="button"
              onClick={listening ? stopListening : startListening}
              aria-pressed={listening}
              className="inline-flex min-h-11 items-center justify-center rounded-control border border-border-interactive bg-surface px-4 py-2 font-medium text-text-primary transition-colors hover:bg-surface-muted"
            >
              {listening ? quick.stopDictation : quick.startDictation}
            </button>
          ) : null}
          {text !== '' ? (
            <button
              type="button"
              onClick={() => setText('')}
              className="min-h-11 px-2 text-small text-text-secondary underline"
            >
              {quick.clear}
            </button>
          ) : null}
          {/*
           * Enter is not what a textarea usually does, so it is said out loud.
           * Only where there is a keyboard to say it about: on a phone the hint
           * would name two keys that are not on the screen.
           */}
          <span className="hidden text-small text-text-secondary sm:inline">
            {quick.enterHint}
          </span>
        </div>

        {/* The one sentence, and the only one, on the main path. */}
        <p className="text-small text-text-secondary" data-testid="quick-promise">
          {listening ? quick.listening : quick.promise}
        </p>
      </form>

      {state.message === '' ? (
        <span role="status" aria-live="polite" className="sr-only" />
      ) : (
        <p
          role="status"
          aria-live="polite"
          className={`text-small font-medium ${
            state.status === 'error' ? 'text-danger' : 'text-text-secondary'
          }`}
        >
          {state.message}
        </p>
      )}

      <QuickProposalCard state={state} />

      {/*
       * Everything a person might want to know and does not need in order to act.
       * Closed by default, and it carries no household figure, no model output
       * and nothing technical.
       */}
      <Disclosure summary={quick.detailsSummary}>
        <p className="text-small text-text-secondary">{quick.detailsBody}</p>
        {dictationAvailable ? null : (
          <p className="mt-2 text-small text-text-secondary">{quick.noDictation}</p>
        )}
      </Disclosure>
    </div>
  );
}

function ProposeButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 items-center justify-center rounded-control bg-primary px-4 py-2 font-medium text-surface transition-colors hover:bg-primary-hover disabled:opacity-60"
    >
      {pending ? quick.proposing : quick.propose}
    </button>
  );
}
