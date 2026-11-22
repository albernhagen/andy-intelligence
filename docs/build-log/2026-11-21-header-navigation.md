# 2026-11-21 — AI-335: Header: six destinations and an account menu

From the AI-322 UX review (larger change 1).

- **Destinations:** `AppShell.tsx` `destinations()` returns Inbox, Board, Roadmap, Work, Dashboards, plus What's new in a project. Under All projects there are five, because What's new is per project. The phone bar shows the destinations that have icons (Inbox, Board, Dashboards); More lists the rest in the same order.
- **Settings menu:** a gear button (`aria-label` "Settings") lists `settingsTabs(scope)` from `lib/scope.ts`: Project settings while a project is in scope, then GitHub, Local runners and Models, then the signed-in app's Sign out. More on a phone lists the same items after a separator.
- **Settings tabs:** `components/SettingsTabs.tsx` replaces the underlined `SettingsNav` and also tops the project settings page. Off a project URL it uses the remembered scope, so Models opened from a project still offers Project settings.
- **Digest:** removed from the header. What's new links to it, as the digest already linked back. AI-341 folds it into What's new. Every route is unchanged.
- **Parity:** navigation only; no action moved, so `parity.ts` needs no change.
- **Screenshots:** every screen's header changed; all of them were re-rendered in the CI image.
