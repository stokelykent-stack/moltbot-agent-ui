import { NextResponse } from "next/server";

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  ProjectTile,
  ProjectTileCreatePayload,
  ProjectTileCreateResult,
  ProjectTileRole,
  ProjectsStore,
} from "../../../../../src/lib/projects/types";
import { resolveAgentWorkspaceDir } from "../../../../../src/lib/projects/agentWorkspace";
import {
  loadClawdbotConfig,
  saveClawdbotConfig,
  upsertAgentEntry,
} from "../../../../../src/lib/clawdbot/config";
import { generateAgentId } from "../../../../../src/lib/ids/agentId";
import { loadStore, saveStore } from "../../store";

export const runtime = "nodejs";

const ROLE_VALUES: ProjectTileRole[] = ["coding", "research", "marketing"];

const resolveHomePath = (inputPath: string) => {
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
};

const ensureDir = (dir: string) => {
  if (fs.existsSync(dir)) {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) {
      throw new Error(`${dir} exists and is not a directory.`);
    }
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
};

const buildBootstrapContent = (
  repoPath: string,
  workspaceDir: string,
  role: ProjectTileRole
) => {
  return [
    "# BOOTSTRAP.md",
    "",
    `Workspace dir: ${workspaceDir}`,
    `Workspace repo: ${repoPath}`,
    `Role: ${role}`,
    "",
    "You are operating inside this workspace.",
    `Operate directly in: ${repoPath}`,
    "",
    'First action: run "ls" in the repo to confirm access.',
    "",
  ].join("\n");
};

const ensureFile = (filePath: string, contents: string) => {
  if (fs.existsSync(filePath)) {
    return;
  }
  fs.writeFileSync(filePath, contents, "utf8");
};

const provisionWorkspace = ({
  workspaceDir,
  repoPath,
  role,
}: {
  workspaceDir: string;
  repoPath: string;
  role: ProjectTileRole;
}): string[] => {
  const warnings: string[] = [];
  ensureDir(workspaceDir);

  const bootstrapContent = buildBootstrapContent(repoPath, workspaceDir, role);
  ensureFile(path.join(workspaceDir, "BOOTSTRAP.md"), bootstrapContent);
  ensureFile(path.join(workspaceDir, "AGENTS.md"), "");
  ensureFile(path.join(workspaceDir, "SOUL.md"), "");
  ensureFile(path.join(workspaceDir, "IDENTITY.md"), "");
  ensureFile(path.join(workspaceDir, "USER.md"), "");
  ensureFile(path.join(workspaceDir, "HEARTBEAT.md"), "");
  ensureFile(path.join(workspaceDir, "TOOLS.md"), "");
  ensureFile(path.join(workspaceDir, "MEMORY.md"), "");
  ensureDir(path.join(workspaceDir, "memory"));

  return warnings;
};

const copyAuthProfiles = (agentId: string): string[] => {
  const warnings: string[] = [];
  const stateDirRaw = process.env.CLAWDBOT_STATE_DIR ?? "~/.clawdbot";
  const stateDir = resolveHomePath(stateDirRaw);
  const sourceAgentId = process.env.CLAWDBOT_DEFAULT_AGENT_ID ?? "main";
  const source = path.join(stateDir, "agents", sourceAgentId, "agent", "auth-profiles.json");
  const destination = path.join(stateDir, "agents", agentId, "agent", "auth-profiles.json");

  if (fs.existsSync(destination)) {
    return warnings;
  }
  if (!fs.existsSync(source)) {
    warnings.push(`No auth profiles found at ${source}; agent may need login.`);
    return warnings;
  }
  ensureDir(path.dirname(destination));
  fs.copyFileSync(source, destination);
  return warnings;
};

const updateStoreProject = (
  store: ProjectsStore,
  projectId: string,
  tile: ProjectTile
) => {
  return {
    ...store,
    version: 2 as const,
    projects: store.projects.map((project) =>
      project.id === projectId
        ? {
            ...project,
            tiles: [...project.tiles, tile],
            updatedAt: Date.now(),
          }
        : project
    ),
  };
};

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    const trimmedProjectId = projectId.trim();
    if (!trimmedProjectId) {
      return NextResponse.json({ error: "Workspace id is required." }, { status: 400 });
    }

    const body = (await request.json()) as ProjectTileCreatePayload;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const role = body?.role;
    if (!name) {
      return NextResponse.json({ error: "Tile name is required." }, { status: 400 });
    }
    if (!role || !ROLE_VALUES.includes(role)) {
      return NextResponse.json({ error: "Tile role is invalid." }, { status: 400 });
    }

    const store = loadStore();
    const project = store.projects.find((entry) => entry.id === trimmedProjectId);
    if (!project) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    }

    const tileId = randomUUID();
    const projectSlug = path.basename(project.repoPath);
    let agentId = "";
    try {
      agentId = generateAgentId({ projectSlug, tileName: name });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid agent name.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (project.tiles.some((entry) => entry.agentId === agentId)) {
      return NextResponse.json(
        { error: `Agent id already exists: ${agentId}` },
        { status: 409 }
      );
    }
    const sessionKey = `agent:${agentId}:main`;
    const offset = project.tiles.length * 36;
    const workspaceDir = resolveAgentWorkspaceDir(trimmedProjectId, agentId);
    const tile: ProjectTile = {
      id: tileId,
      name,
      agentId,
      role,
      sessionKey,
      model: null,
      thinkingLevel: null,
      position: { x: 80 + offset, y: 200 + offset },
      size: { width: 720, height: 560 },
    };

    const nextStore = updateStoreProject(store, trimmedProjectId, tile);
    saveStore(nextStore);

    const warnings = [
      ...provisionWorkspace({ workspaceDir, repoPath: project.repoPath, role }),
      ...copyAuthProfiles(agentId),
    ];
    try {
      const { config, configPath } = loadClawdbotConfig();
      const changed = upsertAgentEntry(config, {
        agentId,
        agentName: name,
        workspaceDir,
      });
      if (changed) {
        saveClawdbotConfig(configPath, config);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update clawdbot.json.";
      warnings.push(`Agent config not updated: ${message}`);
    }
    if (warnings.length > 0) {
      console.warn(`Tile created with warnings: ${warnings.join(" ")}`);
    }

    const result: ProjectTileCreateResult = {
      store: nextStore,
      tile,
      warnings,
    };
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create tile.";
    console.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
