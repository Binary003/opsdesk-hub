import { Link } from "@tanstack/react-router";
import { formatDistanceToNowStrict } from "date-fns";
import type { WorkItem } from "@/api/types";
import { useDirectory } from "@/lib/queries";
import { isOverdue } from "@/lib/workflow";
import { cn } from "@/lib/utils";
import { Avatar, PriorityLabel, StatusBadge } from "./bits";

export function ItemCompactRow({ item }: { item: WorkItem }) {
  const dir = useDirectory();
  const assignee = dir.users.find((u) => u.id === item.assigneeId);
  return (
    <Link
      to="/items/$key"
      params={{ key: item.key }}
      className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent"
    >
      <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">{item.key}</span>
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      <PriorityLabel priority={item.priority} />
      <DueLabel item={item} />
      <Avatar user={assignee} />
    </Link>
  );
}

export function DueLabel({ item }: { item: WorkItem }) {
  if (!item.dueAt) return <span className="w-20 text-right text-xs text-muted-foreground">—</span>;
  const over = isOverdue(item);
  return (
    <span className={cn("w-20 shrink-0 text-right text-xs", over ? "text-destructive" : "text-muted-foreground")}>
      {over ? `${formatDistanceToNowStrict(new Date(item.dueAt))} late` : `in ${formatDistanceToNowStrict(new Date(item.dueAt))}`}
    </span>
  );
}

export { StatusBadge };
