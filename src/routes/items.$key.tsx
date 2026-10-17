import { Suspense, useState } from "react";
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import * as api from "@/api/client";
import { ApiError } from "@/api/client";
import type { Priority, Status, WorkItem } from "@/api/types";
import { directoryQuery, itemQuery, timelineQuery, useDirectory, useMe } from "@/lib/queries";
import { newKey } from "@/lib/session";
import { attentionReasons, can, nextTransitions } from "@/lib/workflow";
import { Avatar, Gate, PriorityLabel, PRIORITY_LABEL, StatusBadge } from "@/components/ops/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/items/$key")({
  ssr: false,
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(directoryQuery);
    const item = await context.queryClient.ensureQueryData(itemQuery(params.key));
    if (!item) throw notFound();
  },
  head: ({ params }) => ({
    meta: [
      { title: `${params.key.toUpperCase()} · OpsDesk` },
      { name: "description", content: `Work item ${params.key.toUpperCase()} details, status and activity.` },
      { property: "og:title", content: `${params.key.toUpperCase()} · OpsDesk` },
      { property: "og:description", content: `Work item ${params.key.toUpperCase()} details, status and activity.` },
    ],
  }),
  component: ItemPage,
  notFoundComponent: () => (
    <div className="space-y-2 text-sm">
      <p>That item doesn't exist.</p>
      <Link to="/items" className="underline">
        Back to all items
      </Link>
    </div>
  ),
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div role="alert" className="text-sm">
        {error instanceof Error ? error.message : String(error)}{" "}
        <button className="underline" onClick={() => router.invalidate()}>
          Retry
        </button>
      </div>
    );
  },
});

function ItemPage() {
  const { key } = Route.useParams();
  const { data: item } = useSuspenseQuery(itemQuery(key));
  if (!item) {
    return (
      <div className="space-y-2 text-sm">
        <p>That item doesn't exist.</p>
        <Link to="/items" className="underline">
          Back to all items
        </Link>
      </div>
    );
  }
  return <ItemDetail item={item} />;
}

function ItemDetail({ item }: { item: WorkItem }) {
  const dir = useDirectory();
  const me = useMe();
  const qc = useQueryClient();
  const role = me.roleFor(item.teamId);
  const team = dir.teams.find((t) => t.id === item.teamId);
  const assignee = dir.users.find((u) => u.id === item.assigneeId);
  const requester = dir.users.find((u) => u.id === item.requesterId);
  const reasons = attentionReasons(item, me.user.id, role);
  const transitions = nextTransitions(item);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["item", item.key] });
    qc.invalidateQueries({ queryKey: ["timeline", item.id] });
    qc.invalidateQueries({ queryKey: ["items"] });
    qc.invalidateQueries({ queryKey: ["attention"] });
  };

  const onError = (e: Error) => {
    if (e instanceof ApiError && e.status === 409) {
      toast.error(e.message);
      invalidate();
    } else {
      toast.error(e.message);
    }
  };

  const update = useMutation({
    mutationFn: (patch: Partial<Pick<WorkItem, "title" | "description" | "priority" | "assigneeId">>) =>
      api.updateItem(me.user.id, item.id, patch, { idempotencyKey: newKey(), expectedVersion: item.version }),
    onSuccess: invalidate,
    onError,
  });

  const claim = useMutation({
    mutationFn: () => api.claimItem(me.user.id, item.id, { idempotencyKey: newKey(), expectedVersion: item.version }),
    onSuccess: invalidate,
    onError,
  });

  const transition = useMutation({
    mutationFn: (to: Status) => api.transitionItem(me.user.id, item.id, to, { idempotencyKey: newKey(), expectedVersion: item.version }),
    onSuccess: invalidate,
    onError,
  });

  const busy = update.isPending || claim.isPending || transition.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link to="/items" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="size-3.5" /> All items
        </Link>
        <span>/</span>
        <span className="font-mono">{item.key}</span>
      </div>

      {reasons.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-priority-urgent/30 bg-priority-urgent/5 px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-priority-urgent" />
          <div>
            <span className="font-medium">Needs attention: </span>
            {reasons.join(" · ")}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="space-y-4">
          <Gate reason={can.edit(role) ? null : "Viewers can't edit items"}>
            <Input
              key={`${item.id}-${item.version}-title`}
              defaultValue={item.title}
              disabled={!can.edit(role)}
              className="h-auto border-transparent px-0 text-xl font-semibold tracking-tight shadow-none focus-visible:border-input"
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== item.title) update.mutate({ title: v });
              }}
            />
          </Gate>
          <Gate reason={can.edit(role) ? null : "Viewers can't edit items"}>
            <Textarea
              key={`${item.id}-${item.version}-desc`}
              defaultValue={item.description}
              disabled={!can.edit(role)}
              rows={5}
              className="text-sm"
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v !== item.description) update.mutate({ description: v });
              }}
            />
          </Gate>

          <Suspense fallback={<Skeleton className="h-40" />}>
            <Timeline item={item} onError={onError} invalidate={invalidate} />
          </Suspense>
        </div>

        <aside className="space-y-4 rounded-lg border bg-card p-3 text-sm">
          <div className="flex flex-wrap gap-1.5">
            {transitions.map((t) => {
              const allowed = t.roles.includes(role ?? "viewer");
              return (
                <Gate key={t.to} reason={allowed ? null : "Your role can't do this"}>
                  <Button size="sm" variant={t.to === "closed" || t.to === "resolved" ? "default" : "outline"} disabled={!allowed || busy} onClick={() => transition.mutate(t.to)}>
                    {t.label}
                  </Button>
                </Gate>
              );
            })}
            {!item.assigneeId && (
              <Gate reason={can.claim(role) ? null : "Viewers can't take items"}>
                <Button size="sm" variant="secondary" disabled={!can.claim(role) || busy} onClick={() => claim.mutate()}>
                  Take this
                </Button>
              </Gate>
            )}
          </div>

          <dl className="space-y-3">
            <Row label="Status">
              <StatusBadge status={item.status} />
            </Row>
            <Row label="Priority">
              <Gate reason={can.edit(role) ? null : "Viewers can't edit items"}>
                <Select value={item.priority} disabled={!can.edit(role) || busy} onValueChange={(v) => update.mutate({ priority: v as Priority })}>
                  <SelectTrigger className="h-7 w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["low", "medium", "high", "urgent"] as const).map((p) => (
                      <SelectItem key={p} value={p}>
                        <PriorityLabel priority={p} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Gate>
            </Row>
            <Row label="Assignee">
              <Gate reason={can.assign(role) ? null : "Only managers can assign"}>
                <Select
                  value={item.assigneeId ?? "none"}
                  disabled={!can.assign(role) || busy}
                  onValueChange={(v) => update.mutate({ assigneeId: v === "none" ? null : v })}
                >
                  <SelectTrigger className="h-7 w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {dir.users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Gate>
            </Row>
            <Row label="Team">{team?.name}</Row>
            <Row label="Type">
              <span className="capitalize">{item.type}</span>
            </Row>
            <Row label="Requester">
              <span className="flex items-center gap-1.5">
                <Avatar user={requester} /> {requester?.name}
              </span>
            </Row>
            <Row label="Due">{item.dueAt ? new Date(item.dueAt).toLocaleDateString() : "—"}</Row>
            <Row label="Updated">{formatDistanceToNowStrict(new Date(item.updatedAt), { addSuffix: true })}</Row>
            <Row label="Version">
              <span className="font-mono text-xs">v{item.version}</span>
            </Row>
          </dl>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Timeline({ item, onError, invalidate }: { item: WorkItem; onError: (e: Error) => void; invalidate: () => void }) {
  const dir = useDirectory();
  const me = useMe();
  const role = me.roleFor(item.teamId);
  const { data: entries } = useSuspenseQuery(timelineQuery(item.id));
  const [body, setBody] = useState("");

  const comment = useMutation({
    mutationFn: (text: string) => api.addComment(me.user.id, item.id, text, { idempotencyKey: newKey(), expectedVersion: item.version }),
    onSuccess: () => {
      setBody("");
      invalidate();
    },
    onError,
  });

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">Activity</h2>
      <ol className="space-y-3 border-l pl-4">
        {entries.map((e) => {
          if (e.kind === "comment") {
            const author = dir.users.find((u) => u.id === e.comment.authorId);
            return (
              <li key={e.comment.id} className="relative">
                <span className="absolute top-1.5 -left-[1.35rem] size-2 rounded-full bg-border" />
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Avatar user={author} />
                  <span className="font-medium text-foreground">{author?.name}</span>
                  <span>{formatDistanceToNowStrict(new Date(e.at), { addSuffix: true })}</span>
                </div>
                <p className="mt-1 text-sm">{e.comment.body}</p>
              </li>
            );
          }
          const actor = dir.users.find((u) => u.id === e.event.actorId);
          return (
            <li key={e.event.id} className="relative text-xs text-muted-foreground">
              <span className="absolute top-1 -left-[1.35rem] size-2 rounded-full bg-border" />
              <span className="font-medium text-foreground">{actor?.name}</span> {describeEvent(e.event.type, e.event.from, e.event.to, dir.users)} ·{" "}
              {formatDistanceToNowStrict(new Date(e.at), { addSuffix: true })}
            </li>
          );
        })}
      </ol>
      <Gate reason={can.comment(role) ? null : "Viewers can't comment"}>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = body.trim();
            if (v) comment.mutate(v);
          }}
        >
          <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a comment" disabled={!can.comment(role)} className="h-8 text-sm" />
          <Button type="submit" size="sm" className="h-8" disabled={!can.comment(role) || !body.trim() || comment.isPending}>
            Comment
          </Button>
        </form>
      </Gate>
    </section>
  );
}

function describeEvent(type: string, from: string | null, to: string | null, users: { id: string; name: string }[]): string {
  const name = (id: string | null) => (id ? (users.find((u) => u.id === id)?.name ?? id) : "nobody");
  switch (type) {
    case "created":
      return "created this item";
    case "status_changed":
      return `moved it from ${from} to ${to}`;
    case "assigned":
      return `assigned it to ${name(to)}`;
    case "priority_changed":
      return `changed priority from ${from} to ${to}`;
    case "title_changed":
      return "renamed it";
    case "description_changed":
      return "edited the description";
    default:
      return type;
  }
}
