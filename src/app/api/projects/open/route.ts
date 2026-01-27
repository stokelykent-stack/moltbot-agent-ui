import { NextResponse } from "next/server";

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  Project,
  ProjectOpenPayload,
  ProjectOpenResult,
  ProjectsStore,
} from "../../../../src/lib/projects/types";
import { loadStore, saveStore } from "../store";

export const runtime = "nodejs";

const normalizeProjectsStore = (store: ProjectsStore): ProjectsStore => {
  const projects = Array.isArray(store.projects) ? store.projects : [];
  const activeProjectId =
    typeof store.activeProjectId === "string" &&
    projects.some((project) => project.id === store.activeProjectId)
      ? store.activeProjectId
      : projects[0]?.id ?? null;
  return {
    version: 2,
    activeProjectId,
    projects,
  };
};

const resolveHomePath = (inputPath: string) => {
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ProjectOpenPayload;
    const rawPath = typeof body?.path === "string" ? body.path.trim() : "";
    if (!rawPath) {
      return NextResponse.json({ error: "Workspace path is required." }, { status: 400 });
    }

    const resolvedPath = resolveHomePath(rawPath);
    if (!path.isAbsolute(resolvedPath)) {
      return NextResponse.json(
        { error: "Workspace path must be an absolute path." },
        { status: 400 }
      );
    }
    if (!fs.existsSync(resolvedPath)) {
      return NextResponse.json(
        { error: `Workspace path does not exist: ${resolvedPath}` },
        { status: 404 }
      );
    }
    const stat = fs.statSync(resolvedPath);
    if (!stat.isDirectory()) {
      return NextResponse.json(
        { error: `Workspace path is not a directory: ${resolvedPath}` },
        { status: 400 }
      );
    }

    const repoPath = fs.realpathSync(resolvedPath);
    const name = path.basename(repoPath);
    if (!name || name === path.parse(repoPath).root) {
      return NextResponse.json(
        { error: "Workspace path must point to a directory with a name." },
        { status: 400 }
      );
    }

    const store = loadStore();
    if (store.projects.some((project) => project.repoPath === repoPath)) {
      return NextResponse.json(
        { error: "Workspace already exists for this path." },
        { status: 409 }
      );
    }

    const warnings: string[] = [];
    if (!fs.existsSync(path.join(repoPath, ".git"))) {
      warnings.push("No .git directory found for this workspace path.");
    }

    const now = Date.now();
    const project: Project = {
      id: randomUUID(),
      name,
      repoPath,
      createdAt: now,
      updatedAt: now,
      tiles: [],
    };

    const nextStore = normalizeProjectsStore({
      version: 2,
      activeProjectId: project.id,
      projects: [...store.projects, project],
    });

    saveStore(nextStore);

    if (warnings.length > 0) {
      console.warn(`Workspace opened with warnings: ${warnings.join(" ")}`);
    }

    const result: ProjectOpenResult = {
      store: nextStore,
      warnings,
    };

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to open workspace.";
    console.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
