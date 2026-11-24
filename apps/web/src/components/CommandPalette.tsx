import { useId, useRef, useState, type KeyboardEvent } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useNavigate } from "@tanstack/react-router";
import { Dialog, DialogOverlay, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import {
  keyCaps,
  matchesQuery,
  searchTickets,
  type PaletteGroup,
  type PaletteItem,
} from "@/lib/command-palette";
import { usePaletteTickets, useProjects } from "@/lib/queries";
import { scopePath, type Scope, type Section } from "@/lib/scope";
import { shellLinks } from "@/lib/shell-routes";
import { SHORTCUTS, type ShortcutCommand } from "@/lib/shortcuts";
import { THEMES, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const GROUPS: readonly PaletteGroup[] = ["Tickets", "Actions", "Go to", "Projects"];

/**
 * The command palette (AI-370): Cmd+K (Ctrl+K elsewhere) or the sidebar's "Search and commands".
 * Finds a ticket by key or title in the current scope and runs every shortcut that is a command
 * (`SHORTCUTS[].command`), the theme switch, any shell page and a project switch. Built on the
 * Dialog (AI-369): Radix traps focus, closes on Esc and returns focus to where it was.
 */
export function CommandPalette(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: Scope;
  section: Section | null;
  runCommand: (command: ShortcutCommand) => void;
}) {
  const { open, onOpenChange } = props;
  // Opened by a shortcut there is no trigger for Radix to refocus, so keep where focus was.
  const returnTo = useRef<HTMLElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            returnTo.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            returnTo.current?.focus();
          }}
          className="fixed top-[12vh] left-1/2 z-50 flex max-h-[70vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 animate-enter flex-col overflow-hidden rounded-lg border border-border bg-raised text-foreground shadow-md"
        >
          <DialogTitle className="sr-only">Search and commands</DialogTitle>
          {open && <PaletteBody {...props} close={() => onOpenChange(false)} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}

function PaletteBody(props: {
  scope: Scope;
  section: Section | null;
  runCommand: (command: ShortcutCommand) => void;
  close: () => void;
}) {
  const { scope, section, runCommand, close } = props;
  const navigate = useNavigate();
  const projects = useProjects();
  const [theme, setTheme] = useTheme();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();

  const inScope = (projects.data ?? []).filter(
    (p) => scope.kind === "all" || p.id === scope.projectId,
  );
  const tickets = usePaletteTickets(
    inScope.map((p) => p.id),
    true,
  );
  const nameOf = new Map((projects.data ?? []).map((p) => [p.id, p.name]));

  /** Close first, so focus is back where it was before the command acts on it (j, k). */
  const run = (fn: () => void) => () => {
    close();
    setTimeout(fn, 0);
  };
  const go = (to: string) => run(() => void navigate({ href: to }));

  const actions: PaletteItem[] = SHORTCUTS.filter((s) => s.command).map((s) => ({
    id: `shortcut:${s.keys}`,
    group: "Actions",
    label: s.does,
    keys: keyCaps(s.keys),
    run: run(() => runCommand(s.command!)),
  }));
  for (const t of THEMES)
    if (t.value !== theme)
      actions.push({
        id: `theme:${t.value}`,
        group: "Actions",
        label: `Theme: switch to ${t.label.toLowerCase()}`,
        run: run(() => setTheme(t.value)),
      });
  const pages: PaletteItem[] = shellLinks(scope).map((l) => ({
    id: `go:${l.to}`,
    group: "Go to",
    label: l.label,
    keywords: "go open page",
    run: go(l.to),
  }));
  const switches: PaletteItem[] = (projects.data ?? []).map((p) => ({
    id: `project:${p.id}`,
    group: "Projects",
    label: p.name,
    hint: p.key,
    keywords: "project switch",
    run: go(scopePath({ kind: "project", projectId: p.id }, section ?? "inbox")),
  }));
  switches.push({
    id: "project:all",
    group: "Projects",
    label: "All projects",
    keywords: "project switch",
    run: go(scopePath({ kind: "all" }, section ?? "inbox")),
  });
  const commands = [...actions, ...pages, ...switches];

  const ticketItems: PaletteItem[] = searchTickets(
    tickets.tickets.map((t) => ({
      projectId: t.projectId,
      projectName: nameOf.get(t.projectId) ?? t.projectId,
      key: t.key,
      title: t.title,
      stage: t.stage,
    })),
    query,
  ).map((t) => ({
    id: `ticket:${t.key}`,
    group: "Tickets",
    label: t.title,
    keys: [t.key],
    hint: `${t.projectName} · ${stageLabel(t.stage)}`,
    run: go(`/p/${encodeURIComponent(t.projectId)}/t/${encodeURIComponent(t.key)}`),
  }));
  const items = [...ticketItems, ...commands.filter((c) => matchesQuery(c, query))];
  const current = Math.min(active, Math.max(items.length - 1, 0));

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length === 0) return;
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActive((current + delta + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[current]?.run();
    }
  }

  const optionId = (i: number) => `${listId}-${i}`;
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-4">
        <input
          role="combobox"
          aria-label="Search tickets and commands"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={items.length ? optionId(current) : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search tickets by key or title, or type a command"
          className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-md"
        />
        <span className="hidden shrink-0 font-mono text-xs text-muted-foreground sm:inline">
          Esc to close
        </span>
      </div>
      <div id={listId} role="listbox" aria-label="Results" className="overflow-y-auto py-1">
        {items.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            {tickets.pending ? "Reading tickets…" : "Nothing matches."}
          </p>
        )}
        {GROUPS.map((group) => {
          const inGroup = items
            .map((item, i) => ({ item, i }))
            .filter((x) => x.item.group === group);
          if (inGroup.length === 0) return null;
          return (
            <div key={group} role="group" aria-label={group}>
              <div aria-hidden className="px-4 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                {group}
              </div>
              {inGroup.map(({ item, i }) => (
                <PaletteOption
                  key={item.id}
                  id={optionId(i)}
                  item={item}
                  selected={i === current}
                  onHover={() => setActive(i)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

function PaletteOption(props: {
  id: string;
  item: PaletteItem;
  selected: boolean;
  onHover: () => void;
}) {
  const { id, item, selected, onHover } = props;
  const ticket = item.group === "Tickets";
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      onMouseMove={onHover}
      onClick={item.run}
      className={cn(
        "flex min-h-11 cursor-default items-center gap-2 px-4 text-sm sm:min-h-9",
        selected && "bg-selected",
      )}
    >
      {ticket && (
        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
          {item.keys?.[0]}
        </span>
      )}
      <span className="truncate">{item.label}</span>
      {item.hint && (
        <span className="ml-auto shrink-0 truncate pl-2 text-xs text-muted-foreground">
          {item.hint}
        </span>
      )}
      {!ticket && item.keys && (
        <span className={cn("flex shrink-0 gap-1", !item.hint && "ml-auto")}>
          {item.keys.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </span>
      )}
    </div>
  );
}

const STAGE_LABEL: Record<string, string> = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In progress",
  ready_for_review: "Ready for review",
  done: "Done",
  cancelled: "Cancelled",
};
const stageLabel = (stage: string) => STAGE_LABEL[stage] ?? stage;
