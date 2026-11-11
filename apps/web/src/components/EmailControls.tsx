import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project } from "@andy/contracts";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/Status";
import { unwrap, useApi } from "@/lib/api";
import { useUpdateProject } from "@/lib/queries";

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
      <label className="ml-3 inline-flex items-center gap-1 text-sm">
        <input
          type="checkbox"
          checked={configured && project.emailNotifications}
          disabled={!configured || update.isPending}
          onChange={(e) => update.mutate({ emailNotifications: e.target.checked })}
        />
        Email notifications
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
      {status.error && <QueryError error={status.error} />}
      {update.error && <QueryError error={update.error} />}
      {test.error && <QueryError error={test.error} />}
    </>
  );
}
