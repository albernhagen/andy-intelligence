import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { QueryError } from "@/components/Status";
import { useAskQuestion } from "@/lib/queries";
import { linesToList } from "@/lib/tickets";

/**
 * Asks a question on a ticket by hand (flags it Needs-you). Refine runs ask theirs (M1.7:
 * Refinement); this is for the questions Andy wants answered himself, or to test the inbox.
 */
export function AskQuestionForm(props: { projectId: string; ticketId: string }) {
  const ask = useAskQuestion(props);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [options, setOptions] = useState("");
  const [suggested, setSuggested] = useState("");

  if (!open)
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Ask a question…
      </Button>
    );

  return (
    <form
      className="space-y-2 rounded-md border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        ask.mutate(
          {
            text: text.trim(),
            options: linesToList(options),
            suggestedAnswer: suggested.trim() || null,
          },
          {
            onSuccess: () => {
              setOpen(false);
              setText("");
              setOptions("");
              setSuggested("");
            },
          },
        );
      }}
    >
      <Field label="Question">
        <Input required value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <Field label="Options (one per line)">
        <Textarea value={options} onChange={(e) => setOptions(e.target.value)} />
      </Field>
      <Field label="Suggested answer">
        <Input value={suggested} onChange={(e) => setSuggested(e.target.value)} />
      </Field>
      {ask.error && <QueryError error={ask.error} />}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!text.trim() || ask.isPending}>
          Ask
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
