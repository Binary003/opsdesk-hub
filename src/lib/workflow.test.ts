import { describe, expect, it } from "vitest";
import { canTransition, nextTransitions } from "./workflow";
import type { WorkItem } from "@/api/types";

const base = { status: "in_progress", requiresApproval: false } as WorkItem;

describe("workflow", () => {
  it("in_progress with approval goes to pending_approval, not resolved", () => {
    const t = nextTransitions({ ...base, requiresApproval: true }).map((x) => x.to);
    expect(t).toContain("pending_approval");
    expect(t).not.toContain("resolved");
  });
  it("only managers/admins approve", () => {
    const item = { ...base, status: "pending_approval" } as WorkItem;
    expect(canTransition(item, "resolved", "member")).toBe(false);
    expect(canTransition(item, "resolved", "manager")).toBe(true);
  });
  it("viewers cannot transition", () => {
    expect(canTransition(base, "resolved", "viewer")).toBe(false);
  });
});
