import { ChartColumn, Inbox, SquareKanban, type LucideIcon } from "lucide-react";
import { scopePath, settingsTabs, type Scope, type Section } from "@/lib/scope";

/**
 * Every place the shell links to (AI-370), one list for the sidebar, the phone's bottom bar and the
 * command palette, so no layout offers a screen the others lack. A test checks every route in
 * `router.tsx` against it.
 */
export interface NavItem {
  label: string;
  to: string;
  current: boolean;
  /** Shown in the phone's bottom bar; the rest go under More. */
  icon?: LucideIcon;
}

/**
 * The six destinations (AI-335). Inbox leads: it is where Andy decides. What's new is per project.
 */
export function destinations(scope: Scope, pathname: string, section: Section | null): NavItem[] {
  const items: NavItem[] = [
    { label: "Inbox", to: scopePath(scope, "inbox"), current: section === "inbox", icon: Inbox },
    {
      label: "Board",
      to: scopePath(scope, "board"),
      current: section === "board",
      icon: SquareKanban,
    },
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
      // Releases (AI-189: M6.10) sits under What's new.
      current: /\/(whats-new|releases)\/?$/.test(pathname),
    });
  return items;
}

/** The settings pages: this project's while one is in scope, then the global ones. */
export function settingsLinks(scope: Scope, pathname: string): NavItem[] {
  return settingsTabs(scope).map((t) => ({ ...t, current: pathname === t.to }));
}

/** Screens outside the destinations and settings, reached from the picker and the palette. */
export const PROJECTS_LINKS: readonly { label: string; to: string }[] = [
  { label: "Add project", to: "/projects/new" },
];

/** Screens under a destination, reached from its page and the palette (AI-189: M6.10). */
export function projectPageLinks(scope: Scope): { label: string; to: string }[] {
  if (scope.kind !== "project") return [];
  return [{ label: "Releases", to: `/p/${encodeURIComponent(scope.projectId)}/releases` }];
}

/** Every page the shell can open in this scope: what the palette's "Go to" lists. */
export function shellLinks(scope: Scope, pathname = ""): { label: string; to: string }[] {
  return [
    ...destinations(scope, pathname, null),
    ...projectPageLinks(scope),
    ...settingsLinks(scope, pathname),
    ...PROJECTS_LINKS,
  ].map(({ label, to }) => ({ label, to }));
}

/**
 * Routes with no shell entry of their own, and how Andy reaches them. The router test fails on a
 * route that is in neither list.
 */
export const REACHED_OTHERWISE: Readonly<Record<string, string>> = {
  "/": "redirects to the remembered scope's inbox",
  "/all": "redirects to /all/inbox",
  "/projects": "opens the current project's settings, or offers a first project (AI-46)",
  "/p/$projectId/ready": "redirects to the board's Ready lane (AI-343)",
  "/p/$projectId/digest": "redirects to What's new (AI-341)",
  "/p/$projectId/t/$ticketRef":
    "a ticket: the palette finds it by key or title, or a card opens it",
  "/p/$projectId/runs/$runId": "an agent task: opened from its ticket's Activity",
  "/p/$projectId/setup":
    "a new project's setup: Add project opens it, and the board's setup bar (AI-373)",
  "/settings/github/callback": "GitHub's return address after connecting",
};
