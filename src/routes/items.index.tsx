import { Suspense, useEffect, useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { Search, X } from "lucide-react";
import type { ListParams, Priority, Status } from "@/api/types";
import { directoryQuery, itemsQuery, useDirectory, useMe } from "@/lib/queries";
import { getCurrentUserId, useCurrentUserId } from "@/lib/session";
import { STATUS_LABEL } from "@/lib/workflow";
import { Avatar, PriorityLabel, PRIORITY_LABEL, StatusBadge } from "@/components/ops/bits";
import { DueLabel } from "@/components/ops/ItemRow";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";

const STATUSES: Status[] = ["open", "in_progress", "pending_approval", "resolved", "closed"];
const PRIORITIES: Priority[] = ["low", "medium", "high", "urgent"];

export interface ItemsSearch {
  team?: string | undefined;
  status?: Status | undefined;
  priority?: Priority | undefined;
  assignee?: string | undefined;
  overdue?: boolean | undefined;
  quiet?: boolean | undefined;
  q?: string | undefined;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export const Route = createFileRoute("/items/")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): ItemsSearch => {
    const g = (k: string) => s[k];
    return {
    team: str(s["team"]),
    status: STATUSES.includes(s["status"] as Status) ? (s["status"] as Status) : undefined,
    priority: PRIORITIES.includes(s["priority"] as Priority) ? (s["priority"] as Priority) : undefined,
    assignee: str(s["assignee"]),
    overdue: s["overdue"] === true || s["overdue"] === "true" ? true : undefined,
    quiet: s["quiet"] === true || s["quiet"] === "true" ? true : undefined,
    q: str(s["q"]),
    };
  },
  loaderDeps: ({ search }) => search,
  head: () => ({
    meta: [
      { title: "All items · OpsDesk" },
      { name: "description", content: "Filter and search every operations work item." },
      { property: "og:title", content: "All items · OpsDesk" },
      { property: "og:description", content: "Filter and search every operations work item." },
    ],
  }),
  loader: async ({ context, deps }) => {
    await context.queryClient.ensureQueryData(directoryQuery);
    await context.queryClient.ensureInfiniteQueryData(itemsQuery(toParams(deps, getCurrentUserId())));
  },
  component: ItemsPage,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div role="alert" className="text-sm">
        {error instanceof Error ? error.message : String(error)}{" "}
        <button className="underline" onClick={() => router.invalidate()}>Retry</button>
      </div>
    );
  },
  notFoundComponent: () => <div className="text-sm">Nothing here.</div>,
});

function toParams(s: ItemsSearch, userId: string): Omit<ListParams, "cursor"> {
  return {
    teamId: s.team,
    status: s.status,
    priority: s.priority,
    assigneeId: s.assignee === "me" ? userId : s.assignee,
    overdue: s.overdue,
    quiet: s.quiet,
    q: s.q,
  };
}

const ALL = "__all";

function ItemsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const dir = useDirectory();
  const me = useMe();
  const set = (patch: Partial<ItemsSearch>) => navigate({ to: ".", search: (prev) => ({ ...prev, ...patch }), replace: true });

  const [q, setQ] = useState(search.q ?? "");
  useEffect(() => setQ(search.q ?? ""), [search.q]);
  useEffect(() => {
    const t = setTimeout(() => {
      if ((q.trim() || undefined) !== search.q) set({ q: q.trim() || undefined });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const assigneeValue = search.assignee === me.user.id ? "me" : (search.assignee ?? ALL);
  const hasFilters = Object.values(search).some((v) => v !== undefined);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold tracking-tight">All items</h1>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title or key" className="h-8 w-56 pl-7 text-sm" />
        </div>
        <FilterSelect label="Team" value={search.team} onChange={(v) => set({ team: v })} options={dir.teams.map((t) => [t.id, t.name])} />
        <FilterSelect label="Status" value={search.status} onChange={(v) => set({ status: v as Status | undefined })} options={STATUSES.map((s) => [s, STATUS_LABEL[s]])} />
        <FilterSelect label="Priority" value={search.priority} onChange={(v) => set({ priority: v as Priority | undefined })} options={PRIORITIES.map((p) => [p, PRIORITY_LABEL[p]])} />
        <FilterSelect
          label="Assignee"
          value={assigneeValue === ALL ? undefined : assigneeValue}
          onChange={(v) => set({ assignee: v })}
          options={[["me", "Me"], ["unassigned", "Unassigned"], ...dir.users.filter((u) => u.id !== me.user.id).map((u): [string, string] => [u.id, u.name])]}
        />
        <Toggle size="sm" variant="outline" pressed={!!search.overdue} onPressedChange={(p) => set({ overdue: p || undefined })} className="h-8">
          Overdue
        </Toggle>
        <Toggle size="sm" variant="outline" pressed={!!search.quiet} onPressedChange={(p) => set({ quiet: p || undefined })} className="h-8">
          Gone quiet
        </Toggle>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-8" onClick={() => navigate({ to: ".", search: {} })}>
            <X /> Clear
          </Button>
        )}
      </div>
      <Suspense fallback={<TableSkeleton />}>
        <ItemsTable search={search} />
      </Suspense>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  options: [string, string][];
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger className="h-8 w-auto min-w-28 gap-1 text-sm data-[placeholder]:text-muted-foreground">
        <span className="text-muted-foreground">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Any</SelectItem>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>{l}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const cols = "grid grid-cols-[5rem_minmax(0,1fr)_9rem_6rem_8rem_6rem_5rem] items-center gap-3 px-3";

function ItemsTable({ search }: { search: ItemsSearch }) {
  const userId = useCurrentUserId();
  const dir = useDirectory();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useSuspenseInfiniteQuery(itemsQuery(toParams(search, userId)));
  const rows = data.pages.flatMap((p) => p.items);
  const total = data.pages[0]?.total ?? 0;

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className={`${cols} h-8 border-b bg-muted/50 text-xs text-muted-foreground`}>
        <span>Key</span>
        <span>Title</span>
        <span>Status</span>
        <span>Priority</span>
        <span>Assignee</span>
        <span className="text-right">Due</span>
        <span className="text-right">Updated</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-3 py-12 text-center text-sm text-muted-foreground">No items match these filters.</div>
      ) : (
        <div className="divide-y">
          {rows.map((i) => {
            const a = dir.users.find((u) => u.id === i.assigneeId);
            const team = dir.teams.find((t) => t.id === i.teamId);
            return (
              <Link key={i.id} to="/items/$key" params={{ key: i.key }} className={`${cols} h-9 text-sm hover:bg-accent`}>
                <span className="font-mono text-xs text-muted-foreground">{i.key}</span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{i.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{team?.name}</span>
                </span>
                <StatusBadge status={i.status} />
                <PriorityLabel priority={i.priority} />
                <span className="flex min-w-0 items-center gap-1.5 text-xs">
                  <Avatar user={a} />
                  <span className="truncate text-muted-foreground">{a?.name ?? "Unassigned"}</span>
                </span>
                <span className="flex justify-end"><DueLabel item={i} /></span>
                <span className="text-right text-xs text-muted-foreground">{formatDistanceToNowStrict(new Date(i.updatedAt))}</span>
              </Link>
            );
          })}
        </div>
      )}
      <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
        <span>
          {rows.length} of {total}
        </span>
        {hasNextPage && (
          <Button variant="outline" size="sm" className="h-7" disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        )}
      </div>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-px overflow-hidden rounded-lg border">
      {Array.from({ length: 10 }).map((_, i) => (
        <Skeleton key={i} className="h-9 rounded-none" />
      ))}
    </div>
  );
}
