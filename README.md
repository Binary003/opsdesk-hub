# OpsDesk Hub

Build "OpsDesk", an internal operations work-item tracker. React + TypeScript + Vite + Tailwind + shadcn/ui + React Router + TanStack Query. Clean, dense, Linear-like, light/dark mode.

Put all data access in src/api/client.ts (typed functions: listItems, getItem, createItem, updateItem, claimItem, transitionItem, addComment, getTimeline, getAttention). For now they return in-memory fake data (~100 items, 5 teams, 8 users) with a small delay. Base URL from VITE_API_URL so a real backend can replace it later. Every mutation function accepts an idempotencyKey and an expectedVersion argument.

Types: WorkItem {id, key, teamId, title, description, type, status: open|in_progress|pending_approval|resolved|closed, priority: low|medium|high|urgent, assigneeId|null, requesterId, dueAt|null, requiresApproval, version, createdAt, updatedAt}; ItemEvent {id, itemId, actorId, type, from, to, at}; Comment; User; Team; Membership {userId, teamId, role: admin|manager|member|viewer}.

Pages:

1. "/" Needs Attention dashboard: cards for Awaiting my approval, Urgent & unassigned, Overdue, My items gone quiet. Top 5 rows each with "View all" linking to /items with filters prefilled.

2. "/items" table with filters (team, status, priority, assignee incl. Unassigned/Me, overdue), debounced search, cursor-based "Load more", filters stored in the URL, skeleton + empty states.

3. "/items/:key" detail: editable title/description, status buttons showing only valid next transitions, "Take this" button when unassigned, priority and assignee selectors, and a timeline mixing events and comments with a comment box. Show a "what needs attention" banner and the version number.

4. Create-item dialog.

Top bar: "Switch user" dropdown (demo login) that changes the current user and role. Disable controls the role can't use, with tooltips.

No extra features, no placeholder text.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
corepack pnpm install
copy .env.example .env
# Set MONGODB_URI in .env
corepack pnpm run dev:api
# In a second terminal:
corepack pnpm run dev
```

The API uses Express and Mongoose. Set `VITE_API_URL=http://localhost:4000/api` in `.env` to use MongoDB-backed data. If it is empty, the frontend uses its local demo data.

For MongoDB Atlas, use the connection string Atlas provides, for example:

```env
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>/<database>?retryWrites=true&w=majority
API_PORT=4000
VITE_API_URL=http://localhost:4000/api
```
