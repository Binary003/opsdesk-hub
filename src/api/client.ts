import type {
  Attention,
  Comment,
  Directory,
  ItemEvent,
  ItemType,
  ListParams,
  Membership,
  MutationOptions,
  Page,
  Priority,
  Status,
  Team,
  TimelineEntry,
  User,
  WorkItem,
} from "./types";
import { ACTIVE, canTransition, isOverdue, isQuiet, isUrgentUnassigned, roleIn } from "@/lib/workflow";

/** Base URL for the real backend. The in-memory implementation below ignores it. */
export const API_URL: string = import.meta.env["VITE_API_URL"] ?? "";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export class ConflictError extends ApiError {
  constructor(public currentVersion: number) {
    super(409, `This item was changed by someone else (now v${currentVersion}). Reload to see the latest.`);
  }
}

// ---------------------------------------------------------------- fake data
let seed = 42;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]!;
const DAY = 86_400_000;
const now = Date.now();
const iso = (t: number) => new Date(t).toISOString();

const teams: Team[] = [
  { id: "t1", key: "FAC", name: "Facilities" },
  { id: "t2", key: "IT", name: "IT Support" },
  { id: "t3", key: "FIN", name: "Finance Ops" },
  { id: "t4", key: "PPL", name: "People Ops" },
  { id: "t5", key: "SEC", name: "Security" },
];

const names = [
  "Priya Raman",
  "Marcus Webb",
  "Lena Okafor",
  "Tomás Ruiz",
  "Hana Sato",
  "Owen Brooks",
  "Aisha Khan",
  "Jonas Berg",
];
const users: User[] = names.map((n, i) => ({
  id: `u${i + 1}`,
  name: n,
  email: `${n.split(" ")[0].toLowerCase()}@opsdesk.internal`,
  initials: n
    .split(" ")
    .map((p) => p[0] ?? "")
    .join(""),
}));

// u1 admin everywhere; u2,u3 managers; u4-u7 members; u8 viewer
const memberships: Membership[] = [];
teams.forEach((t, ti) => {
  memberships.push({ userId: "u1", teamId: t.id, role: "admin" });
  memberships.push({ userId: ti % 2 === 0 ? "u2" : "u3", teamId: t.id, role: "manager" });
  memberships.push({ userId: ti % 2 === 0 ? "u3" : "u2", teamId: t.id, role: "member" });
  ["u4", "u5", "u6", "u7"].forEach((u) => memberships.push({ userId: u, teamId: t.id, role: "member" }));
  memberships.push({ userId: "u8", teamId: t.id, role: "viewer" });
});

const subjects: Record<string, string[]> = {
  t1: ["Badge reader offline at north entrance", "HVAC noise on floor 3", "Replace broken desk chairs", "Book large room for offsite", "Leak under kitchen sink"],
  t2: ["Laptop provisioning for new hire", "VPN drops every 20 minutes", "Reset MFA device", "Printer queue stuck", "Upgrade shared drive quota"],
  t3: ["Vendor invoice mismatch", "Approve Q3 software renewals", "Expense report rejected incorrectly", "Set up new cost center", "Wire transfer confirmation"],
  t4: ["Onboarding packet for contractors", "Update parental leave policy page", "Benefits enrollment question", "Schedule exit interview", "Org chart out of date"],
  t5: ["Phishing report from finance", "Access review for prod database", "Rotate leaked API token", "Visitor NDA process", "Lost badge deactivation"],
};
const types: ItemType[] = ["incident", "request", "task", "change"];
const statuses: Status[] = ["open", "open", "in_progress", "in_progress", "pending_approval", "resolved", "closed"];
const priorities: Priority[] = ["low", "medium", "medium", "high", "urgent"];

const items: WorkItem[] = [];
const events: ItemEvent[] = [];
const comments: Comment[] = [];
const counters: Record<string, number> = {};
let idSeq = 1;
const nid = (p: string) => `${p}_${idSeq++}`;

for (let i = 0; i < 100; i++) {
  const team = teams[i % 5]!;
  counters[team.id] = (counters[team.id] ?? 0) + 1;
  const created = now - Math.floor(rand() * 40 * DAY);
  const updated = Math.min(now, created + Math.floor(rand() * 30 * DAY));
  const status = pick(statuses);
  const requiresApproval = status === "pending_approval" || rand() < 0.25;
  const members = memberships.filter((m) => m.teamId === team.id && m.role !== "viewer").map((m) => m.userId);
  const item: WorkItem = {
    id: nid("itm"),
    key: `${team.key}-${counters[team.id]}`,
    teamId: team.id,
    title: pick(subjects[team.id]!),
    description: "",
    type: pick(types),
    status,
    priority: pick(priorities),
    assigneeId: rand() < 0.3 ? null : pick(members),
    requesterId: pick(users).id,
    dueAt: rand() < 0.6 ? iso(created + Math.floor((rand() * 30 - 5) * DAY)) : null,
    requiresApproval,
    version: 1,
    createdAt: iso(created),
    updatedAt: iso(updated),
  };
  item.description = `Reported via ${item.type === "incident" ? "on-call channel" : "service portal"}. ${item.title}.`;
  items.push(item);
  events.push({ id: nid("evt"), itemId: item.id, actorId: item.requesterId, type: "created", from: null, to: "open", at: item.createdAt });
  if (status !== "open") {
    events.push({ id: nid("evt"), itemId: item.id, actorId: item.assigneeId ?? "u1", type: "status_changed", from: "open", to: status, at: item.updatedAt });
  }
  if (rand() < 0.5) {
    comments.push({
      id: nid("cmt"),
      itemId: item.id,
      authorId: pick(users).id,
      body: pick(["Looking into this now.", "Can you share more detail?", "Blocked on vendor response.", "Should be done by end of week."]),
      createdAt: iso(Math.floor((created + updated) / 2)),
    });
  }
}

// ---------------------------------------------------------------- helpers
const delay = (ms = 150 + Math.random() * 200) => new Promise((r) => setTimeout(r, ms));
const clone = <T,>(v: T): T => structuredClone(v);
const idempotency = new Map<string, unknown>();

async function mutate<T>(key: string, fn: () => T): Promise<T> {
  await delay();
  if (idempotency.has(key)) return clone(idempotency.get(key) as T);
  const result = fn();
  idempotency.set(key, result);
  return clone(result);
}

function findItem(id: string) {
  const it = items.find((i) => i.id === id);
  if (!it) throw new ApiError(404, "Item not found");
  return it;
}

function guard(item: WorkItem, actorId: string, expectedVersion: number, allowed: (role: ReturnType<typeof roleIn>) => boolean) {
  if (item.version !== expectedVersion) throw new ConflictError(item.version);
  const role = roleIn(memberships, actorId, item.teamId);
  if (!allowed(role)) throw new ApiError(403, "You don't have permission to do that");
  return role;
}

function bump(item: WorkItem, actorId: string, type: ItemEvent["type"], from: string | null, to: string | null) {
  item.version += 1;
  item.updatedAt = new Date().toISOString();
  events.push({ id: nid("evt"), itemId: item.id, actorId, type, from, to, at: item.updatedAt });
}

const byUpdatedDesc = (a: WorkItem, b: WorkItem) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id);
const isWorker = (r: ReturnType<typeof roleIn>) => r === "admin" || r === "manager" || r === "member";
const isApprover = (r: ReturnType<typeof roleIn>) => r === "admin" || r === "manager";

// ---------------------------------------------------------------- API
export async function getDirectory(): Promise<Directory> {
  await delay(80);
  return clone({ users, teams, memberships });
}

export async function listItems(params: ListParams): Promise<Page<WorkItem>> {
  await delay();
  const q = params.q?.trim().toLowerCase();
  const t = Date.now();
  const filtered = items
    .filter((i) => !params.teamId || i.teamId === params.teamId)
    .filter((i) => !params.status || i.status === params.status)
    .filter((i) => !params.priority || i.priority === params.priority)
    .filter((i) =>
      !params.assigneeId ? true : params.assigneeId === "unassigned" ? i.assigneeId === null : i.assigneeId === params.assigneeId,
    )
    .filter((i) => !params.overdue || isOverdue(i, t))
    .filter((i) => !params.quiet || isQuiet(i, t))
    .filter((i) => !q || i.title.toLowerCase().includes(q) || i.key.toLowerCase().includes(q))
    .sort(byUpdatedDesc);
  const limit = params.limit ?? 25;
  const start = params.cursor ? filtered.findIndex((i) => i.id === params.cursor) + 1 : 0;
  const page = filtered.slice(start, start + limit);
  const nextCursor = start + limit < filtered.length ? page[page.length - 1]!.id : null;
  return clone({ items: page, nextCursor, total: filtered.length });
}

export async function getItem(key: string): Promise<WorkItem | null> {
  await delay();
  const it = items.find((i) => i.key.toLowerCase() === key.toLowerCase());
  return it ? clone(it) : null;
}

export async function createItem(
  actorId: string,
  input: Pick<WorkItem, "teamId" | "title" | "description" | "type" | "priority" | "dueAt" | "requiresApproval" | "assigneeId">,
  opts: { idempotencyKey: string; expectedVersion: 0 },
): Promise<WorkItem> {
  return mutate(opts.idempotencyKey, () => {
    const role = roleIn(memberships, actorId, input.teamId);
    if (!isWorker(role)) throw new ApiError(403, "You can't create items in this team");
    if (input.assigneeId && !isApprover(role)) throw new ApiError(403, "Only managers can assign on create");
    const team = teams.find((t) => t.id === input.teamId)!;
    counters[team.id] = (counters[team.id] ?? 0) + 1;
    const at = new Date().toISOString();
    const item: WorkItem = {
      ...input,
      id: nid("itm"),
      key: `${team.key}-${counters[team.id]}`,
      status: "open",
      requesterId: actorId,
      version: 1,
      createdAt: at,
      updatedAt: at,
    };
    items.push(item);
    events.push({ id: nid("evt"), itemId: item.id, actorId, type: "created", from: null, to: "open", at });
    return item;
  });
}

export async function updateItem(
  actorId: string,
  id: string,
  patch: Partial<Pick<WorkItem, "title" | "description" | "priority" | "assigneeId">>,
  opts: MutationOptions,
): Promise<WorkItem> {
  return mutate(opts.idempotencyKey, () => {
    const item = findItem(id);
    const needsAssign = "assigneeId" in patch && patch.assigneeId !== item.assigneeId;
    guard(item, actorId, opts.expectedVersion, needsAssign ? isApprover : isWorker);
    if (patch.title !== undefined && patch.title !== item.title) {
      const from = item.title;
      item.title = patch.title;
      bump(item, actorId, "title_changed", from, patch.title);
    }
    if (patch.description !== undefined && patch.description !== item.description) {
      item.description = patch.description;
      bump(item, actorId, "description_changed", null, null);
    }
    if (patch.priority && patch.priority !== item.priority) {
      const from = item.priority;
      item.priority = patch.priority;
      bump(item, actorId, "priority_changed", from, patch.priority);
    }
    if (needsAssign) {
      const from = item.assigneeId;
      item.assigneeId = patch.assigneeId ?? null;
      bump(item, actorId, "assigned", from, item.assigneeId);
    }
    return item;
  });
}

export async function claimItem(actorId: string, id: string, opts: MutationOptions): Promise<WorkItem> {
  return mutate(opts.idempotencyKey, () => {
    const item = findItem(id);
    guard(item, actorId, opts.expectedVersion, isWorker);
    if (item.assigneeId) throw new ApiError(409, "Someone already took this item");
    item.assigneeId = actorId;
    bump(item, actorId, "assigned", null, actorId);
    return item;
  });
}

export async function transitionItem(actorId: string, id: string, to: Status, opts: MutationOptions): Promise<WorkItem> {
  return mutate(opts.idempotencyKey, () => {
    const item = findItem(id);
    const role = guard(item, actorId, opts.expectedVersion, () => true);
    if (!canTransition(item, to, role)) throw new ApiError(422, "That status change isn't allowed");
    const from = item.status;
    item.status = to;
    bump(item, actorId, "status_changed", from, to);
    return item;
  });
}

export async function addComment(actorId: string, id: string, body: string, opts: MutationOptions): Promise<Comment> {
  return mutate(opts.idempotencyKey, () => {
    const item = findItem(id);
    guard(item, actorId, opts.expectedVersion, isWorker);
    const c: Comment = { id: nid("cmt"), itemId: id, authorId: actorId, body, createdAt: new Date().toISOString() };
    comments.push(c);
    item.version += 1;
    item.updatedAt = c.createdAt;
    return c;
  });
}

export async function getTimeline(id: string): Promise<TimelineEntry[]> {
  await delay();
  const entries: TimelineEntry[] = [
    ...events.filter((e) => e.itemId === id).map((event) => ({ kind: "event" as const, at: event.at, event })),
    ...comments.filter((c) => c.itemId === id).map((comment) => ({ kind: "comment" as const, at: comment.createdAt, comment })),
  ];
  return clone(entries.sort((a, b) => a.at.localeCompare(b.at)));
}

export async function getAttention(userId: string): Promise<Attention> {
  await delay();
  const t = Date.now();
  const approverTeams = memberships.filter((m) => m.userId === userId && isApprover(m.role)).map((m) => m.teamId);
  const bucket = (list: WorkItem[]) => ({ items: clone(list.sort(byUpdatedDesc).slice(0, 5)), total: list.length });
  const active = items.filter((i) => ACTIVE.includes(i.status));
  return {
    awaitingApproval: bucket(active.filter((i) => i.status === "pending_approval" && approverTeams.includes(i.teamId))),
    urgentUnassigned: bucket(active.filter(isUrgentUnassigned)),
    overdue: bucket(active.filter((i) => isOverdue(i, t))),
    quiet: bucket(active.filter((i) => i.assigneeId === userId && isQuiet(i, t))),
  };
}
