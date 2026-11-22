import { Link, useRouterState } from "@tanstack/react-router";
import { loadScope, scopeFromPath, settingsTabs } from "@/lib/scope";
import { cn } from "@/lib/utils";

/**
 * The tabs atop every settings page (AI-335): this project's settings while one is in scope (from
 * the URL, else the remembered scope), then GitHub, Local runners and Models.
 */
export function SettingsTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tabs = settingsTabs(scopeFromPath(pathname) ?? loadScope());
  return (
    <nav aria-label="Settings pages" className="flex flex-wrap gap-1 text-sm">
      {tabs.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          aria-current={pathname === t.to ? "page" : undefined}
          className={cn(
            "inline-flex h-11 items-center whitespace-nowrap rounded-md px-2 text-muted-foreground hover:bg-muted hover:text-foreground sm:h-8",
            pathname === t.to && "bg-muted text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
