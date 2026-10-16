import type { Membership, Role, Status, WorkItem } from "@/api/types";

export const QUIET_DAYS = 5;
const DAY = 86_400_000;

export const STATUS_LABEL: Record<Status, string> = {
  open: "Open",
  in_progress: "In progress",
  pending_approval: "Pending approval",
  resolved: "Resolved",
  closed: "Closed",
};

export const ACTIVE: Status[] = ["open", "in_progress", "pending_approval"];

export interface Transition {
  to: Status;
  label: string;
  /** roles allowed to perform it */
  roles: Role[];
}

const WORKERS: Role[] = ["admin", "manager", "member"];
const APPROVERS: Role[] = ["admin", "manager"];

export function nextTransitions(item: Pick<WorkItem, "status" | "requiresApproval">): Transition[] {
  switch (item.status) {
    case "open":
      return [
        { to: "in_progress", label: "Start", roles: WORKERS },
        { to: "closed", label: "Close", roles: APPROVERS },
      ];
    case "in_progress":
      return [
        item.requiresApproval
          ? { to: "pending_approval", label: "Request approval", roles: WORKERS }
          : { to: "resolved", label: "Resolve", roles: WORKERS },
        { to: "open", label: "Stop", roles: WORKERS },
      ];
    case "pending_approval":
      return [
        { to: "resolved", label: "Approve", roles: APPROVERS },
        { to: "in_progress", label: "Reject", roles: APPROVERS },
      ];
    case "resolved":
      return [
        { to: "closed", label: "Close", roles: WORKERS },
        { to: "in_progress", label: "Reopen", roles: WORKERS },
      ];
    case "closed":
      return [{ to: "open", label: "Reopen", roles: APPROVERS }];
  }
}

export function canTransition(item: WorkItem, to: Status, role: Role | null): boolean {
  const t = nextTransitions(item).find((x) => x.to === to);
  return !!t && !!role && t.roles.includes(role);
}

export function roleIn(memberships: Membership[], userId: string, teamId: string): Role | null {
  return memberships.find((m) => m.userId === userId && m.teamId === teamId)?.role ?? null;
}

export const can = {
  edit: (r: Role | null) => r === "admin" || r === "manager" || r === "member",
  assign: (r: Role | null) => r === "admin" || r === "manager",
  claim: (r: Role | null) => r === "admin" || r === "manager" || r === "member",
  comment: (r: Role | null) => r === "admin" || r === "manager" || r === "member",
  approve: (r: Role | null) => r === "admin" || r === "manager",
};

export function isOverdue(item: WorkItem, now = Date.now()): boolean {
  return !!item.dueAt && ACTIVE.includes(item.status) && new Date(item.dueAt).getTime() < now;
}

export function isQuiet(item: WorkItem, now = Date.now()): boolean {
  return ACTIVE.includes(item.status) && now - new Date(item.updatedAt).getTime() > QUIET_DAYS * DAY;
}

export function isUrgentUnassigned(item: WorkItem): boolean {
  return item.priority === "urgent" && item.assigneeId === null && ACTIVE.includes(item.status);
}

export function attentionReasons(item: WorkItem, userId: string, role: Role | null, now = Date.now()): string[] {
  const r: string[] = [];
  if (item.status === "pending_approval" && can.approve(role)) r.push("Waiting for your approval");
  if (isUrgentUnassigned(item)) r.push("Urgent and nobody owns it");
  if (isOverdue(item, now)) r.push("Past its due date");
  if (item.assigneeId === userId && isQuiet(item, now)) r.push(`No activity for over ${QUIET_DAYS} days`);
  return r;
}
