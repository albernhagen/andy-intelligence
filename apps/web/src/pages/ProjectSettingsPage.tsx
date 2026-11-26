import { useId, type ReactNode } from "react";
import { Link, useParams, useRouterState } from "@tanstack/react-router";
import { MergeMode, type Project } from "@andy/contracts";
import { suggestedMergeMode } from "@andy/domain";
import { LayerOrderHint } from "@/components/RouteLayers";
import { ClearQuotaIdle } from "@/components/ClearQuotaIdle";
import { ConfigHistory } from "@/components/ConfigHistory";
import { DispatchControls } from "@/components/DispatchControls";
import { ProjectPlanPanel } from "@/components/ProjectPlan";
import { EmailNotificationsControl } from "@/components/EmailControls";
import { SetupChecklist } from "@/components/SetupChecklist";
import { SpendCaps } from "@/components/spend/SpendCaps";
import { Loading, QueryError } from "@/components/Status";
import { DefaultWorkerSelect } from "@/components/WorkerControls";
import { DefaultExecutorSelect } from "@/components/ExecutorControls";
import {
  PickerRow,
  SaveError,
  SettingHeading,
  SettingRow,
  SwitchRow,
} from "@/components/SettingRow";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { OptionCards } from "@/components/ui/option-cards";
import { useProjects, useSetupChecklist, useUpdateProject } from "@/lib/queries";
import { showsError } from "@/lib/live";
import { dateOnly } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  DEPLOY_KIND_OPTIONS,
  ENVIRONMENT_OPTIONS,
  MERGE_MODE_OPTIONS,
  PLAN_APPROVAL_OPTIONS,
  SETTING_LABELS,
} from "@/lib/settings-labels";

/**
 * One project's settings (AI-46), rebuilt on the "settings with section nav" template (AI-372):
 * section links on the left, one section beside them, picked by the URL's hash (`#limits`) so a
 * section can be linked. Every control saves on change through PATCH /api/projects/{id}, the
 * same rules MCP's set_* tools use, and confirms at the control. Builds has no MCP setter
 * (ADR-0063); `get_project_settings` reads all of them. Changes lists every change with Revert
 * (M4.12).
 */

const SECTIONS = [
  { id: "setup", title: "Setup", what: "Where this project's plan and setup stand." },
  { id: "automation", title: "Automation", what: "What runs on its own, and what waits for you." },
  { id: "limits", title: "Limits", what: "How much this project may do at once, ask and spend." },
  { id: "defaults", title: "Defaults", what: "What a ticket gets when it has no pick of its own." },
  { id: "notifications", title: "Notifications", what: "When this project emails you." },
  {
    id: "changes",
    title: "Changes",
    what: "Every settings change, newest first; Revert writes the old value back.",
  },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

/** Automation unless the hash names another section. */
const DEFAULT_SECTION: SectionId = "automation";

function sectionFrom(hash: string): SectionId {
  const id = hash.replace(/^#/, "");
  return SECTIONS.some((s) => s.id === id) ? (id as SectionId) : DEFAULT_SECTION;
}

export function ProjectSettingsPage() {
  const { projectId } = useParams({ strict: false });
  const projects = useProjects();
  const hash = useRouterState({ select: (s) => s.location.hash });
  if (projects.isPending) return <Loading />;
  if (projects.data === undefined || showsError(projects))
    return (
      <QueryError
        error={projects.error}
        what="the projects"
        onRetry={() => void projects.refetch()}
      />
    );
  const project = projects.data.find((p) => p.id === projectId);
  if (!project) return <p className="text-muted-foreground">Project not found.</p>;

  const current = SECTIONS.find((s) => s.id === sectionFrom(hash))!;
  return (
    <div className="grid gap-4 md:-my-4 md:min-h-dvh md:grid-cols-[10.5rem_minmax(0,1fr)] md:gap-0">
      <SectionNav project={project} current={current.id} />
      <div role="region" aria-label="Settings" className="min-w-0 space-y-3 md:py-4 md:pl-7">
        <header className="space-y-0.5">
          <h3 className="text-lg font-semibold">{current.title}</h3>
          <p className="text-sm text-muted-foreground">{current.what}</p>
        </header>
        <Section id={current.id} project={project} />
      </div>
    </div>
  );
}

/** The section links: one per section, the current one selected; a strip that scrolls on a phone. */
function SectionNav({ project, current }: { project: Project; current: SectionId }) {
  const setup = useSetupChecklist(project.id).data;
  const left = setup && !setup.complete ? setup.items.filter((i) => i.status !== "done").length : 0;
  return (
    <div className="min-w-0 space-y-2 md:border-r md:border-border md:py-4 md:pr-2">
      <h2 className="px-2 text-xs text-muted-foreground">
        {project.key}: {project.name} settings
      </h2>
      <nav aria-label="Settings sections" className="relative overflow-x-auto">
        <ul className="flex gap-0.5 md:flex-col">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <Link
                to="/p/$projectId/settings"
                params={{ projectId: project.id }}
                hash={s.id}
                resetScroll={false}
                aria-current={s.id === current ? "page" : undefined}
                className={cn(
                  "flex h-11 items-center justify-between gap-2 whitespace-nowrap rounded-md border border-transparent px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground md:h-8",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  s.id === current && "border-selected-edge bg-selected text-foreground",
                )}
              >
                {s.title}
                {s.id === "setup" && left > 0 && (
                  <span className="text-2xs font-medium text-attention tabular-nums">
                    {left} left
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function Section({ id, project }: { id: SectionId; project: Project }) {
  switch (id) {
    case "setup":
      return (
        <section aria-label="Setup" className="space-y-4">
          {project.repos.length > 0 && (
            <p className="text-sm text-muted-foreground">Repos: {project.repos.join(", ")}</p>
          )}
          <ProjectPlanPanel projectId={project.id} />
          <SetupChecklist projectId={project.id} />
        </section>
      );
    case "automation":
      return (
        <Rows label="Automation">
          <MergeModePicker project={project} />
          <PlanApprovalPicker project={project} />
          <AutoRefineSwitch project={project} />
          <BuildsSwitch project={project} />
          <AutoBuildSwitch project={project} />
        </Rows>
      );
    case "limits":
      return (
        <Rows label="Limits">
          <DispatchControls project={project}>
            <ClearQuotaIdle />
          </DispatchControls>
          <DailyQuestionCap project={project} />
          <div className="py-2.5">
            <SpendCaps projectId={project.id} />
          </div>
        </Rows>
      );
    case "defaults":
      return (
        <Rows label="Defaults">
          <div className="pb-1">
            <LayerOrderHint />
          </div>
          <DefaultWorkerSelect project={project} />
          <DefaultExecutorSelect project={project} />
          <DeployKindPicker project={project} />
          <EnvironmentsPicker project={project} />
        </Rows>
      );
    case "notifications":
      return (
        <Rows label="Notifications">
          <EmailNotificationsControl project={project} />
        </Rows>
      );
    case "changes":
      return <ConfigHistory projectId={project.id} />;
  }
}

/** One section's settings, a row each; each still saves the moment it changes. */
function Rows({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="space-y-0">
      {children}
    </section>
  );
}

/** Refine questions the project takes per rolling 24 hours; extras become assumptions (ADR-0075). */
function DailyQuestionCap({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  const id = useId();
  return (
    <SettingRow
      label={SETTING_LABELS.dailyQuestionCap}
      htmlFor={id}
      description="Refine questions this project asks per rolling 24 hours (0 to 50); extras become assumptions."
      state={update}
    >
      <Input
        id={id}
        key={project.dailyQuestionCap}
        type="number"
        min={0}
        max={50}
        className="w-16 tabular-nums max-sm:h-11 max-sm:text-base"
        defaultValue={project.dailyQuestionCap}
        disabled={update.isPending}
        onBlur={(e) => {
          const value = Number(e.target.value);
          if (Number.isInteger(value) && value !== project.dailyQuestionCap) {
            update.mutate({ dailyQuestionCap: value });
          }
        }}
      />
    </SettingRow>
  );
}

/** On: refine starts on its own for tickets entering Up next and answered ones (ADR-0075). */
function AutoRefineSwitch({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  return (
    <SwitchRow
      label={SETTING_LABELS.autoRefine}
      description="Refine starts on its own for tickets entering Up next and answered ones."
      checked={project.autoRefine}
      disabled={update.isPending}
      onCheckedChange={(autoRefine) => update.mutate({ autoRefine })}
      state={update}
    />
  );
}

/**
 * On: build runs may start at all, by hand or on their own (ADR-0063). Turn on only after the live
 * sandbox proof (runbook agent-runs.md §9); who and when are recorded and shown.
 */
function BuildsSwitch({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  const when = project.buildEnabledAt ? dateOnly(project.buildEnabledAt) : null;
  return (
    <SwitchRow
      label={SETTING_LABELS.buildEnabled}
      description="Build tasks may start at all, by hand or on their own. Set here only, never over MCP; turn on after the live sandbox proof."
      note={
        project.buildEnabledBy &&
        when && (
          <span title={`by ${project.buildEnabledBy}`}>
            ({project.buildEnabled ? "on" : "off"} since {when})
          </span>
        )
      }
      checked={project.buildEnabled}
      disabled={update.isPending}
      onCheckedChange={(buildEnabled) => update.mutate({ buildEnabled })}
      state={update}
    />
  );
}

/** On: Ready tickets are built on their own, top of the order first (ADR-0063); needs Builds on. */
function AutoBuildSwitch({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  return (
    <SwitchRow
      label={SETTING_LABELS.autoBuild}
      description="Ready tickets are built on their own, top of the order first. Needs Builds on."
      checked={project.autoBuild}
      disabled={update.isPending || !project.buildEnabled}
      onCheckedChange={(autoBuild) => update.mutate({ autoBuild })}
      state={update}
    />
  );
}

/** Which tickets wait for Andy to approve a read-only plan before their build (ADR-0050). */
function PlanApprovalPicker({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  return (
    <PickerRow
      label={SETTING_LABELS.planApproval}
      description="Which tickets wait for you to approve a read-only plan before their build."
      value={project.planApproval}
      options={PLAN_APPROVAL_OPTIONS}
      disabled={update.isPending}
      onValueChange={(planApproval) => update.mutate({ planApproval })}
      state={update}
    />
  );
}

/** How the project ships (ADR-0114, AI-387: M6.21); later M6 tickets read it. */
function DeployKindPicker({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  return (
    <PickerRow
      label={SETTING_LABELS.deployKind}
      description="How this project ships. Nothing deploys from it yet."
      value={project.deployKind}
      options={DEPLOY_KIND_OPTIONS}
      disabled={update.isPending}
      onValueChange={(deployKind) => update.mutate({ deployKind })}
      state={update}
    />
  );
}

/**
 * Where the project's releases go (ADR-0050, AI-160: M6.2); read only when the deploy kind is
 * Cloud Run (ADR-0114), so with no deploys it says it is not in use. Still editable either way.
 */
function EnvironmentsPicker({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  return (
    <PickerRow
      label={SETTING_LABELS.environments}
      description={
        project.deployKind === "none"
          ? "Not in use: this project does not deploy. Set Deploy kind to Cloud Run to use it."
          : "Where releases go. Nothing deploys from it yet."
      }
      value={project.environments}
      options={ENVIRONMENT_OPTIONS}
      disabled={update.isPending}
      onValueChange={(environments) => update.mutate({ environments })}
      state={update}
    />
  );
}

/**
 * The merge mode (ADR-0124) as four cards, strictest to loosest, each with what merges without
 * Andy and what still waits for him. Not set (a project stored before the setting): no card is
 * picked, the gate merges nothing until Andy picks one (ADR-0134), and ADR-0124's mapping is
 * marked "Suggested".
 */
function MergeModePicker({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  const saved = project.mergeMode;
  const suggested = saved === null ? suggestedMergeMode(project) : null;
  return (
    <div className="space-y-2 border-b border-border py-2.5">
      <SettingHeading
        label={SETTING_LABELS.mergeMode}
        description={
          saved === null
            ? `Not set: the gate merges nothing. Suggested: ${MERGE_MODE_OPTIONS[suggested!].label} (from the old auto-merge setting).`
            : "Who merges this project's agent PRs once every check and both reviews pass. Until a mode is saved the gate merges nothing."
        }
        state={update}
      />
      <OptionCards
        label={SETTING_LABELS.mergeMode}
        value={saved ?? undefined}
        disabled={update.isPending}
        onValueChange={(mode) => update.mutate({ mergeMode: mode })}
        className="sm:grid-cols-2 lg:grid-cols-4"
        options={MergeMode.options.map((mode) => {
          const o = MERGE_MODE_OPTIONS[mode];
          return {
            value: mode,
            label: o.label,
            badge: mode === suggested ? <Badge variant="attention">Suggested</Badge> : undefined,
            description: (
              <span className="flex flex-col gap-2">
                <span>{o.description}</span>
                <span className="border-t border-dashed border-border pt-1.5 text-foreground">
                  You merge: {o.youMerge}
                </span>
              </span>
            ),
          };
        })}
      />
      <div className="flex justify-between gap-2 text-2xs text-muted-foreground">
        <span aria-hidden className="max-sm:hidden">
          ← Strictest
        </span>
        <span className="text-center">Loosen it only here; over MCP it can only be tightened.</span>
        <span aria-hidden className="max-sm:hidden">
          Loosest →
        </span>
      </div>
      <SaveError state={update} />
    </div>
  );
}
