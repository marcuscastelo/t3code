import type { ProjectScript } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  projectScriptHookEvents,
  projectScriptRuntimeEnv,
  projectScriptsForHookEvent,
  setupProjectScript,
} from "./projectScripts.ts";

describe("projectScripts hook helpers", () => {
  it("maps legacy worktree setup scripts to worktree.created", () => {
    const legacyScript = {
      id: "setup",
      name: "Setup",
      command: "bun install",
      icon: "configure",
      runOnWorktreeCreate: true,
    } as ProjectScript;

    expect(projectScriptHookEvents(legacyScript)).toEqual(["worktree.created"]);
    expect(setupProjectScript([legacyScript])?.id).toBe("setup");
  });

  it("selects multiple scripts for the same hook event", () => {
    const scripts: ProjectScript[] = [
      {
        id: "archive-a",
        name: "Archive A",
        command: "scripts/archive-a",
        icon: "play",
        runOnWorktreeCreate: false,
        runOnEvents: ["thread.archived"],
      },
      {
        id: "archive-b",
        name: "Archive B",
        command: "scripts/archive-b",
        icon: "play",
        runOnWorktreeCreate: false,
        runOnEvents: ["thread.archived", "thread.turn.completed"],
      },
      {
        id: "turn-start",
        name: "Turn Start",
        command: "scripts/start",
        icon: "play",
        runOnWorktreeCreate: false,
        runOnEvents: ["thread.turn.started"],
      },
    ];

    expect(
      projectScriptsForHookEvent(scripts, "thread.archived").map((script) => script.id),
    ).toEqual(["archive-a", "archive-b"]);
  });

  it("adds hook metadata to runtime env", () => {
    const env = projectScriptRuntimeEnv({
      project: { cwd: "/repo" },
      worktreePath: "/repo/worktree",
      hook: {
        event: "thread.archived",
        runId: "event-1",
        payloadJsonPath: "/state/hook-runs/event-1/payload.json",
        transcriptJsonPath: "/state/hook-runs/event-1/transcript.json",
        transcriptMarkdownPath: "/state/hook-runs/event-1/transcript.md",
      },
    });

    expect(env).toMatchObject({
      T3CODE_PROJECT_ROOT: "/repo",
      T3CODE_WORKTREE_PATH: "/repo/worktree",
      T3CODE_HOOK_EVENT: "thread.archived",
      T3CODE_HOOK_RUN_ID: "event-1",
      T3CODE_HOOK_PAYLOAD_JSON: "/state/hook-runs/event-1/payload.json",
      T3CODE_HOOK_TRANSCRIPT_JSON: "/state/hook-runs/event-1/transcript.json",
      T3CODE_HOOK_TRANSCRIPT_MD: "/state/hook-runs/event-1/transcript.md",
    });
  });
});
