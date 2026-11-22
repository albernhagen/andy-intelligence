import { createContext, isValidElement, useContext, useEffect, type ReactNode } from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ChartColumn,
  Check,
  ChevronsUpDown,
  Ellipsis,
  Inbox,
  Layers,
  Plus,
  Settings,
  SquareKanban,
  type LucideIcon,
} from "lucide-react";
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
import { PhonePauseButton } from "@/components/DispatchControls";
import { LiveUpdatesBanner } from "@/components/LiveUpdatesBanner";
import { QuotaBanner } from "@/components/QuotaBanner";
import { QuotaGauge } from "@/components/QuotaGauge";
import { waitingCounts } from "@/lib/needs-you";
import { useNeedsYou, useProjects } from "@/lib/queries";
import {
  ALL,
  loadScope,
  saveScope,
  settingsTabs,
  scopeFromPath,
  scopeKey,
  scopePath,
  sectionFromPath,
  type Scope,
  type Section,
} from "@/lib/scope";
import { useIsPhone } from "@/lib/use-phone";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";
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

  const phone = useIsPhone();
  const headerEnd = useContext(HeaderEndContext);
  const links = destinations(scope, pathname, section);
  const settings = settingsLinks(scope, pathname);

  return (
    <div className="min-h-screen">
      {/* Safe-area insets keep the header clear of the iPhone status bar when installed. */}
      <header className="flex h-[calc(3rem+env(safe-area-inset-top))] items-center gap-2 border-b border-border px-4 pt-[env(safe-area-inset-top)] sm:gap-4 sm:px-6">
        <ProjectPicker scope={scope} section={section ?? "inbox"} />
        {!phone && (
          <nav aria-label="Main" className="flex items-center gap-1 text-sm">
            {links.map((l) => (
              <NavLink key={l.label} to={l.to} current={l.current}>
                {l.label}
              </NavLink>
            ))}
          </nav>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <QuotaGauge />
          <PhonePauseButton scope={scope} />
          <NeedsYouCount />
          {/* On a phone settings and Sign out move under More, so the header fits 390px. */}
          {!phone && <SettingsMenu links={settings} headerEnd={headerEnd} />}
        </div>
      </header>
      <LiveUpdatesBanner />
      <QuotaBanner />
      <main
        className={cn("px-4 py-4 sm:px-6", phone && "pb-[calc(5rem+env(safe-area-inset-bottom))]")}
      >
        <Outlet />
      </main>
      {phone && <PhoneNav links={links} settings={settings} headerEnd={headerEnd} />}
      <KeyboardShortcuts scope={scope} />
    </div>
  );
}

interface NavItem {
  label: string;
  to: string;
  current: boolean;
  /** Shown in the phone's bottom bar; the rest go under More. */
  icon?: LucideIcon;
}

/**
 * The header's destinations (AI-335), one list for both layouts so desktop and phone never offer
 * different screens. Inbox leads: it is where Andy decides. What's new is per project.
 */
function destinations(scope: Scope, pathname: string, section: Section | null): NavItem[] {
  const items: NavItem[] = [
    { label: "Inbox", to: scopePath(scope, "inbox"), current: section === "inbox", icon: Inbox },
    {
      label: "Board",
      to: scopePath(scope, "board"),
      current: section === "board",
      icon: SquareKanban,
    },
    // AI-202 and AI-198: under More on a phone (no icon).
    { label: "Roadmap", to: scopePath(scope, "roadmap"), current: section === "roadmap" },
    { label: "Work", to: scopePath(scope, "work"), current: section === "work" },
    {
      label: "Dashboards",
      to: scopePath(scope, "dashboards"),
      current: section === "dashboards",
      icon: ChartColumn,
    },
  ];
  if (scope.kind === "project")
    items.push({
      label: "What's new",
      to: `/p/${encodeURIComponent(scope.projectId)}/whats-new`,
      current: /\/whats-new\/?$/.test(pathname),
    });
  return items;
}

/** The Settings menu's pages: this project's settings while one is in scope, then global ones. */
function settingsLinks(scope: Scope, pathname: string): NavItem[] {
  return settingsTabs(scope).map((t) => ({ ...t, current: pathname === t.to }));
}

/**
 * Phone navigation: a bottom bar in thumb reach, 44px targets, the rest under More. Below the
 * ticket panel (z-30), so a panel opened full-screen covers it until closed.
 */
function PhoneNav(props: { links: NavItem[]; settings: NavItem[]; headerEnd: ReactNode }) {
  const { links, settings, headerEnd } = props;
  const navigate = useNavigate();
  const more = links.filter((l) => !l.icon);
  const item = (l: NavItem) => (
    <DropdownMenuItem
      key={l.label}
      className="min-h-11"
      aria-current={l.current ? "page" : undefined}
      onSelect={() => void navigate({ to: l.to })}
    >
      {l.label}
    </DropdownMenuItem>
  );
  const target = "flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-xs";
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-background px-2 pb-[env(safe-area-inset-bottom)]"
    >
      {links
        .filter((l) => l.icon)
        .map(({ label, to, current, icon: Icon }) => (
          <Link
            key={label}
            to={to}
            aria-current={current ? "page" : undefined}
            className={cn(target, current ? "text-foreground" : "text-muted-foreground")}
          >
            {Icon && <Icon aria-hidden className="size-5" />}
            {label}
          </Link>
        ))}
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            target,
            [...more, ...settings].some((l) => l.current)
              ? "text-foreground"
              : "text-muted-foreground",
          )}
        >
          <Ellipsis aria-hidden className="size-5" />
          More
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top">
          {more.map(item)}
          <DropdownMenuSeparator />
          {settings.map(item)}
          <SignOutItem headerEnd={headerEnd} className="min-h-11" />
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}

/** Desktop: one menu for every settings page and Sign out, so the header stays short (AI-335). */
function SettingsMenu({ links, headerEnd }: { links: NavItem[]; headerEnd: ReactNode }) {
  const navigate = useNavigate();
  const current = links.some((l) => l.current);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Settings"
          className={cn("text-muted-foreground", current && "bg-muted text-foreground")}
        >
          <Settings aria-hidden className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {links.map((l) => (
          <DropdownMenuItem
            key={l.label}
            aria-current={l.current ? "page" : undefined}
            onSelect={() => void navigate({ to: l.to })}
          >
            {l.label}
          </DropdownMenuItem>
        ))}
        <SignOutItem headerEnd={headerEnd} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The signed-in app's Sign out (HeaderEndContext), as the last menu item. */
function SignOutItem({ headerEnd, className }: { headerEnd: ReactNode; className?: string }) {
  if (!isValidElement(headerEnd)) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild className={cn("w-full justify-start", className)}>
        {headerEnd}
      </DropdownMenuItem>
    </>
  );
}

function NavLink(props: { to: string; current: boolean; children: ReactNode }) {
  return (
    <Link
      to={props.to}
      aria-current={props.current ? "page" : undefined}
      className={cn(
        "whitespace-nowrap rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground",
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
        <Button variant="ghost" size="sm" className="-ml-2 h-11 gap-2 px-2 font-medium sm:h-8">
          {scope.kind === "all" ? (
            <>
              <Layers aria-hidden className="size-4 text-muted-foreground" />
              All projects
            </>
          ) : (
            <>
              <KeyBadge>{current?.key ?? scope.projectId.toUpperCase()}</KeyBadge>{" "}
              <span className="max-w-48 truncate max-sm:sr-only">
                {current?.name ?? scope.projectId}
              </span>
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
        <DropdownMenuItem onSelect={() => void navigate({ to: "/projects/new" })}>
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

/** Things to answer (questions and flagged tickets) across every project; opens that inbox. */
function NeedsYouCount() {
  const needsYou = useNeedsYou();
  const total = needsYou.data ? waitingCounts(needsYou.data).total : null;
  return (
    <Link
      to={scopePath(ALL, "inbox")}
      title={
        total === null
          ? undefined
          : `${total} question${total === 1 ? "" : "s"} or flagged ticket${total === 1 ? "" : "s"} to answer`
      }
      className={cn(
        "inline-flex h-11 items-center gap-1.5 whitespace-nowrap sm:h-7 rounded-md px-2 text-xs font-medium tabular-nums",
        total ? "bg-attention/15 text-attention" : "text-muted-foreground hover:bg-muted",
      )}
    >
      Needs you <span>{total ?? "–"}</span>
    </Link>
  );
}
