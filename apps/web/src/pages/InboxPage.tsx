import { useParams } from "@tanstack/react-router";
import type { Project } from "@andy/contracts";
import { ConfigChanges } from "@/components/ConfigChanges";
import { InboxTicketCard } from "@/components/inbox/InboxTicketCard";
import { Loading, QueryError } from "@/components/Status";
import { cardCount, inboxCards, type InboxCard } from "@/lib/needs-you";
import { useNeedsYou, useProjects } from "@/lib/queries";
import { showsError } from "@/lib/live";

/**
 * Needs-you inbox, the home screen (ARCHITECTURE §7.5): one card per ticket with its open
 * questions, most unblocking first; Done, Cancelled and archived tickets last under "Stale".
 * Under `/p/<project>/inbox` only that project's; under `/all/inbox` grouped by project.
 */
export function InboxPage() {
  const { projectId } = useParams({ strict: false });
  const needsYou = useNeedsYou();
  const projects = useProjects();
  if (needsYou.isPending) return <Loading />;
  if (needsYou.data === undefined || showsError(needsYou))
    return <QueryError error={needsYou.error} />;

  const { active, stale } = inboxCards(needsYou.data, projectId);
  const total = sum([...active, ...stale]);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">
        Needs you <span className="text-muted-foreground tabular-nums">{total}</span>
      </h2>
      {total === 0 && <p className="text-muted-foreground">Nothing needs you.</p>}
      {projectId ? (
        <Cards cards={active} />
      ) : (
        byProject(active, projects.data ?? []).map(({ id, name, cards }) => (
          <Group key={id} title={name} cards={cards} />
        ))
      )}
      <ConfigChanges projectId={projectId} />
      {stale.length > 0 && <Group title="Stale" cards={stale} />}
    </section>
  );
}

const sum = (cards: InboxCard[]) => cards.reduce((n, c) => n + cardCount(c), 0);

function Group({ title, cards }: { title: string; cards: InboxCard[] }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="text-sm font-medium">
        {title} <span className="text-muted-foreground tabular-nums">{sum(cards)}</span>
      </h3>
      <Cards cards={cards} />
    </section>
  );
}

function Cards({ cards }: { cards: InboxCard[] }) {
  return (
    <div className="space-y-2">
      {cards.map((c) => (
        <InboxTicketCard key={c.ticketId} card={c} />
      ))}
    </div>
  );
}

/** Cards under a heading per project, projects in the picker's order (cards keep theirs). */
function byProject(cards: InboxCard[], projects: Project[]) {
  const order = [...projects.map((p) => p.id), ...cards.map((c) => c.projectId)];
  const ids = [...new Set(order)].filter((id) => cards.some((c) => c.projectId === id));
  return ids.map((id) => {
    const project = projects.find((p) => p.id === id);
    return {
      id,
      name: project ? `${project.key}: ${project.name}` : id.toUpperCase(),
      cards: cards.filter((c) => c.projectId === id),
    };
  });
}
