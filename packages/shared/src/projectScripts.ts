import type { ProjectScript, ProjectScriptHookEvent } from "@t3tools/contracts";

export const WORKTREE_CREATED_HOOK_EVENT = "worktree.created" satisfies ProjectScriptHookEvent;

interface ProjectScriptRuntimeEnvInput {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
  hook?: {
    event: ProjectScriptHookEvent;
    runId: string;
    payloadJsonPath?: string | null;
    transcriptJsonPath?: string | null;
    transcriptMarkdownPath?: string | null;
  };
  extraEnv?: Record<string, string>;
}

export function projectScriptCwd(input: {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
}): string {
  return input.worktreePath ?? input.project.cwd;
}

export function projectScriptRuntimeEnv(
  input: ProjectScriptRuntimeEnvInput,
): Record<string, string> {
  const env: Record<string, string> = {
    T3CODE_PROJECT_ROOT: input.project.cwd,
  };
  if (input.worktreePath) {
    env.T3CODE_WORKTREE_PATH = input.worktreePath;
  }
  if (input.hook) {
    env.T3CODE_HOOK_EVENT = input.hook.event;
    env.T3CODE_HOOK_RUN_ID = input.hook.runId;
    if (input.hook.payloadJsonPath) {
      env.T3CODE_HOOK_PAYLOAD_JSON = input.hook.payloadJsonPath;
    }
    if (input.hook.transcriptJsonPath) {
      env.T3CODE_HOOK_TRANSCRIPT_JSON = input.hook.transcriptJsonPath;
    }
    if (input.hook.transcriptMarkdownPath) {
      env.T3CODE_HOOK_TRANSCRIPT_MD = input.hook.transcriptMarkdownPath;
    }
  }
  if (input.extraEnv) {
    return { ...env, ...input.extraEnv };
  }
  return env;
}

export function projectScriptHookEvents(script: ProjectScript): readonly ProjectScriptHookEvent[] {
  if (script.runOnEvents?.length > 0) {
    return script.runOnEvents;
  }
  return script.runOnWorktreeCreate ? [WORKTREE_CREATED_HOOK_EVENT] : [];
}

export function projectScriptsForHookEvent(
  scripts: readonly ProjectScript[],
  event: ProjectScriptHookEvent,
): readonly ProjectScript[] {
  return scripts.filter((script) => projectScriptHookEvents(script).includes(event));
}

export function setupProjectScript(scripts: readonly ProjectScript[]): ProjectScript | null {
  return projectScriptsForHookEvent(scripts, WORKTREE_CREATED_HOOK_EVENT)[0] ?? null;
}
