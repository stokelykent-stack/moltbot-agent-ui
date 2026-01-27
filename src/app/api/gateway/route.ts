import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const LEGACY_STATE_DIRNAME = ".clawdbot";
const NEW_STATE_DIRNAME = ".moltbot";
const CONFIG_FILENAME = "moltbot.json";

const resolveUserPath = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("~")) {
    const expanded = trimmed.replace(/^~(?=$|[\\/])/, os.homedir());
    return path.resolve(expanded);
  }
  return path.resolve(trimmed);
};

const resolveStateDir = () => {
  const raw = process.env.MOLTBOT_STATE_DIR ?? process.env.CLAWDBOT_STATE_DIR;
  if (raw?.trim()) {
    return resolveUserPath(raw);
  }
  return path.join(os.homedir(), LEGACY_STATE_DIRNAME);
};

const resolveConfigPathCandidates = () => {
  const explicit = process.env.MOLTBOT_CONFIG_PATH ?? process.env.CLAWDBOT_CONFIG_PATH;
  if (explicit?.trim()) {
    return [resolveUserPath(explicit)];
  }
  const candidates: string[] = [];
  if (process.env.MOLTBOT_STATE_DIR?.trim()) {
    candidates.push(path.join(resolveUserPath(process.env.MOLTBOT_STATE_DIR), CONFIG_FILENAME));
  }
  if (process.env.CLAWDBOT_STATE_DIR?.trim()) {
    candidates.push(path.join(resolveUserPath(process.env.CLAWDBOT_STATE_DIR), CONFIG_FILENAME));
  }
  candidates.push(path.join(os.homedir(), NEW_STATE_DIRNAME, CONFIG_FILENAME));
  candidates.push(path.join(os.homedir(), LEGACY_STATE_DIRNAME, CONFIG_FILENAME));
  return candidates;
};

const parseJsonLoose = (raw: string) => {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const cleaned = raw.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(cleaned) as Record<string, unknown>;
  }
};

const resolveGatewayUrl = (config: Record<string, unknown>) => {
  const gateway = (config.gateway ?? {}) as Record<string, unknown>;
  const port = typeof gateway.port === "number" ? gateway.port : 18789;
  const host =
    typeof gateway.host === "string" && gateway.host.trim()
      ? gateway.host.trim()
      : "127.0.0.1";
  return `ws://${host}:${port}`;
};

const resolveGatewayToken = (config: Record<string, unknown>) => {
  const gateway = (config.gateway ?? {}) as Record<string, unknown>;
  const auth = (gateway.auth ?? {}) as Record<string, unknown>;
  return typeof auth.token === "string" ? auth.token : "";
};

export async function GET() {
  try {
    const candidates = resolveConfigPathCandidates();
    const fallbackPath = path.join(resolveStateDir(), CONFIG_FILENAME);
    const configPath = candidates.find((candidate) => fs.existsSync(candidate)) ?? fallbackPath;
    if (!fs.existsSync(configPath)) {
      return NextResponse.json(
        { error: `Missing config at ${configPath}.` },
        { status: 404 }
      );
    }
    const raw = fs.readFileSync(configPath, "utf8");
    const config = parseJsonLoose(raw);
    return NextResponse.json({
      gatewayUrl: resolveGatewayUrl(config),
      token: resolveGatewayToken(config),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load gateway config.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
