import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Priority, Status, User } from "@/api/types";
import { STATUS_LABEL } from "@/lib/workflow";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const statusDot: Record<Status, string> = {
  open: "bg-status-open",
  in_progress: "bg-status-progress",
  pending_approval: "bg-status-approval",
  resolved: "bg-status-resolved",
  closed: "bg-status-closed",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-foreground">
      <span className={cn("size-2 rounded-full", statusDot[status])} />
      {STATUS_LABEL[status]}
    </span>
  );
}

const prioClass: Record<Priority, string> = {
  low: "text-muted-foreground",
  medium: "text-foreground",
  high: "text-priority-high",
  urgent: "text-priority-urgent font-semibold",
};

export const PRIORITY_LABEL: Record<Priority, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };

export function PriorityLabel({ priority }: { priority: Priority }) {
  const bars = { low: 1, medium: 2, high: 3, urgent: 4 }[priority];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", prioClass[priority])}>
      <span className="flex items-end gap-px" aria-hidden>
        {[1, 2, 3, 4].map((b) => (
          <span key={b} className={cn("w-[3px] rounded-sm", b <= bars ? "bg-current" : "bg-border")} style={{ height: 3 + b * 2 }} />
        ))}
      </span>
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function Avatar({ user, size = "sm" }: { user: User | undefined | null; size?: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-secondary font-medium text-secondary-foreground",
        size === "sm" ? "size-5 text-[10px]" : "size-7 text-xs",
      )}
    >
      {user ? user.initials : "–"}
    </span>
  );
}

/** Wraps a control; when `reason` is set, shows it as a tooltip (control should be disabled). */
export function Gate({ reason, children }: { reason: string | null; children: ReactNode }) {
  if (!reason) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex cursor-not-allowed">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="font-mono text-xs text-muted-foreground">{children}</span>;
}
