import { afterEach, describe, expect, it } from "vitest";

import path from "node:path";

import { resolveAgentWorktreeDir } from "@/lib/projects/worktrees.server";
import { buildAgentInstruction } from "@/lib/projects/message";

const previousStateDir = process.env.OPENCLAW_STATE_DIR;

afterEach(() => {
  if (previousStateDir === undefined) {
    delete process.env.OPENCLAW_STATE_DIR;
  } else {
    process.env.OPENCLAW_STATE_DIR = previousStateDir;
  }
});

describe("worktrees", () => {
  it("resolves deterministic worktree paths", () => {
    process.env.OPENCLAW_STATE_DIR = "/tmp/openclaw-test-state";
    const resolved = resolveAgentWorktreeDir("project-1", "agent-2");
    expect(resolved).toBe(
      path.join(
        "/tmp/openclaw-test-state",
        "agent-canvas",
        "worktrees",
        "project-1",
        "agent-2"
      )
    );
  });
});

describe("buildAgentInstruction", () => {
  it("includes the worktree path and repo hint", () => {
    const message = buildAgentInstruction({
      worktreePath: "/tmp/worktrees/project-1/agent-2",
      repoPath: "/repo/project-1",
      message: "Ship it",
    });

    expect(message).toContain("Workspace path: /tmp/worktrees/project-1/agent-2");
    expect(message).toContain("git worktree of /repo/project-1");
    expect(message).toContain("Ship it");
  });
});
