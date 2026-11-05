import { createContext, useContext, useEffect, type ReactNode } from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Check, ChevronsUpDown, Layers, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { waitingCounts } from "@/lib/needs-you";
import { useNeedsYou, useProjects } from "@/lib/queries";
import {
  ALL,
  loadScope,
  saveScope,
  scopeFromPath,
  scopeKey,
  scopePath,
  sectionFromPath,
  type Scope,
  type Section,
} from "@/lib/scope";
import { cn } from "@/lib/utils";

/** Extra header controls from outside the router (the signed-in App adds Sign out). */
export const HeaderEndContext = createContext<ReactNode>(null);

/**
 * The one layout for every screen (design.md): project picker, navigation, "Needs you N".
 * The scope comes from the URL; screens outside a scope (settings) show the remembered one.
 */
export function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const urlScope = scopeFromPath(pathname);
  const scope = urlScope ?? loadScope();
  const section = sectionFromPath(pathname);

  useEffect(() => {
    const seen = scopeFromPath(pathname);
    if (seen) saveScope(seen);
  }, [pathname]);

  return (
    <div className="min-h-screen">
      <header className="flex h-12 items-center gap-4 border-b border-border px-4 sm:px-6">
        <ProjectPicker scope={scope} section={section ?? "inbox"} />
        <nav aria-label="Main" className="flex items-center gap-1">
          <NavLink to={scopePath(scope, "board")} current={section === "board"}>
            Board
          </NavLink>
          <NavLink to={scopePath(scope, "inbox")} current={section === "inbox"}>
            Inbox
          </NavLink>
          <NavLink to="/settings/github" current={pathname.startsWith("/settings")}>
            Settings
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <NeedsYouCount />
          {useContext(HeaderEndContext)}
        </div>
      </header>
      <main className="px-4 py-4 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}

function NavLink(props: { to: string; current: boolean; children: ReactNode }) {
  return (
    <Link
      to={props.to}
      aria-current={props.current ? "page" : undefined}
      className={cn(
        "rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground",
        props.current && "bg-muted text-foreground",
      )}
    >
      {props.children}
    </Link>
  );
}

/** The global scope: pick a project like a tenant, or All projects. Keeps the current screen. */
function ProjectPicker({ scope, section }: { scope: Scope; section: Section }) {
  const projects = useProjects();
  const needsYou = useNeedsYou();
  const navigate = useNavigate();
  const counts = needsYou.data ? waitingCounts(needsYou.data) : null;
  const current =
    scope.kind === "project" ? projects.data?.find((p) => p.id === scope.projectId) : undefined;
  const go = (to: Scope) => void navigate({ to: scopePath(to, section) });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="-ml-2 gap-2 px-2 font-medium">
          {scope.kind === "all" ? (
            <>
              <Layers aria-hidden className="size-4 text-muted-foreground" />
              All projects
            </>
          ) : (
            <>
              <KeyBadge>{current?.key ?? scope.projectId.toUpperCase()}</KeyBadge>{" "}
              <span className="max-w-48 truncate">{current?.name ?? scope.projectId}</span>
            </>
          )}
          <ChevronsUpDown aria-hidden className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Projects</DropdownMenuLabel>
        {projects.data?.map((p) => {
          const to: Scope = { kind: "project", projectId: p.id };
          return (
            <PickerItem
              key={p.id}
              selected={scopeKey(scope) === scopeKey(to)}
              waiting={counts?.byProject.get(p.id) ?? 0}
              onSelect={() => go(to)}
            >
              <KeyBadge>{p.key}</KeyBadge> <span className="truncate">{p.name}</span>
            </PickerItem>
          );
        })}
        {projects.data?.length === 0 && (
          <p className="px-2 py-1 text-xs text-muted-foreground">No projects yet.</p>
        )}
        <DropdownMenuSeparator />
        <PickerItem
          selected={scope.kind === "all"}
          waiting={counts?.total ?? 0}
          onSelect={() => go(ALL)}
        >
          <Layers aria-hidden className="size-4 text-muted-foreground" />
          All projects
        </PickerItem>
        <DropdownMenuItem onSelect={() => void navigate({ to: "/projects" })}>
          <Plus aria-hidden className="size-4 text-muted-foreground" />
          Add project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PickerItem(props: {
  selected: boolean;
  waiting: number;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenuItem onSelect={props.onSelect} aria-current={props.selected ? "true" : undefined}>
      {props.children}
      <span className="ml-auto flex items-center gap-2 pl-4">
        {props.waiting > 0 && (
          <Badge variant="attention" aria-label={`${props.waiting} waiting on you`}>
            {props.waiting}
          </Badge>
        )}
        <Check aria-hidden className={cn("size-4", !props.selected && "invisible")} />
      </span>
    </DropdownMenuItem>
  );
}

/** A project's key, e.g. "AI": the tenant mark beside its name. */
function KeyBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-primary px-1 text-xs font-semibold text-primary-foreground">
      {children}
    </span>
  );
}

/** Items waiting on the viewer across every project; opens that inbox. */
function NeedsYouCount() {
  const needsYou = useNeedsYou();
  const total = needsYou.data ? waitingCounts(needsYou.data).total : null;
  return (
    <Link
      to={scopePath(ALL, "inbox")}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium tabular-nums",
        total ? "bg-attention/15 text-attention" : "text-muted-foreground hover:bg-muted",
      )}
    >
      Needs you <span>{total ?? "–"}</span>
    </Link>
  );
}
