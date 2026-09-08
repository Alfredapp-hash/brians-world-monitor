/**
 * Split-flap (departure-board) text motion for status readouts.
 *
 * When a readout's label changes — "ACQUIRING SIGNAL" → "LIVE · 35 GROUPS" —
 * the changed characters flip over mechanically, left to right, like a Solari
 * board. Used by the God's Eye HUD so live telemetry reads as instrumentation
 * rather than as text being replaced.
 *
 * Three invariants hold the DOM half together:
 *
 * 1. DOM TEXT IS THE TRUTH AND ITS NODE NEVER MOVES. The first call upgrades
 *    the element into a permanent two-child shell: a `.wm-flap-text` span with
 *    one long-lived text node, and an `aria-hidden` `.wm-flap-cells` sibling.
 *    After that the only text operation is `node.data = next`, so the label is
 *    never transiently empty and assistive tech never sees a remove/insert
 *    pair. The cells carry no text at all (both glyphs are CSS generated
 *    content), so `element.textContent` is the settled string at every instant.
 *
 * 2. NO ANIMATION LOOP. Motion is CSS `animation` only, triggered once per text
 *    change and staggered with a per-cell `--wm-flap-delay`. One change
 *    schedules exactly one timer: the settle that strips the cells. Idle cost
 *    is zero, which matters because HUD readouts repaint on a ticker.
 *
 * 3. ONLY WHAT WAS VISIBLE FLAPS AWAY. An interrupted cascade derives each
 *    column's outgoing glyph from what that column is actually showing at that
 *    instant, not from the pending target — otherwise a column whose stagger
 *    had not elapsed would flash a glyph that was never on screen.
 *
 * Columns are never renumbered mid-cascade: a column the new string does not
 * reach flaps to a blank in place rather than collapsing, so a later glyph can
 * never slide into an earlier column.
 */

/** Time one character spends flipping. */
export const FLAP_CHAR_MS = 190;
/** Nominal gap between consecutive characters starting their flip. */
export const FLAP_STAGGER_MS = 26;
/**
 * Ceiling for a whole cascade. Long labels compress their stagger to fit — a
 * readout that flaps for a full second reads as a slot machine, not a settle.
 */
export const FLAP_MAX_TOTAL_MS = 620;
/** Slack after the last character lands before the cells are stripped. */
export const FLAP_SETTLE_SLACK_MS = 60;
/**
 * Fraction of a character's flip at which the incoming glyph takes over as
 * what the eye reads. Must track the `wm-flap-out`/`wm-flap-in` keyframe
 * crossover in godseye-mode.css.
 */
export const FLAP_TURN_RATIO = 0.5;

/** What a reserved-but-empty column shows while it holds its place. */
const BLANK = ' ';

const HOST_CLASS = 'wm-flap-host';
const ACTIVE_CLASS = 'wm-flap-active';
const TEXT_CLASS = 'wm-flap-text';
const CELLS_CLASS = 'wm-flap-cells';
const CELL_CLASS = 'wm-flap-cell';
const FLAPPING_CLASS = 'is-flapping';

export interface SplitFlapCell {
  index: number;
  from: string;
  to: string;
  changed: boolean;
  /** The string shrank here: an old glyph to flap away, no new one. */
  vacating: boolean;
  delayMs: number;
}

export interface SplitFlapPlan {
  cells: SplitFlapCell[];
  durationMs: number;
  staggerMs: number;
  changedCount: number;
  firstChanged: number;
  lastChanged: number;
}

export interface SplitFlapOptions {
  charMs?: number;
  staggerMs?: number;
  maxTotalMs?: number;
}

function positiveNumber(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

/**
 * Diff two strings into per-character flap cells with staggered delays.
 *
 * Unchanged characters do not animate — a real split-flap cell already showing
 * the right glyph does not move. The stagger is rebased on the first changed
 * column so a label with a stable head ("LIVE · 12" → "LIVE · 35" keeps
 * "LIVE · ") starts flipping immediately instead of idling through untouched
 * columns.
 *
 * Pure: no DOM, no clock.
 */
export function planSplitFlap(
  fromText: string,
  toText: string,
  options: SplitFlapOptions = {},
): SplitFlapPlan {
  const charMs = positiveNumber(options.charMs, FLAP_CHAR_MS);
  const baseStagger = positiveNumber(options.staggerMs, FLAP_STAGGER_MS);
  const maxTotalMs = positiveNumber(options.maxTotalMs, FLAP_MAX_TOTAL_MS);

  // Code-point safe: HUD labels carry separators like '·' and degree signs.
  const fromChars = Array.from(String(fromText ?? ''));
  const toChars = Array.from(String(toText ?? ''));
  const width = Math.max(fromChars.length, toChars.length);

  let firstChanged = -1;
  let lastChanged = -1;
  for (let index = 0; index < width; index += 1) {
    if ((fromChars[index] ?? '') !== (toChars[index] ?? '')) {
      if (firstChanged < 0) firstChanged = index;
      lastChanged = index;
    }
  }

  if (firstChanged < 0) {
    return {
      cells: [],
      durationMs: 0,
      staggerMs: 0,
      changedCount: 0,
      firstChanged: -1,
      lastChanged: -1,
    };
  }

  // Compress the stagger so the whole cascade fits the budget.
  const span = lastChanged - firstChanged + 1;
  const room = Math.max(0, maxTotalMs - charMs);
  const staggerMs = span > 1 ? Math.min(baseStagger, room / (span - 1)) : 0;

  const cells: SplitFlapCell[] = [];
  let changedCount = 0;
  for (let index = 0; index < width; index += 1) {
    const from = fromChars[index] ?? '';
    const to = toChars[index] ?? '';
    const changed = from !== to;
    if (changed) changedCount += 1;
    cells.push({
      index,
      from,
      to,
      changed,
      vacating: changed && to === '' && from !== '',
      delayMs: changed ? Math.round((index - firstChanged) * staggerMs) : 0,
    });
  }

  return {
    cells,
    durationMs: Math.round((lastChanged - firstChanged) * staggerMs + charMs),
    staggerMs,
    changedCount,
    firstChanged,
    lastChanged,
  };
}

/**
 * What one column shows, before or after it turns over. A column with no glyph
 * on the requested side is a reserved blank, not an absence — it is still on
 * the board holding its width and index.
 */
function displayedGlyph(cell: SplitFlapCell, turned: boolean): string {
  if (!cell.changed) return cell.to;
  return (turned ? cell.to : cell.from) || BLANK;
}

/**
 * The glyphs a cascade is actually showing at `elapsedMs`.
 *
 * The result is positionally true by construction — exactly one character per
 * column — so index N of the string is always column N of the board. This is
 * what an interrupting change must flap away from.
 *
 * Pure: no DOM.
 */
export function visibleGlyphs(
  plan: SplitFlapPlan | null | undefined,
  elapsedMs: number,
  options: { charMs?: number; turnRatio?: number } = {},
): string {
  const charMs = positiveNumber(options.charMs, FLAP_CHAR_MS);
  const turnRatio = Number.isFinite(Number(options.turnRatio))
    ? Number(options.turnRatio)
    : FLAP_TURN_RATIO;
  const elapsed = Number.isFinite(Number(elapsedMs)) ? Math.max(0, Number(elapsedMs)) : 0;
  const turn = charMs * turnRatio;
  let out = '';
  for (const cell of plan?.cells ?? []) {
    out += displayedGlyph(cell, elapsed >= cell.delayMs + turn);
  }
  return out;
}

interface FlapState {
  plan: SplitFlapPlan;
  charMs: number;
  startedAt: number;
  timer: number;
}

/** In-flight cascade state, keyed by element so nothing is stored on the node. */
const flapStates = new WeakMap<HTMLElement, FlapState>();

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Is the element actually on screen? HUD readouts sit inside containers that
 * fade to `opacity: 0` when the stage is dismissed, and those still report
 * client rects — so a naive check would animate a readout nobody can see.
 */
function isVisible(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  if (typeof element.checkVisibility === 'function') {
    return element.checkVisibility({
      opacityProperty: true,
      visibilityProperty: true,
      contentVisibilityAuto: true,
    });
  }
  return element.getClientRects().length > 0;
}

interface FlapHost {
  text: HTMLElement;
  cells: HTMLElement;
}

/**
 * The readout's permanent shell. Built once per element and reused forever, so
 * a label change never reparents anything (invariant 1). Rebuilt only if
 * something outside this module clobbered the children.
 */
function ensureHost(element: HTMLElement): FlapHost {
  // O(1) happy path: this runs on every HUD tick, including no-change ticks.
  const text = element.firstElementChild as HTMLElement | null;
  const cells = text?.nextElementSibling as HTMLElement | null;
  if (
    text?.classList.contains(TEXT_CLASS)
    && text.firstChild?.nodeType === 3
    && cells?.classList.contains(CELLS_CLASS)
    && !cells.nextElementSibling
  ) {
    return { text, cells };
  }

  const doc = element.ownerDocument;
  const carried = element.textContent ?? '';
  const nextText = doc.createElement('span');
  nextText.className = TEXT_CLASS;
  nextText.append(doc.createTextNode(carried));
  const nextCells = doc.createElement('span');
  nextCells.className = CELLS_CLASS;
  // Decorative only, so rebuilding it cannot disturb an aria-live region.
  nextCells.setAttribute('aria-hidden', 'true');
  element.classList.add(HOST_CLASS);
  element.replaceChildren(nextText, nextCells);
  return { text: nextText, cells: nextCells };
}

/** Put the label back to rest: real text visible, no decorative cells. */
function rest(element: HTMLElement, host: FlapHost): void {
  element.classList.remove(ACTIVE_CLASS);
  host.cells.replaceChildren();
  element.style.removeProperty('--wm-flap-dur');
}

function clearFlapTimer(element: HTMLElement): void {
  const state = flapStates.get(element);
  if (!state) return;
  window.clearTimeout(state.timer);
  flapStates.delete(element);
}

/** Strip the decorative cells once the cascade lands. */
function settle(element: HTMLElement, expected: string): void {
  flapStates.delete(element);
  // A newer label won the race — leave its cells alone.
  if (element.textContent !== expected) return;
  rest(element, ensureHost(element));
}

/**
 * Set a readout label, flipping the changed characters into place.
 *
 * Safe to call on every tick: an unchanged write is a no-op, or the animation
 * would restart forever.
 *
 * @returns whether a flap animation was actually started.
 */
export function setSplitFlapText(
  element: HTMLElement | null,
  text: string,
  options: SplitFlapOptions & { immediate?: boolean } = {},
): boolean {
  if (!element) return false;
  const next = String(text ?? '');
  // Upgrade to the permanent shell first, so that one-time structural change
  // happens on a tick where the text is not changing (invariant 1).
  const host = ensureHost(element);
  const settled = element.textContent ?? '';
  if (settled === next) return false;

  // What the viewer can SEE right now. Mid-cascade that is not the settled
  // string: columns whose stagger has not elapsed still show the old glyphs,
  // and those are what must flap away (invariant 3).
  const state = flapStates.get(element);
  const displayed = state
    ? visibleGlyphs(state.plan, performance.now() - state.startedAt, { charMs: state.charMs })
    : settled;
  clearFlapTimer(element);

  const animate = options.immediate !== true
    && !prefersReducedMotion()
    && isVisible(element);
  const plan = animate ? planSplitFlap(displayed, next, options) : null;

  // THE ONLY TEXT OPERATION — one characterData mutation, no reparenting.
  const textNode = host.text.firstChild;
  if (textNode) textNode.nodeValue = next;

  if (!plan?.changedCount) {
    rest(element, host);
    return false;
  }

  const doc = element.ownerDocument;
  const charMs = positiveNumber(options.charMs, FLAP_CHAR_MS);
  const cellNodes: HTMLElement[] = [];
  for (const cell of plan.cells) {
    const node = doc.createElement('span');
    node.className = CELL_CLASS;
    // Every column carries an in-flow incoming face, so every column holds a
    // width and its index for the whole cascade.
    node.dataset.flapNext = cell.to || BLANK;
    if (cell.changed) {
      node.classList.add(FLAPPING_CLASS);
      node.dataset.flapPrev = cell.from || BLANK;
      node.style.setProperty('--wm-flap-delay', `${cell.delayMs}ms`);
    }
    cellNodes.push(node);
  }

  // Only the decorative sibling is rebuilt; the text node is not involved.
  host.cells.replaceChildren(...cellNodes);
  element.classList.add(ACTIVE_CLASS);
  element.style.setProperty('--wm-flap-dur', `${charMs}ms`);

  flapStates.set(element, {
    plan,
    charMs,
    startedAt: performance.now(),
    timer: window.setTimeout(
      () => settle(element, next),
      plan.durationMs + FLAP_SETTLE_SLACK_MS,
    ),
  });
  return true;
}
