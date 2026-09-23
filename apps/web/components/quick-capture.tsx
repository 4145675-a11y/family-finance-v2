'use client';

import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useFormStatus } from 'react-dom';

import { QuickProposals } from './quick-proposals';
import { idleQuick, MAX_QUICK_TEXT, type QuickState } from '../lib/quick/state';
import { quick } from '../lib/copy/quick';

/**
 * Saying what happened, in one sentence.
 *
 * Two ways in, and they are not a main road and a back road: **typing is the
 * whole feature**, and dictation is a shortcut into the same box. Whatever the
 * microphone produces lands in the textarea where the person can see it, fix it
 * and decide whether to send it. Nothing is interpreted from audio the person
 * has not read.
 *
 * That ordering is what makes the microphone safe to offer at all. The browser's
 * own `SpeechRecognition` is a black box — some implementations do the
 * recognition on the device and some send audio to the vendor — and this product
 * cannot promise which. So it says so plainly on the screen, never starts
 * listening on its own, and keeps the typed path complete for anyone who would
 * rather not use it. A browser without the API simply does not show the button;
 * the screen is not diminished.
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

/*
 * The proposals are rendered from here rather than handed in as a render prop.
 * A server component cannot pass a function to a client component at all, so a
 * page that tried would serve a 500 rather than a screen. Both halves of this
 * feature are client components; keeping the state between them is the whole
 * reason they are one subtree.
 */
export function QuickCapture({
  action,
}: {
  action: (state: QuickState, data: FormData) => Promise<QuickState>;
}) {
  const [state, formAction] = useActionState(action, idleQuick);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const recognition = useRef<RecognitionLike | null>(null);

  /*
   * Whether the browser has the API is a fact about the browser: it is not
   * React state, it never changes while the page is open, and the server
   * rendering the page has no microphone at all. Read as an external value, so
   * the server says "no" and the browser says the truth without a render pass
   * in between where the button would flicker.
   */
  const dictationAvailable = useSyncExternalStore(
    subscribeToNothing,
    () => recognitionConstructor() !== null,
    () => false,
  );

  // The one thing that does need tearing down: a recogniser still listening
  // when the person navigates away.
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
      if (heard !== '') {
        // Appended to what is already there, never replacing it: a person who
        // typed half a sentence and then spoke the rest keeps both.
        setText((current) => `${current} ${heard}`.trim().slice(0, MAX_QUICK_TEXT));
      }
    };
    engine.onerror = () => setListening(false);
    engine.onend = () => setListening(false);
    recognition.current = engine;
    engine.start();
    setListening(true);
  }

  function stopListening() {
    recognition.current?.stop();
    setListening(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-3">
        <label htmlFor="quick-text" className="font-medium">
          {quick.captureLabel}
        </label>
        <textarea
          id="quick-text"
          name="text"
          rows={3}
          maxLength={MAX_QUICK_TEXT}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={quick.placeholder}
          className="min-h-24 w-full rounded-control border border-border bg-surface px-3 py-2 text-text-primary"
        />
        <p className="text-small text-text-secondary">{quick.hint}</p>

        <div className="flex flex-wrap items-center gap-3">
          <InterpretButton />
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
        </div>

        {dictationAvailable ? (
          <p className="text-small text-text-secondary">
            {listening ? quick.listening : quick.dictationNotice}
          </p>
        ) : (
          <p className="text-small text-text-secondary">{quick.noDictation}</p>
        )}
      </form>

      {state.message !== '' ? (
        <p
          role="status"
          aria-live="polite"
          className={`text-small font-medium ${
            state.status === 'error' ? 'text-danger' : 'text-text-secondary'
          }`}
        >
          {state.message}
        </p>
      ) : (
        <span role="status" aria-live="polite" className="sr-only" />
      )}

      <QuickProposals state={state} />
    </div>
  );
}

function InterpretButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 items-center justify-center rounded-control bg-primary px-4 py-2 font-medium text-surface transition-colors hover:bg-primary-hover disabled:opacity-60"
    >
      {pending ? quick.reading : quick.interpret}
    </button>
  );
}
