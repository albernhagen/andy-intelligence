import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project } from "@andy/contracts";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/Status";
import { unwrap, useApi } from "@/lib/api";
import { useUpdateProject } from "@/lib/queries";
import { SavedCue } from "@/components/SavedCue";
import { SETTING_LABELS } from "@/lib/settings-labels";

/**
 * Needs-you email for one project (AI-77). Off, whatever the switch says, until email is
 * configured (runbook email-notifications.md); a test send counts toward the daily cap.
 */
export function EmailNotificationsControl({ project }: { project: Project }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["notify-email"],
    queryFn: async () => unwrap(await api.GET("/api/notify/email")),
  });
  const update = useUpdateProject(project.id);
  const test = useMutation({
    mutationFn: async () => unwrap(await api.POST("/api/notify/email/test")),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notify-email"] }),
  });
  const configured = status.data?.configured ?? false;

  return (
    <>
      <label className="ml-3 inline-flex items-center gap-1 text-sm max-sm:min-h-11">
        <input
          type="checkbox"
          checked={configured && project.emailNotifications}
          disabled={!configured || update.isPending}
          onChange={(e) => update.mutate({ emailNotifications: e.target.checked })}
        />
        {SETTING_LABELS.emailNotifications}
        {status.data && !configured && (
          <span className="text-muted-foreground">(off: email is not configured)</span>
        )}
        {status.data && configured && (
          <span className="text-muted-foreground">
            ({status.data.sentToday} of {status.data.dailyCap} sent today)
          </span>
        )}
      </label>
      {configured && (
        <Button
          size="sm"
          variant="outline"
          className="ml-3"
          disabled={test.isPending}
          onClick={() => test.mutate()}
        >
          {test.isSuccess ? "Test sent" : "Send test email"}
        </Button>
      )}
      {status.error && (
        <QueryError
          error={status.error}
          what="the email status"
          onRetry={() => void status.refetch()}
        />
      )}
      {update.error && <QueryError error={update.error} />}
      <SavedCue pending={update.isPending} saved={update.isSuccess} />
      {test.error && <QueryError error={test.error} />}
    </>
  );
}
