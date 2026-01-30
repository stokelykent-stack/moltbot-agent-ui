import fs from "node:fs";
import path from "node:path";

import { resolveStateDir } from "@/lib/clawdbot/paths";
import type { ProjectTile } from "@/lib/projects/types";
import { resolveAgentWorktreeDir } from "./worktrees.server";

export const resolveAgentStateDir = (agentId: string) => {
  return path.join(resolveStateDir(), "agents", agentId);
};

export const deleteDirIfExists = (targetPath: string, label: string, warnings: string[]) => {
  if (!fs.existsSync(targetPath)) {
    warnings.push(`${label} not found at ${targetPath}.`);
    return;
  }
  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    throw new Error(`${label} path is not a directory: ${targetPath}`);
  }
  fs.rmSync(targetPath, { recursive: true, force: false });
};

export const deleteAgentArtifacts = (projectId: string, agentId: string, warnings: string[]) => {
  const workspaceDir = resolveAgentWorktreeDir(projectId, agentId);
  deleteDirIfExists(workspaceDir, "Agent workspace", warnings);

  const agentDir = resolveAgentStateDir(agentId);
  deleteDirIfExists(agentDir, "Agent state", warnings);
};

export const collectAgentIdsAndDeleteArtifacts = (
  projectId: string,
  tiles: ProjectTile[],
  warnings: string[]
): string[] => {
  const agentIds: string[] = [];
  for (const tile of tiles) {
    if (!tile.agentId?.trim()) {
      warnings.push(`Missing agentId for tile ${tile.id}; skipped agent cleanup.`);
      continue;
    }
    deleteAgentArtifacts(projectId, tile.agentId, warnings);
    agentIds.push(tile.agentId);
  }
  return agentIds;
};
