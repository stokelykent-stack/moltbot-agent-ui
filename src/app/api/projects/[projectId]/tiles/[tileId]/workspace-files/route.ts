import { NextResponse } from "next/server";

import fs from "node:fs";
import path from "node:path";

import { logger } from "@/lib/logger";
import { resolveAgentWorkspaceDir } from "@/lib/projects/agentWorkspace";
import {
  WORKSPACE_FILE_NAMES,
  isWorkspaceFileName,
  type WorkspaceFileName,
} from "@/lib/projects/workspaceFiles";
import { readWorkspaceFile } from "@/lib/projects/workspaceFiles.server";
import { resolveProjectTile } from "@/lib/projects/resolve";
import type { ProjectTileWorkspaceFilesUpdatePayload } from "@/lib/projects/types";
import { loadStore } from "../../../../store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; tileId: string }> }
) {
  try {
    const { projectId, tileId } = await context.params;
    const store = loadStore();
    const resolved = resolveProjectTile(store, projectId, tileId);
    if (!resolved.ok) {
      return NextResponse.json(
        { error: resolved.error.message },
        { status: resolved.error.status }
      );
    }
    const { projectId: resolvedProjectId, tile } = resolved;
    const workspaceDir = resolveAgentWorkspaceDir(resolvedProjectId, tile.agentId);
    if (!fs.existsSync(workspaceDir)) {
      return NextResponse.json({ error: "Agent workspace not found." }, { status: 404 });
    }
    const files = WORKSPACE_FILE_NAMES.map((name) =>
      readWorkspaceFile(workspaceDir, name)
    );
    return NextResponse.json({ files });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load workspace files.";
    logger.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ projectId: string; tileId: string }> }
) {
  try {
    const { projectId, tileId } = await context.params;
    const store = loadStore();
    const resolved = resolveProjectTile(store, projectId, tileId);
    if (!resolved.ok) {
      return NextResponse.json(
        { error: resolved.error.message },
        { status: resolved.error.status }
      );
    }
    const { projectId: resolvedProjectId, tile } = resolved;
    const workspaceDir = resolveAgentWorkspaceDir(resolvedProjectId, tile.agentId);
    if (!fs.existsSync(workspaceDir)) {
      return NextResponse.json({ error: "Agent workspace not found." }, { status: 404 });
    }

    const body = (await request.json()) as ProjectTileWorkspaceFilesUpdatePayload;
    if (!body || !Array.isArray(body.files)) {
      return NextResponse.json({ error: "Files payload is invalid." }, { status: 400 });
    }

    for (const entry of body.files) {
      const name = typeof entry?.name === "string" ? entry.name.trim() : "";
      if (!name || !isWorkspaceFileName(name)) {
        return NextResponse.json(
          { error: `Invalid file name: ${entry?.name ?? ""}` },
          { status: 400 }
        );
      }
      if (typeof entry.content !== "string") {
        return NextResponse.json({ error: `Invalid content for ${name}.` }, { status: 400 });
      }
    }

    for (const entry of body.files) {
      const name = entry.name as WorkspaceFileName;
      const filePath = path.join(workspaceDir, name);
      fs.writeFileSync(filePath, entry.content, "utf8");
    }

    const files = WORKSPACE_FILE_NAMES.map((name) =>
      readWorkspaceFile(workspaceDir, name)
    );
    return NextResponse.json({ files });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save workspace files.";
    logger.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
