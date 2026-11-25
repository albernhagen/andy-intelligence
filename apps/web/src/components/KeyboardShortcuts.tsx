import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { CommandPalette } from "@/components/CommandPalette";
import { scopePath, type Scope, type Section } from "@/lib/scope";
import {
  SHORTCUTS,
  isPaletteKey,
  moveFocus,
  shortcutHandler,
  type ShortcutCommand,
} from "@/lib/shortcuts";

/**
 * The shortcut layer (AI-338), mounted once in the shell: listens on the document and shows the
 * `?` list and the command palette (Cmd+K or Ctrl+K, AI-370). `g i` / `g b` / `g r` stay in the
 * current scope (one project or all projects).
 */
export function KeyboardShortcuts(props: {
  scope: Scope;
  section: Section | null;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
}) {
  const { scope, section, paletteOpen, setPaletteOpen } = props;
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);
  // The listener is added once; it reads the latest scope through the ref.
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const helpRef = useRef(helpOpen);
  helpRef.current = helpOpen;

  useEffect(() => {
    const onKeyDown = shortcutHandler({
      go: (target) => void navigate({ href: scopePath(scopeRef.current, target) }),
      toggleHelp: () => setHelpOpen((open) => !open),
      helpOpen: () => helpRef.current,
    });
    // Cmd+K works even while typing in a field; the browser's own Cmd+K is not wanted here.
    const onPaletteKey = (e: KeyboardEvent) => {
      if (!isPaletteKey(e) || e.defaultPrevented) return;
      e.preventDefault();
      setHelpOpen(false);
      setPaletteOpen(true);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keydown", onPaletteKey);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keydown", onPaletteKey);
    };
  }, [navigate, setPaletteOpen]);

  const runCommand = (command: ShortcutCommand) => {
    if (command.kind === "go") void navigate({ href: scopePath(scope, command.target) });
    else if (command.kind === "move") moveFocus(command.delta);
    else setHelpOpen(true);
  };

  return (
    <>
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        scope={scope}
        section={section}
        runCommand={runCommand}
      />
    </>
  );
}

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    // Capture phase, so Esc closes this list before the ticket panel sees it.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-foreground/20 p-4 pt-16">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-help-title"
        className="w-full max-w-md space-y-3 animate-enter rounded-lg border border-border bg-raised p-4 text-sm"
      >
        <div className="flex items-center justify-between">
          <h2 id="shortcut-help-title" className="font-medium">
            Keyboard shortcuts
          </h2>
          <Button ref={close} type="button" size="sm" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
        <p className="text-muted-foreground">They don't work while you type in a field.</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="contents">
              <dt>
                <kbd className="rounded border border-border px-1 font-mono text-xs">{s.keys}</kbd>
              </dt>
              <dd>{s.does}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
