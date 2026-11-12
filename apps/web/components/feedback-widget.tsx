'use client';

import {
  FEEDBACK_TEXT_MAX,
  privacyHints,
  type FeedbackKind,
  type FeedbackMark,
  type FeedbackUrgency,
  type PrivacyHint,
} from '@family-finance/contracts';
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';

import { submitFeedbackAction } from '../lib/actions/feedback';
import { feedbackCopy as t } from '../lib/copy/feedback';
import {
  MIN_REGION,
  buildSubmission,
  dragRect,
  fbChain,
  nearestNamed,
  pageRect,
} from '../lib/feedback/collect';

/**
 * The feedback button (ADR-0047).
 *
 * Rendered by the application shell, so it exists only on screens a signed-in
 * member reaches. It lives in a Shadow DOM attached to its own host element:
 * the product's styles cannot reach it and its styles cannot reach the product,
 * so a note about how a screen looks is never a note about how the button made
 * it look. Design tokens still arrive, because custom properties inherit
 * through a shadow boundary.
 *
 * What it sends is built in `lib/feedback/collect.ts` from named fields only.
 * It never reads an element's text, a field's value or the page title.
 */

type Phase =
  | { readonly name: 'closed' }
  | { readonly name: 'choose' }
  | { readonly name: 'pick-element' }
  | { readonly name: 'pick-region' }
  | { readonly name: 'form'; readonly mark: FeedbackMark }
  | { readonly name: 'sent'; readonly reference: string };

const KINDS: readonly FeedbackKind[] = ['design', 'content', 'bug', 'other'];
const URGENCIES: readonly FeedbackUrgency[] = ['low', 'normal', 'high'];

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The element under a point, looking through the button's own host. */
function elementAt(x: number, y: number, host: Element | null): Element | null {
  for (const candidate of document.elementsFromPoint(x, y)) {
    if (candidate === host || candidate === document.documentElement) continue;
    if (candidate === document.body) return null;
    return candidate;
  }
  return null;
}

function boxOf(element: Element): Box {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function scroll(): { x: number; y: number } {
  return { x: window.scrollX, y: window.scrollY };
}

export function FeedbackWidget() {
  const [shadow, setShadow] = useState<ShadowRoot | null>(null);
  const hostRef = useRef<HTMLElement | null>(null);

  // A ref callback rather than an effect: the shadow root exists the moment the
  // host does, and a remount finds the root it already attached.
  const attach = useCallback((node: HTMLDivElement | null) => {
    hostRef.current = node;
    if (node !== null) setShadow(node.shadowRoot ?? node.attachShadow({ mode: 'open' }));
  }, []);

  return (
    <div data-feedback-host="" ref={attach}>
      {shadow === null
        ? null
        : createPortal(
            <>
              <style>{STYLES}</style>
              <Widget host={hostRef} />
            </>,
            shadow,
          )}
    </div>
  );
}

function Widget({ host }: { host: { readonly current: HTMLElement | null } }) {
  const [phase, setPhase] = useState<Phase>({ name: 'closed' });
  const [hover, setHover] = useState<Box | null>(null);
  // The selected element and the path back to the one first clicked, for "inner".
  const [picked, setPicked] = useState<Element[]>([]);
  const [drag, setDrag] = useState<{ start: { x: number; y: number }; box: Box } | null>(null);

  const [text, setText] = useState('');
  const [kind, setKind] = useState<FeedbackKind>('design');
  const [urgency, setUrgency] = useState<FeedbackUrgency>('normal');
  const [trap, setTrap] = useState('');
  const [warnedFor, setWarnedFor] = useState<string | null>(null);
  const [hints, setHints] = useState<PrivacyHint[]>([]);
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const close = useCallback(() => {
    setPhase({ name: 'closed' });
    setHover(null);
    setPicked([]);
    setDrag(null);
    setText('');
    setKind('design');
    setUrgency('normal');
    setTrap('');
    setWarnedFor(null);
    setHints([]);
    setRefusal(null);
    setSending(false);
  }, []);

  // Escape leaves from any stage.
  useEffect(() => {
    if (phase.name === 'closed') return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase.name, close]);

  // The thank-you closes itself.
  useEffect(() => {
    if (phase.name !== 'sent') return undefined;
    const timer = window.setTimeout(close, 6000);
    return () => window.clearTimeout(timer);
  }, [phase.name, close]);

  const current = picked.at(-1) ?? null;

  function onPickMove(event: PointerEvent<HTMLDivElement>) {
    if (phase.name === 'pick-element' && picked.length === 0) {
      const under = elementAt(event.clientX, event.clientY, host.current);
      setHover(under === null ? null : boxOf(nearestNamed(under) ?? under));
    }
    if (phase.name === 'pick-region' && drag !== null) {
      setDrag({
        start: drag.start,
        box: dragRect(drag.start, { x: event.clientX, y: event.clientY }),
      });
    }
  }

  function onPickDown(event: PointerEvent<HTMLDivElement>) {
    if (phase.name === 'pick-element') {
      const under = elementAt(event.clientX, event.clientY, host.current);
      if (under === null) return;
      const chosen = nearestNamed(under) ?? under;
      setPicked([chosen]);
      setHover(boxOf(chosen));
    }
    if (phase.name === 'pick-region') {
      event.currentTarget.setPointerCapture(event.pointerId);
      const start = { x: event.clientX, y: event.clientY };
      setDrag({ start, box: { left: start.x, top: start.y, width: 0, height: 0 } });
    }
  }

  function onPickUp() {
    if (phase.name !== 'pick-region' || drag === null) return;
    const { box } = drag;
    setDrag(null);
    if (box.width < MIN_REGION || box.height < MIN_REGION) return;
    const centre = elementAt(box.left + box.width / 2, box.top + box.height / 2, host.current);
    setPhase({
      name: 'form',
      mark: { type: 'region', chain: fbChain(centre), rect: pageRect(box, scroll()) },
    });
  }

  function climb(direction: 'outer' | 'inner') {
    if (current === null) return;
    if (direction === 'outer') {
      const parent = current.parentElement;
      if (parent === null || parent === document.body || parent === document.documentElement) {
        return;
      }
      const next = nearestNamed(parent) ?? parent;
      setPicked([...picked, next]);
      setHover(boxOf(next));
    } else if (picked.length > 1) {
      const next = picked.slice(0, -1);
      setPicked(next);
      const last = next.at(-1);
      if (last !== undefined) setHover(boxOf(last));
    }
  }

  function confirmElement() {
    if (current === null) return;
    setPhase({
      name: 'form',
      mark: {
        type: 'element',
        chain: fbChain(current),
        rect: pageRect(boxOf(current), scroll()),
      },
    });
    setHover(null);
  }

  async function send(mark: FeedbackMark) {
    const found = privacyHints(text);
    if (found.length > 0 && warnedFor !== text) {
      setHints(found);
      setWarnedFor(text);
      return;
    }
    setSending(true);
    setRefusal(null);
    try {
      const outcome = await submitFeedbackAction(
        buildSubmission({
          kind,
          urgency,
          text,
          mark,
          screen: {
            pathname: window.location.pathname,
            width: window.innerWidth,
            height: window.innerHeight,
            scrollY: window.scrollY,
          },
          website: trap,
        }),
      );
      if (outcome.ok) {
        setPhase({ name: 'sent', reference: outcome.reference });
      } else {
        setRefusal(t.refused[outcome.reason]);
      }
    } catch {
      setRefusal(t.refused.failed);
    } finally {
      setSending(false);
    }
  }

  function restart() {
    setPicked([]);
    setHover(null);
    setHints([]);
    setWarnedFor(null);
    setPhase({ name: 'choose' });
  }

  const picking = phase.name === 'pick-element' || phase.name === 'pick-region';

  return (
    <div dir="rtl" className="root">
      {phase.name === 'closed' ? (
        <button
          type="button"
          className="launcher"
          aria-label={t.openLabel}
          data-testid="feedback-open"
          onClick={() => setPhase({ name: 'choose' })}
        >
          <span className="launcher-icon" aria-hidden="true">
            ✎
          </span>
          <span className="launcher-text">{t.open}</span>
        </button>
      ) : null}

      {picking ? (
        <div
          className={`catcher ${phase.name === 'pick-region' ? 'catcher-region' : ''}`}
          data-testid="feedback-catcher"
          onPointerMove={onPickMove}
          onPointerDown={onPickDown}
          onPointerUp={onPickUp}
        >
          {hover !== null ? (
            <div
              className="outline"
              style={{
                left: hover.left,
                top: hover.top,
                width: hover.width,
                height: hover.height,
              }}
            />
          ) : null}
          {drag !== null ? (
            <div
              className="outline marquee"
              style={{
                left: drag.box.left,
                top: drag.box.top,
                width: drag.box.width,
                height: drag.box.height,
              }}
            />
          ) : null}
        </div>
      ) : null}

      {picking ? (
        <div className="bar" role="status" onPointerDown={(event) => event.stopPropagation()}>
          <span>{phase.name === 'pick-element' ? t.pickingElement : t.pickingRegion}</span>
          {phase.name === 'pick-element' && current !== null ? (
            <span className="bar-actions">
              <button type="button" className="secondary" onClick={() => climb('outer')}>
                {t.outer}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={picked.length < 2}
                onClick={() => climb('inner')}
              >
                {t.inner}
              </button>
              <button type="button" className="primary" onClick={confirmElement}>
                {t.confirmPick}
              </button>
            </span>
          ) : null}
          <button type="button" className="secondary" onClick={close}>
            {t.close}
          </button>
        </div>
      ) : null}

      {phase.name === 'choose' ? (
        <div
          className="panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="fb-choose-title"
        >
          <h2 id="fb-choose-title">{t.chooseTitle}</h2>
          <button
            type="button"
            className="choice"
            onClick={() => setPhase({ name: 'pick-element' })}
          >
            <strong>{t.chooseElement}</strong>
            <span>{t.chooseElementHint}</span>
          </button>
          <button
            type="button"
            className="choice"
            onClick={() => setPhase({ name: 'pick-region' })}
          >
            <strong>{t.chooseRegion}</strong>
            <span>{t.chooseRegionHint}</span>
          </button>
          <button
            type="button"
            className="choice"
            onClick={() => setPhase({ name: 'form', mark: { type: 'page' } })}
          >
            <strong>{t.choosePage}</strong>
            <span>{t.choosePageHint}</span>
          </button>
          <button type="button" className="secondary" onClick={close}>
            {t.close}
          </button>
        </div>
      ) : null}

      {phase.name === 'form' ? (
        <form
          className="panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="fb-form-title"
          onSubmit={(event) => {
            event.preventDefault();
            void send(phase.mark);
          }}
        >
          <h2 id="fb-form-title">{t.formTitle}</h2>
          <p className="who">{t.whoReads}</p>
          <label className="field">
            <span>{t.textLabel}</span>
            <textarea
              name="text"
              required
              rows={5}
              maxLength={FEEDBACK_TEXT_MAX}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <span className="counter" aria-live="polite">
              {t.counter(text.length, FEEDBACK_TEXT_MAX)}
            </span>
          </label>
          <div className="row">
            <label className="field">
              <span>{t.kindLabel}</span>
              <select
                name="kind"
                value={kind}
                onChange={(event) => setKind(event.target.value as FeedbackKind)}
              >
                {KINDS.map((value) => (
                  <option key={value} value={value}>
                    {t.kinds[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t.urgencyLabel}</span>
              <select
                name="urgency"
                value={urgency}
                onChange={(event) => setUrgency(event.target.value as FeedbackUrgency)}
              >
                {URGENCIES.map((value) => (
                  <option key={value} value={value}>
                    {t.urgencies[value]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {/* A person never sees this field. A bot that fills it is thanked and ignored. */}
          <input
            className="trap"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            value={trap}
            onChange={(event) => setTrap(event.target.value)}
          />
          {hints.length > 0 && warnedFor === text ? (
            <div className="warning" role="alert">
              <strong>{t.privacyTitle}</strong>
              <span>
                {t.privacyLead} {hints.map((hint) => t.privacyHints[hint]).join(', ')}.{' '}
                {t.privacyAction}
              </span>
            </div>
          ) : null}
          {refusal !== null ? (
            <div className="warning" role="alert">
              {refusal}
            </div>
          ) : null}
          <div className="row">
            <button type="submit" className="primary" disabled={sending || text.trim() === ''}>
              {sending ? t.sending : t.send}
            </button>
            <button type="button" className="secondary" onClick={restart}>
              {t.remark}
            </button>
            <button type="button" className="secondary" onClick={close}>
              {t.close}
            </button>
          </div>
        </form>
      ) : null}

      {phase.name === 'sent' ? (
        <div className="panel" role="status" data-testid="feedback-sent">
          <h2>{t.thanks}</h2>
          <p>{t.thanksReference(phase.reference)}</p>
          <button type="button" className="secondary" onClick={close}>
            {t.close}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The button's own styles. Inside the shadow root, so nothing here can touch the
 * product. Positions: a side tab on a desktop, an icon on a tablet, and a small
 * round button above the bottom navigation on a phone.
 */
const STYLES = `
:host { all: initial; }
.root {
  font-family: var(--font-sans, system-ui, sans-serif);
  font-size: 16px;
  line-height: 1.5;
  color: var(--color-text-primary, #1b2a2c);
}
button, select, textarea, input { font: inherit; color: inherit; }
button { cursor: pointer; }
button:focus-visible, select:focus-visible, textarea:focus-visible {
  outline: 2px solid var(--color-focus, #2b6cb0);
  outline-offset: 2px;
}
.launcher {
  position: fixed; z-index: 2147483000;
  left: 0; top: 50%; transform: translateY(-50%);
  display: flex; align-items: center; gap: 6px;
  min-height: 44px; padding: 10px 12px;
  border: 0; border-radius: 0 var(--radius-control, 8px) var(--radius-control, 8px) 0;
  background: var(--color-text-primary, #1b2a2c); color: var(--color-surface, #fff);
  box-shadow: var(--shadow-raised, 0 2px 8px rgba(0,0,0,.15));
}
.launcher-icon { font-size: 18px; }
@media (max-width: 1024px) {
  .launcher-text { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .launcher { min-width: 44px; justify-content: center; }
}
@media (max-width: 639px) {
  .launcher {
    top: auto; transform: none; left: 12px; bottom: 96px;
    width: 44px; height: 44px; padding: 0; border-radius: 999px;
  }
}
.catcher {
  position: fixed; inset: 0; z-index: 2147483001;
  cursor: crosshair; background: transparent; touch-action: none;
}
.outline {
  position: fixed; pointer-events: none;
  border: 2px dashed var(--color-primary, #1e4f73);
  background: rgba(30, 79, 115, 0.08);
  border-radius: 4px;
}
.bar {
  position: fixed; z-index: 2147483002; left: 50%; top: 12px; transform: translateX(-50%);
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  max-width: calc(100vw - 32px); padding: 8px 12px;
  background: var(--color-surface, #fff); border: 1px solid var(--color-border, #e6ded2);
  border-radius: var(--radius-card, 14px); box-shadow: var(--shadow-raised, 0 2px 8px rgba(0,0,0,.15));
}
.bar-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.panel {
  position: fixed; z-index: 2147483002; left: 16px; bottom: 16px;
  display: flex; flex-direction: column; gap: 10px;
  width: min(380px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow: auto;
  padding: 16px; box-sizing: border-box;
  background: var(--color-surface, #fff); border: 1px solid var(--color-border, #e6ded2);
  border-radius: var(--radius-card, 14px); box-shadow: var(--shadow-raised, 0 2px 8px rgba(0,0,0,.15));
}
@media (max-width: 639px) { .panel { bottom: 88px; } }
h2 { margin: 0; font-size: 18px; font-weight: 600; }
p { margin: 0; }
.who { font-size: 14px; color: var(--color-text-secondary, #586b6c); }
.choice {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: right;
  min-height: 44px; padding: 10px 12px;
  background: var(--color-surface-muted, #f3eee6); border: 1px solid var(--color-border, #e6ded2);
  border-radius: var(--radius-control, 8px);
}
.choice span { font-size: 14px; color: var(--color-text-secondary, #586b6c); }
.field { display: flex; flex-direction: column; gap: 4px; flex: 1; font-size: 14px; }
textarea, select {
  width: 100%; box-sizing: border-box; padding: 8px 10px; min-height: 44px;
  background: var(--color-surface, #fff);
  border: 1px solid var(--color-border-interactive, #87837b); border-radius: var(--radius-control, 8px);
}
textarea { resize: vertical; }
.counter { align-self: flex-end; font-size: 12px; color: var(--color-text-secondary, #586b6c); }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
.primary, .secondary { min-height: 44px; padding: 8px 14px; border-radius: var(--radius-control, 8px); }
.primary { border: 0; background: var(--color-primary, #1e4f73); color: var(--color-surface, #fff); }
.primary:disabled { opacity: .55; cursor: default; }
.secondary { border: 1px solid var(--color-border-interactive, #87837b); background: var(--color-surface, #fff); }
.secondary:disabled { opacity: .55; cursor: default; }
.warning {
  display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; font-size: 14px;
  border: 1px solid var(--color-attention, #9a6410); border-radius: var(--radius-control, 8px);
  background: var(--color-surface-muted, #f3eee6);
}
.trap { position: absolute; left: -10000px; width: 1px; height: 1px; opacity: 0; }
`;
