export type AgentInstructionParams = {
  worktreePath: string;
  repoPath: string;
  message: string;
};

export const buildAgentInstruction = ({
  worktreePath,
  repoPath,
  message,
}: AgentInstructionParams): string => {
  const trimmed = message.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("/")) return trimmed;
  const worktree = worktreePath?.trim();
  if (!worktree) return trimmed;
  const repo = repoPath?.trim();
  const repoNote = repo ? ` This is a git worktree of ${repo}.` : "";
  return `Workspace path: ${worktree}.${repoNote} Operate within this repository. You may also read/write your agent workspace files (AGENTS.md, SOUL.md, IDENTITY.md, USER.md, HEARTBEAT.md, TOOLS.md, MEMORY.md). Use MEMORY.md or memory/*.md directly for durable memory; do not rely on memory_search.\n\n${trimmed}`;
};
