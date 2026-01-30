import path from "node:path";

import { resolveStateDir } from "@/lib/clawdbot/paths";

export const resolveAgentCanvasDir = (
  env: NodeJS.ProcessEnv = process.env,
  homedir?: () => string
) => {
  const stateDir = resolveStateDir(env, homedir);
  return path.join(stateDir, "agent-canvas");
};

export const resolveProjectAgentsRoot = (projectId: string) => {
  return path.join(resolveAgentCanvasDir(), "worktrees", projectId);
};

export const resolveAgentWorkspaceDir = (projectId: string, agentId: string) => {
  return path.join(resolveProjectAgentsRoot(projectId), agentId);
};
