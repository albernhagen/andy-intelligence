import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project } from "@andy/contracts";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/Status";
import { unwrap, useApi } from "@/lib/api";
import { useUpdateProject } from "@/lib/queries";
import { SwitchRow } from "@/components/SettingRow";
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
      <SwitchRow
        label={SETTING_LABELS.emailNotifications}
        description="Email you when a ticket here starts to need you: items within 10 minutes share one email, at most 20 a day."
        note={
          status.data &&
          (configured
            ? `${status.data.sentToday} of ${status.data.dailyCap} sent today.`
            : "Off: email is not configured.")
        }
        checked={configured && project.emailNotifications}
        disabled={!configured || update.isPending}
        onCheckedChange={(emailNotifications) => update.mutate({ emailNotifications })}
        state={update}
      />
      {configured && (
        <div className="flex flex-wrap items-center gap-2 py-2.5">
          <Button
            size="sm"
            variant="outline"
            className="max-sm:h-11"
            disabled={test.isPending}
            onClick={() => test.mutate()}
          >
            {test.isSuccess ? "Test sent" : "Send test email"}
          </Button>
          {test.error && <QueryError error={test.error} />}
        </div>
      )}
      {status.error && (
        <QueryError
          error={status.error}
          what="the email status"
          onRetry={() => void status.refetch()}
        />
      )}
    </>
  );
}
