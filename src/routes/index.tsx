import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import type { AttentionBucket } from "@/api/types";
import type { ItemsSearch } from "./items.index";
import { attentionQuery, directoryQuery, useMe } from "@/lib/queries";
import { getCurrentUserId, useCurrentUserId } from "@/lib/session";
import { QUIET_DAYS } from "@/lib/workflow";
import { ItemCompactRow } from "@/components/ops/ItemRow";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Needs attention · OpsDesk" },
      { name: "description", content: "Approvals, urgent unassigned, overdue and quiet work items that need you." },
      { property: "og:title", content: "Needs attention · OpsDesk" },
      { property: "og:description", content: "Approvals, urgent unassigned, overdue and quiet work items that need you." },
    ],
  }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(directoryQuery),
      context.queryClient.ensureQueryData(attentionQuery(getCurrentUserId())),
    ]);
  },
  pendingComponent: DashboardSkeleton,
  component: Dashboard,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div role="alert" className="text-sm">
        {error.message}{" "}
        <button className="underline" onClick={() => router.invalidate()}>Retry</button>
      </div>
    );
  },
  notFoundComponent: () => <div className="text-sm">Nothing here.</div>,
});

function Dashboard() {
  const userId = useCurrentUserId();
  const me = useMe();
  const { data } = useSuspenseQuery(attentionQuery(userId));
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold tracking-tight">Needs attention</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Awaiting my approval" bucket={data.awaitingApproval} search={{ status: "pending_approval" }} empty="No approvals waiting on you." />
        <Card title="Urgent & unassigned" bucket={data.urgentUnassigned} search={{ priority: "urgent", assignee: "unassigned" }} empty="Every urgent item has an owner." />
        <Card title="Overdue" bucket={data.overdue} search={{ overdue: true }} empty="Nothing is past due." />
        <Card
          title="My items gone quiet"
          hint={`No activity in ${QUIET_DAYS}+ days`}
          bucket={data.quiet}
          search={{ assignee: me.user.id, quiet: true }}
          empty="All your items are moving."
        />
      </div>
    </div>
  );
}

function Card({ title, hint, bucket, search, empty }: { title: string; hint?: string; bucket: AttentionBucket; search: ItemsSearch; empty: string }) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-medium">{title}</h2>
        <span className="rounded bg-secondary px-1.5 font-mono text-xs text-secondary-foreground">{bucket.total}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        <Link to="/items" search={search} className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          View all <ArrowRight className="size-3" />
        </Link>
      </header>
      {bucket.items.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="divide-y">
          {bucket.items.map((i) => (
            <ItemCompactRow key={i.id} item={i} />
          ))}
        </div>
      )}
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-56" />
      ))}
    </div>
  );
}
