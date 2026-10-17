import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { differenceInCalendarDays, differenceInHours, format, formatDistanceToNowStrict } from "date-fns";
import { ArrowLeft, CalendarDays, Clock3, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { ApiError, ConflictError, addComment, claimItem, transitionItem, updateItem } from "@/api/client";
import type { ItemEvent, Priority, Role, TimelineEntry, WorkItem } from "@/api/types";
import { directoryQuery, itemQuery, timelineQuery, useDirectory, useMe } from "@/lib/queries";
import { ACTIVE, attentionReasons, can, canTransition, nextTransitions, STATUS_LABEL } from "@/lib/workflow";
import { Avatar, Gate, PriorityLabel, StatusBadge } from "@/components/ops/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STATUSES = ["open", "in_progress", "pending_approval", "resolved", "closed"] as const;
const TIMELINE_PAGE_SIZE = 10;

export const Route = createFileRoute("/items/$key")({
  ssr: false,
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(directoryQuery);
    const item = await context.queryClient.ensureQueryData(itemQuery(params.key));
    if (!item) throw notFound();
    await context.queryClient.ensureQueryData(timelineQuery(item.id));
  },
  head: ({ params }) => ({
    meta: [
      { title: `${params.key.toUpperCase()} · OpsDesk` },
      { name: "description", content: `Work item ${params.key.toUpperCase()} details, status and activity.` },
      { property: "og:title", content: `${params.key.toUpperCase()} · OpsDesk` },
      { property: "og:description", content: `Work item ${params.key.toUpperCase()} details, status and activity.` },
    ],
  }),
  pendingComponent: DetailSkeleton,
  component: ItemDetailPage,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>{error instanceof Error ? error.message : String(error)}</p>
        <button className="underline" onClick={() => router.invalidate()}>Retry</button>
      </div>
    );
  },
  notFoundComponent: () => (
    <div className="space-y-2 text-sm">
      <p>That item doesn't exist.</p>
      <Link to="/items" className="underline">
        Back to all items
      </Link>
    </div>
  ),
});

function ItemDetailPage() {
  const { key } = Route.useParams();
  const { data: item } = useSuspenseQuery(itemQuery(key));

  if (!item) return <div className="text-sm">Item not found.</div>;
  return <ItemDetail item={item} />;
}

function ItemDetail({ item }: { item: WorkItem }) {
  const { data: timeline } = useSuspenseQuery(timelineQuery(item.id));
  const directory = useDirectory();
  const me = useMe();
  const queryClient = useQueryClient();
  const [timelineCursor, setTimelineCursor] = useState(TIMELINE_PAGE_SIZE);
  const [comment, setComment] = useState("");
  const intentKeys = useRef(new Map<string, string>());
  const visibleTimeline = timeline.slice(Math.max(0, timeline.length - timelineCursor)).reverse();
  const team = directory.teams.find((t) => t.id === item.teamId);
  const requester = directory.users.find((u) => u.id === item.requesterId);
  const assignee = directory.users.find((u) => u.id === item.assigneeId);
  const role = me.roleFor(item.teamId);
  const reasons = attentionReasons(item, me.user.id, role);
  const unassignedSince = getUnassignedSince(item, timeline);
  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["item", item.key.toUpperCase()] }),
    queryClient.invalidateQueries({ queryKey: ["timeline", item.id] }),
    queryClient.invalidateQueries({ queryKey: ["items"] }),
    queryClient.invalidateQueries({ queryKey: ["attention"] }),
  ]);
  const intentKey = (name: string) => {
    const existing = intentKeys.current.get(name);
    if (existing) return existing;
    const key = crypto.randomUUID();
    intentKeys.current.set(name, key);
    return key;
  };
  const finishIntent = (name: string) => intentKeys.current.delete(name);
  const claim = useMutation({
    mutationFn: () => claimItem(me.user.id, item.id, { idempotencyKey: intentKey("claim"), expectedVersion: item.version }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["item", item.key.toUpperCase()] });
      const previous = queryClient.getQueryData<WorkItem | null>(itemQuery(item.key).queryKey);
      queryClient.setQueryData<WorkItem | null | undefined>(
        itemQuery(item.key).queryKey,
        (current) => current ? { ...current, assigneeId: me.user.id } : current,
      );
      return { previous };
    },
    onSuccess: () => {
      finishIntent("claim");
      void invalidate();
      toast.success("You took this item");
    },
    onError: async (error, _variables, context) => {
      queryClient.setQueryData(itemQuery(item.key).queryKey, context?.previous);
      if (error instanceof ConflictError || (error instanceof ApiError && error.status === 409)) {
        await invalidate();
        const current = queryClient.getQueryData<WorkItem | null>(itemQuery(item.key).queryKey);
        const owner = current?.assigneeId ? directory.users.find((user) => user.id === current.assigneeId)?.name : "another user";
        toast.error(`${owner ?? "Another user"} already took this item`);
      } else {
        toast.error(error instanceof Error ? error.message : "Could not take this item");
      }
      finishIntent("claim");
    },
  });
  const transition = useMutation({
    mutationFn: (to: WorkItem["status"]) =>
      transitionItem(me.user.id, item.id, to, { idempotencyKey: intentKey(`transition:${to}`), expectedVersion: item.version }),
    onSuccess: (_updated, to) => {
      finishIntent(`transition:${to}`);
      void invalidate();
    },
    onError: (error, to) => {
      finishIntent(`transition:${to}`);
      void invalidate();
      toast.error(error instanceof Error ? error.message : "Could not change status");
    },
  });
  const update = useMutation({
    mutationFn: (patch: Partial<Pick<WorkItem, "title" | "description" | "priority" | "assigneeId">>) =>
      updateItem(me.user.id, item.id, patch, { idempotencyKey: intentKey(`update:${Object.keys(patch).join(",")}`), expectedVersion: item.version }),
    onSuccess: (_updated, patch) => {
      finishIntent(`update:${Object.keys(patch).join(",")}`);
      void invalidate();
    },
    onError: (error, patch) => {
      finishIntent(`update:${Object.keys(patch).join(",")}`);
      void invalidate();
      toast.error(error instanceof Error ? error.message : "Could not save changes");
    },
  });
  const commentMutation = useMutation({
    mutationFn: (body: string) =>
      addComment(me.user.id, item.id, body, { idempotencyKey: intentKey("comment"), expectedVersion: item.version }),
    onSuccess: () => {
      finishIntent("comment");
      setComment("");
      void invalidate();
    },
    onError: (error) => {
      finishIntent("comment");
      void invalidate();
      toast.error(error instanceof Error ? error.message : "Could not add comment");
    },
  });
  const saveComment = () => {
    const body = comment.trim();
    if (body && !commentMutation.isPending) commentMutation.mutate(body);
  };

  return (
    <div className="space-y-4">
      <Link to="/items" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> All items
      </Link>
      <AttentionBanner item={item} reasons={reasons} unassignedSince={unassignedSince} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <main className="min-w-0 space-y-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{item.key}</span>
              {team && <span>{team.name}</span>}
              <span className="capitalize">{item.type}</span>
            </div>
            <EditableText value={item.title} multiline={false} disabled={!can.edit(role)} saving={update.isPending} onSave={(title) => update.mutate({ title })} />
            <EditableText value={item.description} multiline disabled={!can.edit(role)} saving={update.isPending} onSave={(description) => update.mutate({ description })} />
          </div>
          <StatusStepper status={item.status} />
          <div className="flex flex-wrap gap-2">
            {nextTransitions(item).map((next) => {
              const allowed = canTransition(item, next.to, role);
              const reason = allowed ? null : role ? `Your ${role} role cannot ${next.label.toLowerCase()}` : "You are not a member of this team";
              return (
                <Gate key={next.to} reason={reason}>
                  <Button size="sm" variant={next.to === "closed" ? "outline" : "default"} disabled={!allowed || transition.isPending} onClick={() => transition.mutate(next.to)}>
                    {transition.isPending && transition.variables === next.to ? "Saving…" : next.label}
                  </Button>
                </Gate>
              );
            })}
          </div>
          {item.assigneeId === null && (
            <Gate reason={can.claim(role) ? null : "Viewers cannot take items"}>
              <Button size="sm" variant="outline" disabled={!can.claim(role) || claim.isPending} onClick={() => claim.mutate()}>
                {claim.isPending ? "Taking…" : "Take this"}
              </Button>
            </Gate>
          )}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Timeline</h2>
              <span className="text-xs text-muted-foreground">{timeline.length} entries</span>
            </div>
            <div className="space-y-3">
              {visibleTimeline.map((entry) => (
                <TimelineRow key={entry.kind === "event" ? entry.event.id : entry.comment.id} entry={entry} directory={directory} />
              ))}
              {visibleTimeline.length === 0 && <p className="text-sm text-muted-foreground">No timeline entries.</p>}
            </div>
            {timelineCursor < timeline.length && (
              <Gate reason={null}>
                <Button variant="outline" size="sm" onClick={() => setTimelineCursor((cursor) => cursor + TIMELINE_PAGE_SIZE)}>
                  Load older
                </Button>
              </Gate>
            )}
          </section>
        </main>
        <Sidebar
          item={item}
          requester={requester}
          assignee={assignee}
          directory={directory}
          role={role}
          saving={update.isPending}
          onPriorityChange={(priority) => update.mutate({ priority })}
          onAssigneeChange={(assigneeId) => update.mutate({ assigneeId })}
        />
      </div>
      <section className="space-y-2 rounded-lg border bg-card p-3">
        <h2 className="text-sm font-semibold">Add a comment</h2>
        <Textarea
          value={comment}
          disabled={!can.comment(role) || commentMutation.isPending}
          placeholder="Write an update…"
          onChange={(event) => setComment(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              saveComment();
            }
          }}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Cmd/Ctrl + Enter to submit</span>
          <Gate reason={can.comment(role) ? null : "Viewers cannot comment"}>
            <Button size="sm" disabled={!comment.trim() || !can.comment(role) || commentMutation.isPending} onClick={saveComment}>
              {commentMutation.isPending ? "Posting…" : "Comment"}
            </Button>
          </Gate>
        </div>
      </section>
    </div>
  );
}

function AttentionBanner({ item, reasons, unassignedSince }: { item: WorkItem; reasons: string[]; unassignedSince: string | null }) {
  const messages = reasons.map((reason) => {
    if (reason === "Waiting for your approval") return reason;
    if (reason === "Past its due date" && item.dueAt) {
      return `Overdue by ${Math.max(1, differenceInCalendarDays(new Date(), new Date(item.dueAt)))} days`;
    }
    if (reason === "Urgent and nobody owns it" && unassignedSince) {
      return `Unassigned for ${Math.max(1, differenceInHours(new Date(), new Date(unassignedSince)))} hours`;
    }
    return reason;
  });
  if (item.assigneeId === null && ACTIVE.includes(item.status) && !messages.some((message) => message.startsWith("Unassigned for"))) {
    messages.push(`Unassigned for ${Math.max(1, differenceInHours(new Date(), new Date(unassignedSince ?? item.createdAt)))} hours`);
  }
  return (
    <section className="rounded-lg border bg-muted/40 px-3 py-2.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">What needs attention</p>
      <p className="mt-1 text-sm">{messages.length ? messages.join(" · ") : "Nothing right now."}</p>
    </section>
  );
}

function StatusStepper({ status }: { status: WorkItem["status"] }) {
  return (
    <div className="flex overflow-x-auto rounded-lg border bg-card p-1">
      {STATUSES.map((step, index) => (
        <div key={step} className="flex min-w-32 flex-1 items-center">
          <div className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs ${step === status ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
            <span className={`size-1.5 rounded-full ${step === status ? "bg-primary-foreground" : "bg-border"}`} />
            {STATUS_LABEL[step]}
          </div>
          {index < STATUSES.length - 1 && <span className="px-1 text-border">→</span>}
        </div>
      ))}
    </div>
  );
}

function Sidebar({
  item,
  requester,
  assignee,
  directory,
  role,
  saving,
  onPriorityChange,
  onAssigneeChange,
}: {
  item: WorkItem;
  requester: ReturnType<typeof useDirectory>["users"][number] | undefined;
  assignee: ReturnType<typeof useDirectory>["users"][number] | undefined;
  directory: ReturnType<typeof useDirectory>;
  role: Role | null;
  saving: boolean;
  onPriorityChange: (priority: Priority) => void;
  onAssigneeChange: (assigneeId: string | null) => void;
}) {
  const canAssign = can.assign(role);
  return (
    <aside className="h-fit space-y-4 rounded-lg border bg-card p-4 text-sm">
      <DetailField label="Status"><StatusBadge status={item.status} /></DetailField>
      <DetailField label="Priority">
        <Gate reason={canAssign ? null : "Only managers and admins can change priority"}>
          <Select value={item.priority} disabled={!canAssign || saving} onValueChange={(value) => onPriorityChange(value as Priority)}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["low", "medium", "high", "urgent"] as Priority[]).map((priority) => (
                <SelectItem key={priority} value={priority}><PriorityLabel priority={priority} /></SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Gate>
      </DetailField>
      <DetailField label="Assignee">
        <Gate reason={canAssign ? null : "Only managers and admins can change assignee"}>
          <Select value={item.assigneeId ?? "unassigned"} disabled={!canAssign || saving} onValueChange={(value) => onAssigneeChange(value === "unassigned" ? null : value)}>
            <SelectTrigger className="h-8"><SelectValue placeholder="Unassigned" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {directory.users.map((user) => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Gate>
      </DetailField>
      <DetailField label="Requester"><Person user={requester} /></DetailField>
      <DetailField label="Due date">
        <span className="inline-flex items-center gap-1.5">{item.dueAt ? <><CalendarDays className="size-3.5" />{format(new Date(item.dueAt), "MMM d, yyyy")}</> : "None"}</span>
      </DetailField>
      <DetailField label="Watchers"><span className="text-muted-foreground">No watchers</span></DetailField>
      <DetailField label="Created"><Time value={item.createdAt} /></DetailField>
      <DetailField label="Updated"><Time value={item.updatedAt} /></DetailField>
      <p className="border-t pt-3 text-xs text-muted-foreground">version {item.version}</p>
    </aside>
  );
}

function EditableText({
  value,
  multiline,
  disabled,
  saving,
  onSave,
}: {
  value: string;
  multiline: boolean;
  disabled: boolean;
  saving: boolean;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const changed = draft.trim() !== value;
  const save = () => {
    const next = draft.trim();
    if (next && changed && !saving) onSave(next);
  };
  return (
    <div className="space-y-1.5">
      <Gate reason={disabled ? "Viewers cannot edit items" : null}>
        {multiline ? (
          <Textarea value={draft} disabled={disabled || saving} onChange={(event) => setDraft(event.target.value)} className="min-h-24" />
        ) : (
          <Input value={draft} disabled={disabled || saving} onChange={(event) => setDraft(event.target.value)} className="h-auto border-transparent px-0 text-2xl font-semibold shadow-none focus-visible:border-input focus-visible:px-3" />
        )}
      </Gate>
      {changed && (
        <Gate reason={disabled ? "Viewers cannot edit items" : null}>
          <Button size="sm" variant="outline" disabled={disabled || saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>
        </Gate>
      )}
    </div>
  );
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><p className="text-xs text-muted-foreground">{label}</p>{children}</div>;
}

function Person({ user }: { user: ReturnType<typeof useDirectory>["users"][number] | undefined }) {
  return user ? <span className="inline-flex items-center gap-2"><Avatar user={user} /><span>{user.name}</span></span> : <span className="text-muted-foreground">Unassigned</span>;
}

function Time({ value }: { value: string }) {
  return <span className="inline-flex items-center gap-1.5 text-xs"><Clock3 className="size-3.5 text-muted-foreground" />{formatDistanceToNowStrict(new Date(value), { addSuffix: true })}</span>;
}

function TimelineRow({ entry, directory }: { entry: TimelineEntry; directory: ReturnType<typeof useDirectory> }) {
  if (entry.kind === "comment") {
    const author = directory.users.find((user) => user.id === entry.comment.authorId);
    return (
      <div className="rounded-lg border bg-card p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Avatar user={author} /><span>{author?.name ?? "Unknown user"}</span><span>commented {formatDistanceToNowStrict(new Date(entry.at), { addSuffix: true })}</span><MessageCircle className="ml-auto size-3.5" /></div>
        <p className="mt-2 whitespace-pre-wrap text-sm">{entry.comment.body}</p>
      </div>
    );
  }
  const actor = directory.users.find((user) => user.id === entry.event.actorId);
  return <div className="flex gap-3 border-l-2 border-border py-1 pl-3 text-sm"><Avatar user={actor} /><div><p>{eventLabel(entry.event, directory)}</p><p className="text-xs text-muted-foreground">{formatDistanceToNowStrict(new Date(entry.at), { addSuffix: true })}</p></div></div>;
}

function eventLabel(event: ItemEvent, directory: ReturnType<typeof useDirectory>) {
  const actor = directory.users.find((user) => user.id === event.actorId)?.name ?? "Someone";
  if (event.type === "status_changed") return `${actor} changed status from ${event.from ? STATUS_LABEL[event.from as WorkItem["status"]] : "unknown"} to ${event.to ? STATUS_LABEL[event.to as WorkItem["status"]] : "unknown"}`;
  if (event.type === "assigned") return `${actor} changed the assignee`;
  if (event.type === "created") return `${actor} created this item`;
  if (event.type === "priority_changed") return `${actor} changed the priority`;
  if (event.type === "title_changed") return `${actor} changed the title`;
  return `${actor} updated the description`;
}

function getUnassignedSince(item: WorkItem, timeline: TimelineEntry[]) {
  if (item.assigneeId) return null;
  const assignment = timeline
    .filter((entry): entry is Extract<TimelineEntry, { kind: "event" }> => entry.kind === "event" && entry.event.type === "assigned" && entry.event.to === null)
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  return assignment?.at ?? item.createdAt;
}

function DetailSkeleton() {
  return <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]"><div className="space-y-4"><Skeleton className="h-4 w-24" /><Skeleton className="h-10 w-3/4" /><Skeleton className="h-20 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-32 w-full" /></div><Skeleton className="h-80 w-full" /></div>;
}
