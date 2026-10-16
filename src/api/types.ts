export type Status = "open" | "in_progress" | "pending_approval" | "resolved" | "closed";
export type Priority = "low" | "medium" | "high" | "urgent";
export type Role = "admin" | "manager" | "member" | "viewer";
export type ItemType = "incident" | "request" | "task" | "change";

export interface WorkItem {
  id: string;
  key: string;
  teamId: string;
  title: string;
  description: string;
  type: ItemType;
  status: Status;
  priority: Priority;
  assigneeId: string | null;
  requesterId: string;
  dueAt: string | null;
  requiresApproval: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type ItemEventType =
  | "created"
  | "status_changed"
  | "assigned"
  | "priority_changed"
  | "title_changed"
  | "description_changed";

export interface ItemEvent {
  id: string;
  itemId: string;
  actorId: string;
  type: ItemEventType;
  from: string | null;
  to: string | null;
  at: string;
}

export interface Comment {
  id: string;
  itemId: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  initials: string;
}

export interface Team {
  id: string;
  key: string;
  name: string;
}

export interface Membership {
  userId: string;
  teamId: string;
  role: Role;
}

export type TimelineEntry =
  | { kind: "event"; at: string; event: ItemEvent }
  | { kind: "comment"; at: string; comment: Comment };

export interface ListParams {
  teamId?: string;
  status?: Status;
  priority?: Priority;
  /** user id, or "unassigned" */
  assigneeId?: string;
  overdue?: boolean;
  quiet?: boolean;
  q?: string;
  cursor?: string | null;
  limit?: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}

export interface AttentionBucket {
  items: WorkItem[];
  total: number;
}

export interface Attention {
  awaitingApproval: AttentionBucket;
  urgentUnassigned: AttentionBucket;
  overdue: AttentionBucket;
  quiet: AttentionBucket;
}

export interface MutationOptions {
  idempotencyKey: string;
  expectedVersion: number;
}

export interface Directory {
  users: User[];
  teams: Team[];
  memberships: Membership[];
}
