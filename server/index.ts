import "dotenv/config";
import cors from "cors";
import express, { type Request, type Response } from "express";
import mongoose, { Schema } from "mongoose";

type Status = "open" | "in_progress" | "pending_approval" | "resolved" | "closed";
type Priority = "low" | "medium" | "high" | "urgent";
type Role = "admin" | "manager" | "member" | "viewer";
type ItemType = "incident" | "request" | "task" | "change";

type WorkItem = {
  id: string; key: string; teamId: string; title: string; description: string; type: ItemType;
  status: Status; priority: Priority; assigneeId: string | null; requesterId: string;
  dueAt: string | null; requiresApproval: boolean; version: number; createdAt: string; updatedAt: string;
};
type ItemEvent = { id: string; itemId: string; actorId: string; type: string; from: string | null; to: string | null; at: string };
type Comment = { id: string; itemId: string; authorId: string; body: string; createdAt: string };
type Team = { id: string; key: string; name: string };
type User = { id: string; name: string; email: string; initials: string };
type Membership = { userId: string; teamId: string; role: Role };

const itemSchema = new Schema<WorkItem>({
  id: { type: String, unique: true, required: true }, key: { type: String, unique: true, required: true },
  teamId: { type: String, required: true }, title: { type: String, required: true }, description: { type: String, default: "" },
  type: { type: String, enum: ["incident", "request", "task", "change"], required: true },
  status: { type: String, enum: ["open", "in_progress", "pending_approval", "resolved", "closed"], required: true },
  priority: { type: String, enum: ["low", "medium", "high", "urgent"], required: true },
  assigneeId: { type: String, default: null }, requesterId: { type: String, required: true },
  dueAt: { type: String, default: null }, requiresApproval: { type: Boolean, default: false },
  version: { type: Number, default: 1 }, createdAt: { type: String, required: true }, updatedAt: { type: String, required: true },
}, { _id: false });
const eventSchema = new Schema<ItemEvent>({}, { _id: false, strict: false });
const commentSchema = new Schema<Comment>({}, { _id: false, strict: false });
const Item = mongoose.model<WorkItem>("WorkItem", itemSchema, "items");
const Event = mongoose.model<ItemEvent>("ItemEvent", eventSchema, "item_events");
const CommentModel = mongoose.model<Comment>("Comment", commentSchema, "comments");

const teams: Team[] = [
  { id: "t1", key: "FAC", name: "Facilities" }, { id: "t2", key: "IT", name: "IT Support" },
  { id: "t3", key: "FIN", name: "Finance Ops" }, { id: "t4", key: "PPL", name: "People Ops" },
  { id: "t5", key: "SEC", name: "Security" },
];
const names = ["Priya Raman", "Marcus Webb", "Lena Okafor", "Tomás Ruiz", "Hana Sato", "Owen Brooks", "Aisha Khan", "Jonas Berg"];
const users: User[] = names.map((name, index) => ({
  id: `u${index + 1}`, name, email: `${name.split(" ")[0]!.toLowerCase()}@opsdesk.internal`,
  initials: name.split(" ").map((part) => part[0] ?? "").join(""),
}));
const memberships: Membership[] = [];
teams.forEach((team, index) => {
  memberships.push({ userId: "u1", teamId: team.id, role: "admin" });
  memberships.push({ userId: index % 2 === 0 ? "u2" : "u3", teamId: team.id, role: "manager" });
  memberships.push({ userId: index % 2 === 0 ? "u3" : "u2", teamId: team.id, role: "member" });
  ["u4", "u5", "u6", "u7"].forEach((userId) => memberships.push({ userId, teamId: team.id, role: "member" }));
  memberships.push({ userId: "u8", teamId: team.id, role: "viewer" });
});

const id = (prefix: string) => `${prefix}_${new mongoose.Types.ObjectId().toString()}`;
const roleFor = (userId: string, teamId: string) => memberships.find((membership) => membership.userId === userId && membership.teamId === teamId)?.role ?? null;
const worker = (role: Role | null) => role === "admin" || role === "manager" || role === "member";
const approver = (role: Role | null) => role === "admin" || role === "manager";
const active = (status: Status) => ["open", "in_progress", "pending_approval"].includes(status);
const isOverdue = (item: WorkItem) => !!item.dueAt && active(item.status) && new Date(item.dueAt).getTime() < Date.now();
const isQuiet = (item: WorkItem) => active(item.status) && Date.now() - new Date(item.updatedAt).getTime() > 5 * 86_400_000;
const isUrgentUnassigned = (item: WorkItem) => item.priority === "urgent" && !item.assigneeId && active(item.status);

function transitions(item: WorkItem): Array<{ to: Status; roles: Role[] }> {
  if (item.status === "open") return [{ to: "in_progress", roles: ["admin", "manager", "member"] }, { to: "closed", roles: ["admin", "manager"] }];
  if (item.status === "in_progress") return [{ to: item.requiresApproval ? "pending_approval" : "resolved", roles: ["admin", "manager", "member"] }, { to: "open", roles: ["admin", "manager", "member"] }];
  if (item.status === "pending_approval") return [{ to: "resolved", roles: ["admin", "manager"] }, { to: "in_progress", roles: ["admin", "manager"] }];
  if (item.status === "resolved") return [{ to: "closed", roles: ["admin", "manager", "member"] }, { to: "in_progress", roles: ["admin", "manager", "member"] }];
  return [{ to: "open", roles: ["admin", "manager"] }];
}

const api = express();
api.use(cors());
api.use(express.json());
api.get("/api/health", (_req, res) => res.json({ ok: true }));

function actor(req: Request) { return req.header("x-actor-id") ?? ""; }
function expectedVersion(req: Request) { return Number(req.header("x-expected-version") ?? 0); }
function sendError(res: Response, error: unknown) {
  const status = error instanceof ApiHttpError ? error.status : 500;
  res.status(status).json({ message: error instanceof Error ? error.message : "Internal server error" });
}
class ApiHttpError extends Error { constructor(public status: number, message: string) { super(message); } }
async function findItem(idOrKey: string) {
  const item = await Item.findOne({ $or: [{ id: idOrKey }, { key: idOrKey.toUpperCase() }] }).lean();
  if (!item) throw new ApiHttpError(404, "Item not found");
  return item;
}
async function guard(item: WorkItem, req: Request, allow: (role: Role | null) => boolean) {
  if (item.version !== expectedVersion(req)) throw new ApiHttpError(409, `This item was changed by someone else (now v${item.version}).`);
  const role = roleFor(actor(req), item.teamId);
  if (!allow(role)) throw new ApiHttpError(403, "You don't have permission to do that");
  return role;
}
async function recordEvent(item: WorkItem, req: Request, type: string, from: string | null, to: string | null) {
  const now = new Date().toISOString();
  await Item.updateOne({ id: item.id }, { $set: { updatedAt: now }, $inc: { version: 1 } });
  await Event.create({ id: id("evt"), itemId: item.id, actorId: actor(req), type, from, to, at: now });
  return findItem(item.id);
}
function dedupe(req: Request, res: Response, next: () => void) {
  const key = req.header("x-idempotency-key");
  if (!key) return next();
  res.locals["idempotencyKey"] = key;
  return next();
}
api.use("/api", dedupe);

api.get("/api/directory", (_req, res) => res.json({ users, teams, memberships }));
api.get("/api/items", async (req, res) => {
  try {
    const query = req.query;
    const filter: Record<string, unknown> = {};
    if (query["teamId"]) filter["teamId"] = query["teamId"];
    if (query["status"]) filter["status"] = query["status"];
    if (query["priority"]) filter["priority"] = query["priority"];
    if (query["assigneeId"] === "unassigned") filter["assigneeId"] = null;
    else if (query["assigneeId"]) filter["assigneeId"] = query["assigneeId"];
    if (query["q"]) filter["$or"] = [{ title: { $regex: String(query["q"]), $options: "i" } }, { key: { $regex: String(query["q"]), $options: "i" } }];
    let items = (await Item.find(filter).sort({ updatedAt: -1, id: -1 }).lean()) as WorkItem[];
    if (query["overdue"] === "true") items = items.filter(isOverdue);
    if (query["quiet"] === "true") items = items.filter(isQuiet);
    const limit = Math.min(Number(query["limit"] ?? 25), 100);
    const cursor = query["cursor"] ? items.findIndex((item) => item.id === query["cursor"]) + 1 : 0;
    const page = items.slice(cursor, cursor + limit);
    res.json({ items: page, nextCursor: cursor + limit < items.length ? page.at(-1)?.id ?? null : null, total: items.length });
  } catch (error) { sendError(res, error); }
});
api.get("/api/items/:key", async (req, res) => {
  try { res.json(await findItem(req.params.key)); } catch (error) {
    if (error instanceof ApiHttpError && error.status === 404) return res.json(null);
    return sendError(res, error);
  }
});
api.post("/api/items", async (req, res) => {
  try {
    const { teamId, title, description, type, priority, dueAt, requiresApproval, assigneeId } = req.body;
    const role = roleFor(actor(req), teamId);
    if (!worker(role)) throw new ApiHttpError(403, "You can't create items in this team");
    if (assigneeId && !approver(role)) throw new ApiHttpError(403, "Only managers can assign on create");
    const team = teams.find((entry) => entry.id === teamId);
    if (!team) throw new ApiHttpError(422, "Invalid team");
    const count = await Item.countDocuments({ teamId });
    const now = new Date().toISOString();
    const item: WorkItem = { id: id("itm"), key: `${team.key}-${count + 1}`, teamId, title: String(title).trim(), description: String(description ?? "").trim(), type, priority, status: "open", assigneeId: assigneeId ?? null, requesterId: actor(req), dueAt: dueAt ?? null, requiresApproval: Boolean(requiresApproval), version: 1, createdAt: now, updatedAt: now };
    await Item.create(item);
    await Event.create({ id: id("evt"), itemId: item.id, actorId: actor(req), type: "created", from: null, to: "open", at: now });
    res.status(201).json(item);
  } catch (error) { sendError(res, error); }
});
api.patch("/api/items/:id", async (req, res) => {
  try {
    const item = await findItem(req.params.id);
    const needsAssign = "assigneeId" in req.body && req.body.assigneeId !== item.assigneeId;
    await guard(item, req, needsAssign ? approver : worker);
    let current = item;
    for (const [field, eventType] of [["title", "title_changed"], ["description", "description_changed"], ["priority", "priority_changed"], ["assigneeId", "assigned"]] as const) {
      if (!(field in req.body) || req.body[field] === current[field]) continue;
      const from = field === "description" ? null : String(current[field] ?? "");
      await Item.updateOne({ id: current.id }, { $set: { [field]: req.body[field] ?? null } });
      current = await recordEvent(current, req, eventType, from, String(req.body[field] ?? ""));
    }
    res.json(current);
  } catch (error) { sendError(res, error); }
});
api.post("/api/items/:id/claim", async (req, res) => {
  try {
    const item = await findItem(req.params.id);
    await guard(item, req, worker);
    if (item.assigneeId) throw new ApiHttpError(409, "Someone already took this item");
    await Item.updateOne({ id: item.id, assigneeId: null }, { $set: { assigneeId: actor(req) } });
    res.json(await recordEvent(item, req, "assigned", null, actor(req)));
  } catch (error) { sendError(res, error); }
});
api.post("/api/items/:id/transition", async (req, res) => {
  try {
    const item = await findItem(req.params.id);
    const role = await guard(item, req, () => true);
    const next = transitions(item).find((entry) => entry.to === req.body.to);
    if (!next || !role || !next.roles.includes(role)) throw new ApiHttpError(422, "That status change isn't allowed");
    await Item.updateOne({ id: item.id }, { $set: { status: req.body.to } });
    res.json(await recordEvent(item, req, "status_changed", item.status, req.body.to));
  } catch (error) { sendError(res, error); }
});
api.post("/api/items/:id/comments", async (req, res) => {
  try {
    const item = await findItem(req.params.id);
    await guard(item, req, worker);
    const comment: Comment = { id: id("cmt"), itemId: item.id, authorId: actor(req), body: String(req.body.body ?? "").trim(), createdAt: new Date().toISOString() };
    if (!comment.body) throw new ApiHttpError(422, "Comment cannot be empty");
    await CommentModel.create(comment);
    await Item.updateOne({ id: item.id }, { $inc: { version: 1 }, $set: { updatedAt: comment.createdAt } });
    res.status(201).json(comment);
  } catch (error) { sendError(res, error); }
});
api.get("/api/items/:id/timeline", async (req, res) => {
  try {
    const item = await findItem(req.params.id);
    const [events, comments] = await Promise.all([Event.find({ itemId: item.id }).lean(), CommentModel.find({ itemId: item.id }).lean()]);
    res.json([...events.map((event) => ({ kind: "event", at: event.at, event })), ...comments.map((comment) => ({ kind: "comment", at: comment.createdAt, comment }))].sort((a, b) => a.at.localeCompare(b.at)));
  } catch (error) { sendError(res, error); }
});
api.get("/api/attention/:userId", async (req, res) => {
  try {
    let items = (await Item.find({ status: { $in: ["open", "in_progress", "pending_approval"] } }).lean()) as WorkItem[];
    const approverTeams = memberships.filter((membership) => membership.userId === req.params.userId && approver(membership.role)).map((membership) => membership.teamId);
    const bucket = (list: WorkItem[]) => ({ items: list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5), total: list.length });
    res.json({ awaitingApproval: bucket(items.filter((item) => item.status === "pending_approval" && approverTeams.includes(item.teamId))), urgentUnassigned: bucket(items.filter(isUrgentUnassigned)), overdue: bucket(items.filter(isOverdue)), quiet: bucket(items.filter((item) => item.assigneeId === req.params.userId && isQuiet(item))) });
  } catch (error) { sendError(res, error); }
});

const port = Number(process.env["API_PORT"] ?? 4000);
async function start() {
  const uri = process.env["MONGODB_URI"];
  if (!uri) throw new Error("MONGODB_URI is required. Copy .env.example to .env and set it.");
  await mongoose.connect(uri);
  if (await Item.countDocuments() === 0) {
    const now = new Date().toISOString();
    const seededItems = teams.flatMap((team, teamIndex) =>
      Array.from({ length: 5 }, (_, index): WorkItem => ({
        id: id("itm"),
        key: `${team.key}-${index + 1}`,
        teamId: team.id,
        title: `${team.name} work item ${index + 1}`,
        description: `Seeded ${team.name.toLowerCase()} request for the OpsDesk workspace.`,
        type: (["incident", "request", "task", "change"] as const)[index % 4]!,
        status: (["open", "in_progress", "pending_approval", "resolved", "closed"] as const)[(index + teamIndex) % 5]!,
        priority: (["low", "medium", "high", "urgent"] as const)[index % 4]!,
        assigneeId: index % 3 === 0 ? null : `u${((index + teamIndex) % 7) + 1}`,
        requesterId: `u${(teamIndex % 7) + 1}`,
        dueAt: null,
        requiresApproval: index === 2,
        version: 1,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await Item.insertMany(seededItems);
    await Event.insertMany(seededItems.map((item) => ({
      id: id("evt"), itemId: item.id, actorId: item.requesterId, type: "created", from: null, to: "open", at: now,
    })));
  }
  api.listen(port, () => console.log(`OpsDesk API listening on http://localhost:${port}/api`));
}
start().catch((error) => { console.error(error); process.exitCode = 1; });
