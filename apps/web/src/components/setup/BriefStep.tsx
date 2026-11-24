import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { QueryError } from "@/components/Status";
import { toast } from "@/components/ui/toast";
import {
  BRIEF_PAGES,
  clearDraft,
  draftFrom,
  loadDraft,
  loadOpenedBrief,
  missingOn,
  saveDraft,
  saveOpenedBrief,
  toAnswers,
  type BriefDraft,
  type OpenedBrief,
} from "@/lib/brief-draft";
import { useSubmitBrief } from "@/lib/setup-queries";
import { MainButton, StepCard } from "./StepCard";

/**
 * Step 2 (AI-373): the brief, asked a page at a time and submitted through the same route and
 * service as MCP `submit_brief`: a PR on the project's repo that Andy merges. Discovery's answers
 * pre-fill a new draft; the draft is kept in this browser as he types.
 */
export function BriefStep({
  projectId,
  projectName,
  prefill,
  onDone,
}: {
  projectId: string;
  projectName: string;
  prefill: Partial<Record<string, string>>;
  /** "Save and finish later": back to the board. */
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<BriefDraft>(() => loadDraft(projectId) ?? draftFrom(prefill));
  const [page, setPage] = useState(0);
  const [opened, setOpened] = useState<OpenedBrief | null>(() => loadOpenedBrief(projectId));
  const [editing, setEditing] = useState(false);
  const submit = useSubmitBrief(projectId);
  useEffect(() => saveDraft(projectId, draft), [projectId, draft]);

  if (opened && !editing)
    return (
      <StepCard
        step="brief"
        meta="waiting for your merge"
        title="Merge the brief to go on"
        hint="The plan step reads the brief from the default branch, so it starts once this PR merges."
        actions={
          <>
            <Button variant="outline" className="h-11 sm:h-9" onClick={() => setEditing(true)}>
              Edit the brief
            </Button>
            <Button asChild className="h-11 sm:h-9">
              <a href={opened.url} target="_blank" rel="noreferrer">
                Open PR #{opened.number}
              </a>
            </Button>
          </>
        }
      >
        <p className="text-sm">
          Brief PR #{opened.number} is open on the project&apos;s repo. Merge it on GitHub; this
          step ticks itself off when the brief is on the default branch.
        </p>
      </StepCard>
    );

  const current = BRIEF_PAGES[page]!;
  const last = page === BRIEF_PAGES.length - 1;
  const missing = missingOn(current, draft);
  const answers = last ? toAnswers(projectName, draft) : null;
  const next = () => {
    if (missing.length > 0) return;
    if (!last) return setPage(page + 1);
    if (!answers) return;
    submit.mutate(answers, {
      onSuccess: (result) => {
        if (result.status === "opened") {
          saveOpenedBrief(projectId, result.pullRequest);
          setOpened(result.pullRequest);
          setEditing(false);
          toast({
            title: `Opened brief PR #${result.pullRequest.number}`,
            description: "Merge it on GitHub, then plan milestones.",
          });
        } else {
          toast({ title: "The brief on the default branch already says this" });
        }
        clearDraft(projectId);
      },
    });
  };

  return (
    <StepCard
      step="brief"
      meta={`page ${page + 1} of ${BRIEF_PAGES.length} · about 3 minutes`}
      title={current.title}
      onSubmit={missing.length === 0 && !submit.isPending ? next : undefined}
      hint="Saved as you type. The plan step reads this brief once its PR merges."
      actions={
        <>
          {page > 0 ? (
            <Button variant="outline" className="h-11 sm:h-9" onClick={() => setPage(page - 1)}>
              Back
            </Button>
          ) : (
            <Button variant="outline" className="h-11 sm:h-9" onClick={onDone}>
              Save and finish later
            </Button>
          )}
          <MainButton onClick={next} disabled={missing.length > 0 || submit.isPending}>
            {last ? "Propose the brief" : "Next"}
          </MainButton>
        </>
      }
    >
      {current.questions.map((q) => {
        const props = {
          value: draft[q.field],
          placeholder: q.placeholder,
          onChange: (e: { target: { value: string } }) =>
            setDraft((d) => ({ ...d, [q.field]: e.target.value })),
          className: "text-base sm:text-sm",
        };
        return (
          <Field key={q.field} label={q.label} help={q.optional ? "Optional" : undefined}>
            {q.list || q.field === "idea" ? (
              <Textarea {...props} rows={q.field === "idea" ? 3 : 2} />
            ) : (
              <Input {...props} className={`${props.className} max-sm:h-11`} />
            )}
          </Field>
        );
      })}
      {submit.error && <QueryError error={submit.error} />}
    </StepCard>
  );
}
