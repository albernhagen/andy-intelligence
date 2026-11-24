import {
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Check, ChevronsUpDown, Ellipsis, Layers, Plus, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PhonePauseButton } from "@/components/DispatchControls";
import { LiveUpdatesBanner } from "@/components/LiveUpdatesBanner";
import { QuotaBanner } from "@/components/QuotaBanner";
import { QuotaGauge, QuotaMeters } from "@/components/QuotaGauge";
import { Kbd } from "@/components/ui/kbd";
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
import { destinations, settingsLinks, type NavItem } from "@/lib/shell-routes";
import { THEMES, useTheme, type Theme } from "@/lib/theme";
import { useIsPhone } from "@/lib/use-phone";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";
import { cn } from "@/lib/utils";

/** Extra header controls from outside the router (the signed-in App adds Sign out). */
export const HeaderEndContext = createContext<ReactNode>(null);

/**
 * The one layout for every screen (design.md). Desktop: a left sidebar with the project picker,
 * the six destinations, the projects (or the settings pages), the quota and the command palette
 * (AI-370). Phone: a header and a bottom bar (AI-173). The scope comes from the URL; screens
 * outside a scope (settings) show the remembered one.
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const links = destinations(scope, pathname, section);
  const settings = settingsLinks(scope, pathname);
  const shortcuts = (
    <KeyboardShortcuts
      scope={scope}
      section={section}
      paletteOpen={paletteOpen}
      setPaletteOpen={setPaletteOpen}
    />
  );

  if (phone)
    return (
      <div className="min-h-screen">
        {/* Safe-area insets keep the header clear of the iPhone status bar when installed. */}
        <header className="flex h-[calc(3rem+env(safe-area-inset-top))] items-center gap-2 border-b border-border px-4 pt-[env(safe-area-inset-top)]">
          <ProjectPicker scope={scope} section={section ?? "inbox"} />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <QuotaGauge />
            <PhonePauseButton scope={scope} />
            <NeedsYouCount />
          </div>
        </header>
        <LiveUpdatesBanner />
        <QuotaBanner />
        <main className="px-4 py-4 pb-[calc(5rem+env(safe-area-inset-bottom))]">
          <Outlet />
        </main>
        <PhoneNav links={links} settings={settings} headerEnd={headerEnd} />
        {shortcuts}
      </div>
    );

  return (
    <div className="flex min-h-screen">
      <Sidebar
        scope={scope}
        section={section}
        pathname={pathname}
        links={links}
        settings={settings}
        headerEnd={headerEnd}
        openPalette={() => setPaletteOpen(true)}
      />
      <div className="min-w-0 flex-1">
        <LiveUpdatesBanner />
        <QuotaBanner />
        <main className="px-4 py-4 sm:px-6">
          <Outlet />
        </main>
      </div>
      {shortcuts}
    </div>
  );
}

/** Settings screens swap the sidebar's Projects group for the settings pages (mockup). */
const isSettingsPath = (pathname: string) =>
  /^\/settings\//.test(pathname) || /^\/p\/[^/]+\/settings\/?$/.test(pathname);

/**
 * The desktop sidebar (AI-370; mockup `screen-shell.png`). Plain links and buttons in reading
 * order, so Tab walks it top to bottom and Enter opens; the current page is `aria-current`.
 */
function Sidebar(props: {
  scope: Scope;
  section: Section | null;
  pathname: string;
  links: NavItem[];
  settings: NavItem[];
  headerEnd: ReactNode;
  openPalette: () => void;
}) {
  const { scope, section, pathname, links, settings, headerEnd, openPalette } = props;
  const needsYou = useNeedsYou();
  const counts = needsYou.data ? waitingCounts(needsYou.data) : null;
  const inboxCount =
    counts && (scope.kind === "all" ? counts.total : (counts.byProject.get(scope.projectId) ?? 0));
  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-muted px-2 py-3">
      <ProjectPicker scope={scope} section={section ?? "inbox"} wide />
      <nav aria-label="Main" aria-busy={!counts} className="mt-2 flex flex-col gap-0.5">
        {links.map((l) => (
          <SideLink key={l.label} item={l} count={l.label === "Inbox" ? inboxCount : null} />
        ))}
      </nav>
      {isSettingsPath(pathname) ? (
        <nav aria-label="Settings" className="flex flex-col gap-0.5">
          <SideGroupLabel>Settings</SideGroupLabel>
          {settings.map((l) => (
            <SideLink key={l.label} item={l} />
          ))}
        </nav>
      ) : (
        <ProjectsGroup scope={scope} section={section} counts={counts} />
      )}
      <div className="mt-auto space-y-3 px-2 pt-6">
        <QuotaMeters />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={openPalette}
            aria-keyshortcuts="Meta+K Control+K"
            className="-ml-2 flex h-8 flex-1 items-center justify-between gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-raised hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="whitespace-nowrap">Search and commands</span>
            <Kbd>⌘K</Kbd>
          </button>
          <SettingsMenu links={settings} headerEnd={headerEnd} />
        </div>
      </div>
    </aside>
  );
}

/** The projects with their Needs-you counts; picking one keeps the current screen. */
function ProjectsGroup(props: {
  scope: Scope;
  section: Section | null;
  counts: ReturnType<typeof waitingCounts> | null;
}) {
  const { scope, section, counts } = props;
  const projects = useProjects();
  if (!projects.data?.length) return null;
  return (
    <nav aria-label="Projects" className="flex flex-col gap-0.5">
      <SideGroupLabel>Projects</SideGroupLabel>
      {projects.data.map((p) => {
        const to: Scope = { kind: "project", projectId: p.id };
        return (
          <SideLink
            key={p.id}
            item={{
              label: p.name,
              to: scopePath(to, section ?? "inbox"),
              current: scopeKey(scope) === scopeKey(to),
            }}
            count={counts?.byProject.get(p.id) ?? 0}
          />
        );
      })}
    </nav>
  );
}

function SideGroupLabel({ children }: { children: ReactNode }) {
  return (
    <h2 aria-hidden className="px-2 pt-4 pb-1 text-xs font-medium text-muted-foreground">
      {children}
    </h2>
  );
}

/** A sidebar row: label, and a Needs-you count when there is one. */
function SideLink({ item, count }: { item: NavItem; count?: number | null }) {
  return (
    <Link
      to={item.to}
      aria-current={item.current ? "page" : undefined}
      aria-label={
        count ? `${item.label} ${count} ticket${count === 1 ? "" : "s"} waiting on you` : undefined
      }
      className={cn(
        "flex h-8 items-center justify-between gap-2 rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-raised hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
        item.current && "bg-raised text-foreground ring-1 ring-border",
      )}
    >
      <span className="truncate">{item.label}</span>
      {!!count && (
        <span aria-hidden className="text-xs font-medium text-attention tabular-nums">
          {count}
        </span>
      )}
    </Link>
  );
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
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-raised px-2 pb-[env(safe-area-inset-bottom)]"
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
          <ThemeItems className="min-h-11" />
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
        <ThemeItems />
        <SignOutItem headerEnd={headerEnd} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The theme switch (ADR-0151): system, light or dark; applied at once and remembered here. */
function ThemeItems({ className }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Theme</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        aria-label="Theme"
        value={theme}
        onValueChange={(v) => setTheme(v as Theme)}
      >
        {THEMES.map((t) => (
          <DropdownMenuRadioItem key={t.value} value={t.value} className={className}>
            {t.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
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

/** The global scope: pick a project like a tenant, or All projects. Keeps the current screen. */
function ProjectPicker(props: { scope: Scope; section: Section; wide?: boolean }) {
  const { scope, section, wide } = props;
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
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-11 gap-2 px-2 font-medium sm:h-8",
            wide ? "w-full justify-start hover:bg-raised" : "-ml-2",
          )}
        >
          {scope.kind === "all" ? (
            <>
              <Layers aria-hidden className="size-4 text-muted-foreground" />
              All projects
            </>
          ) : (
            <>
              <KeyBadge>{current?.key ?? scope.projectId.toUpperCase()}</KeyBadge>{" "}
              <span className={cn("truncate max-sm:sr-only", !wide && "max-w-48")}>
                {current?.name ?? scope.projectId}
              </span>
            </>
          )}
          <ChevronsUpDown
            aria-hidden
            className={cn("size-3.5 text-muted-foreground", wide && "ml-auto")}
          />
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
          <Badge
            variant="attention"
            aria-label={`${props.waiting} ticket${props.waiting === 1 ? "" : "s"} waiting on you`}
          >
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
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-foreground px-1 text-2xs font-semibold text-background">
      {children}
    </span>
  );
}

/** Tickets waiting on Andy across every project, one per inbox card (AI-347); opens that inbox. */
function NeedsYouCount() {
  const needsYou = useNeedsYou();
  const total = needsYou.data ? waitingCounts(needsYou.data).total : null;
  return (
    <Link
      to={scopePath(ALL, "inbox")}
      title={total === null ? undefined : `${total} ticket${total === 1 ? "" : "s"} waiting on you`}
      className={cn(
        "inline-flex h-11 items-center gap-1.5 whitespace-nowrap sm:h-7 rounded-md px-2 text-xs font-medium tabular-nums",
        total ? "bg-attention/15 text-attention" : "text-muted-foreground hover:bg-muted",
      )}
    >
      Needs you <span>{total ?? "–"}</span>
    </Link>
  );
}
