import { NextResponse } from "next/server";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ProjectTileRenamePayload } from "../../../../../../src/lib/projects/types";
import { resolveAgentWorkspaceDir } from "../../../../../../src/lib/projects/agentWorkspace";
import {
  loadClawdbotConfig,
  removeAgentEntry,
  renameAgentEntry,
  saveClawdbotConfig,
  upsertAgentEntry,
} from "../../../../../../src/lib/clawdbot/config";
import { generateAgentId } from "../../../../../../src/lib/ids/agentId";
import { loadStore, saveStore } from "../../../store";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ projectId: string; tileId: string }> }
) {
  try {
    const { projectId, tileId } = await context.params;
    const trimmedProjectId = projectId.trim();
    const trimmedTileId = tileId.trim();
    if (!trimmedProjectId || !trimmedTileId) {
      return NextResponse.json(
        { error: "Workspace id and tile id are required." },
        { status: 400 }
      );
    }
    const store = loadStore();
    const project = store.projects.find((entry) => entry.id === trimmedProjectId);
    if (!project) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    }
    const tile = project.tiles.find((entry) => entry.id === trimmedTileId);
    if (!tile) {
      return NextResponse.json({ error: "Tile not found." }, { status: 404 });
    }

    const warnings: string[] = [];
    if (!tile.agentId?.trim()) {
      warnings.push(`Missing agentId for tile ${tile.id}; skipped agent cleanup.`);
    } else {
      deleteAgentArtifacts(trimmedProjectId, tile.agentId, warnings);
      try {
        const { config, configPath } = loadClawdbotConfig();
        const changed = removeAgentEntry(config, tile.agentId);
        if (changed) {
          saveClawdbotConfig(configPath, config);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to update clawdbot.json.";
        warnings.push(`Agent config not updated: ${message}`);
      }
    }

    const nextTiles = project.tiles.filter((entry) => entry.id !== trimmedTileId);
    if (nextTiles.length === project.tiles.length) {
      return NextResponse.json({ error: "Tile not found." }, { status: 404 });
    }
    const nextStore = {
      ...store,
      version: 2 as const,
      projects: store.projects.map((entry) =>
        entry.id === trimmedProjectId
          ? { ...entry, tiles: nextTiles, updatedAt: Date.now() }
          : entry
      ),
    };
    saveStore(nextStore);
    return NextResponse.json({ store: nextStore, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete tile.";
    console.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string; tileId: string }> }
) {
  try {
    const { projectId, tileId } = await context.params;
    const trimmedProjectId = projectId.trim();
    const trimmedTileId = tileId.trim();
    if (!trimmedProjectId || !trimmedTileId) {
      return NextResponse.json(
        { error: "Workspace id and tile id are required." },
        { status: 400 }
      );
    }
    const body = (await request.json()) as ProjectTileRenamePayload;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Tile name is required." }, { status: 400 });
    }

    const store = loadStore();
    const project = store.projects.find((entry) => entry.id === trimmedProjectId);
    if (!project) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    }
    const tile = project.tiles.find((entry) => entry.id === trimmedTileId);
    if (!tile) {
      return NextResponse.json({ error: "Tile not found." }, { status: 404 });
    }

    const projectSlug = path.basename(project.repoPath);
    let nextAgentId = "";
    try {
      nextAgentId = generateAgentId({ projectSlug, tileName: name });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid agent name.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const conflict = project.tiles.some(
      (entry) => entry.id !== trimmedTileId && entry.agentId === nextAgentId
    );
    if (conflict) {
      return NextResponse.json(
        { error: `Agent id already exists: ${nextAgentId}` },
        { status: 409 }
      );
    }

    const warnings: string[] = [];
    if (tile.agentId !== nextAgentId) {
      const stateDirRaw = process.env.CLAWDBOT_STATE_DIR ?? "~/.clawdbot";
      const stateDir = resolveHomePath(stateDirRaw);
      const workspaceSource = resolveAgentWorkspaceDir(trimmedProjectId, tile.agentId);
      const workspaceTarget = resolveAgentWorkspaceDir(trimmedProjectId, nextAgentId);
      const agentSource = path.join(stateDir, "agents", tile.agentId);
      const agentTarget = path.join(stateDir, "agents", nextAgentId);
      if (fs.existsSync(workspaceTarget)) {
        return NextResponse.json(
          { error: `Agent workspace already exists at ${workspaceTarget}` },
          { status: 409 }
        );
      }
      if (fs.existsSync(agentTarget)) {
        return NextResponse.json(
          { error: `Agent state already exists at ${agentTarget}` },
          { status: 409 }
        );
      }
      renameDirIfExists(workspaceSource, workspaceTarget, "Agent workspace", warnings);
      renameDirIfExists(
        agentSource,
        agentTarget,
        "Agent state",
        warnings,
        { warnIfMissing: false }
      );
    }
    const nextWorkspaceDir = resolveAgentWorkspaceDir(trimmedProjectId, nextAgentId);
    try {
      const { config, configPath } = loadClawdbotConfig();
      const changed =
        tile.agentId !== nextAgentId
          ? renameAgentEntry(config, {
              fromAgentId: tile.agentId,
              toAgentId: nextAgentId,
              agentName: name,
              workspaceDir: nextWorkspaceDir,
            })
          : upsertAgentEntry(config, {
              agentId: nextAgentId,
              agentName: name,
              workspaceDir: nextWorkspaceDir,
            });
      if (changed) {
        saveClawdbotConfig(configPath, config);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update clawdbot.json.";
      warnings.push(`Agent config not updated: ${message}`);
    }

    const nextTiles = project.tiles.map((entry) =>
      entry.id === trimmedTileId
        ? {
            ...entry,
            name,
            agentId: nextAgentId,
            sessionKey: `agent:${nextAgentId}:main`,
          }
        : entry
    );
    const nextStore = {
      ...store,
      version: 2 as const,
      projects: store.projects.map((entry) =>
        entry.id === trimmedProjectId
          ? { ...entry, tiles: nextTiles, updatedAt: Date.now() }
          : entry
      ),
    };
    saveStore(nextStore);
    return NextResponse.json({ store: nextStore, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to rename tile.";
    console.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const resolveHomePath = (inputPath: string) => {
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
};

const renameDirIfExists = (
  source: string,
  destination: string,
  label: string,
  warnings: string[],
  options?: { warnIfMissing?: boolean }
) => {
  if (!fs.existsSync(source)) {
    if (options?.warnIfMissing !== false) {
      warnings.push(`${label} not found at ${source}.`);
    }
    return;
  }
  if (fs.existsSync(destination)) {
    throw new Error(`${label} already exists at ${destination}.`);
  }
  const stat = fs.statSync(source);
  if (!stat.isDirectory()) {
    throw new Error(`${label} path is not a directory: ${source}`);
  }
  fs.renameSync(source, destination);
};

const deleteDirIfExists = (targetPath: string, label: string, warnings: string[]) => {
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

const deleteAgentArtifacts = (projectId: string, agentId: string, warnings: string[]) => {
  const workspaceDir = resolveAgentWorkspaceDir(projectId, agentId);
  deleteDirIfExists(workspaceDir, "Agent workspace", warnings);

  const stateDirRaw = process.env.CLAWDBOT_STATE_DIR ?? "~/.clawdbot";
  const stateDir = resolveHomePath(stateDirRaw);
  const agentDir = path.join(stateDir, "agents", agentId);
  deleteDirIfExists(agentDir, "Agent state", warnings);
};
