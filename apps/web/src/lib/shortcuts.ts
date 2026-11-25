/**
 * Keyboard shortcuts (AI-338): one keydown listener, no dependency. Screens opt in by marking
 * elements, so the layer knows nothing about tickets:
 * - `data-nav-item`: a stop for `j` / `k` (an inbox row, a board card); focusable.
 * - `data-nav-group`: holds items that share one ticket (an inbox card).
 * - `data-nav-open`: the link `Enter` follows from a focused item (or from its group).
 * - `data-nav-answer`: the field `a` focuses; `data-nav-choice`: the buttons `1`–`9` focus.
 * - `data-nav-detail="<id>"` on an item: its open link, answer field and choices live in that
 *   element instead of inside the item (a list row whose detail sits beside it, AI-371); that
 *   element carries `data-nav-detail-root`, and the picked row `aria-current="true"`.
 * No single key writes anything: `1`–`9` only focus a choice, and `Enter` then presses it.
 */

/** What the command palette (AI-370) runs for a shortcut; none for keys that act on a focused item. */
export type ShortcutCommand =
  { kind: "go"; target: GoTarget } | { kind: "move"; delta: 1 | -1 } | { kind: "help" };

export interface Shortcut {
  keys: string;
  does: string;
  command?: ShortcutCommand;
}

/** Every shortcut, in the order the `?` help and `apps/web/design.md` list them. */
export const SHORTCUTS: readonly Shortcut[] = [
  {
    keys: "j",
    does: "Next ticket in the inbox, next card on the board",
    command: { kind: "move", delta: 1 },
  },
  { keys: "k", does: "Previous ticket or card", command: { kind: "move", delta: -1 } },
  { keys: "Enter", does: "Open the focused ticket; on a focused answer, choose it" },
  { keys: "a", does: "Focus the answer field of the picked ticket" },
  { keys: "1–9", does: "Focus the answer with that key (Enter chooses it)" },
  { keys: "g i", does: "Go to the inbox", command: { kind: "go", target: "inbox" } },
  { keys: "g b", does: "Go to the board", command: { kind: "go", target: "board" } },
  { keys: "g r", does: "Go to the roadmap", command: { kind: "go", target: "roadmap" } },
  { keys: "⌘K", does: "Search tickets and run a command (Ctrl+K off a Mac)" },
  { keys: "?", does: "Show these shortcuts", command: { kind: "help" } },
  { keys: "Esc", does: "Close this list or the ticket panel" },
];

/** Cmd+K on a Mac, Ctrl+K elsewhere: opens the command palette, even from a field. */
export function isPaletteKey(e: KeyboardEvent): boolean {
  return e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
}

/** How long `g` waits for its second key. */
export const SEQUENCE_MS = 1500;

export type GoTarget = "inbox" | "board" | "roadmap";
const GO_KEYS: Record<string, GoTarget> = { i: "inbox", b: "board", r: "roadmap" };

/** Typing in a field (or an editable element) never triggers a shortcut. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return (
    target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']") !==
    null
  );
}

const navItems = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>("[data-nav-item]")];

/**
 * The item holding focus (the item itself or anything inside it), if any. Focus inside a detail
 * (`data-nav-detail-root`, AI-371) belongs to the picked item (`aria-current`) pointing at it, so
 * a second number key, `a`, `j` and `k` keep working from there.
 */
export function currentItem(active: Element | null = document.activeElement): HTMLElement | null {
  if (!(active instanceof HTMLElement)) return null;
  const item = active.closest<HTMLElement>("[data-nav-item]");
  if (item) return item;
  const detail = active.closest<HTMLElement>("[data-nav-detail-root]");
  if (!detail?.id) return null;
  return (
    navItems(document).find(
      (i) => i.dataset.navDetail === detail.id && i.getAttribute("aria-current") === "true",
    ) ?? null
  );
}

function focus(el: HTMLElement) {
  el.focus();
  el.scrollIntoView?.({ block: "nearest" });
}

/** Moves focus to the next (+1) or previous (-1) item; from nowhere, `j` starts at the first. */
export function moveFocus(delta: 1 | -1, root: ParentNode = document): boolean {
  const items = navItems(root);
  if (items.length === 0) return false;
  const at = items.indexOf(currentItem() as HTMLElement);
  const next = at === -1 ? (delta === 1 ? 0 : items.length - 1) : at + delta;
  const target = items[Math.min(Math.max(next, 0), items.length - 1)]!;
  focus(target);
  return true;
}

/** Where an item's open link, answer field and choices live: its detail, else the item itself. */
function scopeOf(item: HTMLElement): ParentNode {
  const detail = item.dataset.navDetail;
  return (detail && document.getElementById(detail)) || item;
}

/** `Enter` on a focused item follows its open link; inside the item, Enter keeps its own meaning. */
function openItem(): boolean {
  const item = currentItem();
  if (!item || document.activeElement !== item) return false;
  const link =
    scopeOf(item).querySelector<HTMLElement>("[data-nav-open]") ??
    item.closest("[data-nav-group]")?.querySelector<HTMLElement>("[data-nav-open]");
  if (!link) return false;
  link.click();
  return true;
}

function focusInItem(selector: string, index = 0): boolean {
  const item = currentItem();
  const el = item && scopeOf(item).querySelectorAll<HTMLElement>(selector)[index];
  if (!el) return false;
  focus(el);
  return true;
}

export interface ShortcutActions {
  go: (target: GoTarget) => void;
  toggleHelp: () => void;
  /** True while the `?` list is open: only `?` (and its own Esc) work then. */
  helpOpen?: () => boolean;
}

/**
 * Returns the keydown handler. It keeps the `g` prefix between calls, so make one per listener.
 * A handled key calls preventDefault, so `a` doesn't also type an "a" into the field it focuses.
 */
export function shortcutHandler(actions: ShortcutActions, now: () => number = Date.now) {
  let gAt: number | null = null;
  return (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) {
      gAt = null;
      return;
    }
    if (actions.helpOpen?.() && e.key !== "?") {
      gAt = null;
      return;
    }
    const pendingG = gAt !== null && now() - gAt <= SEQUENCE_MS;
    gAt = null;
    if (pendingG && GO_KEYS[e.key]) {
      e.preventDefault();
      actions.go(GO_KEYS[e.key]!);
      return;
    }
    let handled = false;
    if (e.key === "g") {
      gAt = now();
      handled = true;
    } else if (e.key === "?") {
      actions.toggleHelp();
      handled = true;
    } else if (e.key === "j" || e.key === "k") {
      handled = moveFocus(e.key === "j" ? 1 : -1);
    } else if (e.key === "Enter") {
      handled = openItem();
    } else if (e.key === "a") {
      handled = focusInItem("[data-nav-answer]");
    } else if (/^[1-9]$/.test(e.key)) {
      handled = focusInItem("[data-nav-choice]", Number(e.key) - 1);
    }
    if (handled) e.preventDefault();
  };
}
