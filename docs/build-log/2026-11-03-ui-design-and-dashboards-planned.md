# 2026-11-03 — UI design and dashboards planned

- **Decided (Andy, ADR-0045: UI design system, pluggable design skills (Hallmark first) and dashboards, in M5):** all in M5: Epics + story board: `apps/web/design.md` + tokens as the design source of truth; design skills pluggable per project, with a Hallmark trial on one screen (it targets HTML pages, unproven on React/shadcn); Playwright screenshots + `sloplint` as a non-blocking check; a Dashboards screen fed by the M1.8: Build + gate run metrics.
- **Decided (Andy):** deploying the control plane itself to dev + prod is planned last (ARCHITECTURE §12 Later), reusing M6: Dev → prod releases' pipeline.
