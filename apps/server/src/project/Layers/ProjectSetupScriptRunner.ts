import { WORKTREE_CREATED_HOOK_EVENT } from "@t3tools/shared/projectScripts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProjectHookRunner } from "../Services/ProjectHookRunner.ts";
import {
  type ProjectSetupScriptRunnerShape,
  ProjectSetupScriptRunner,
  ProjectSetupScriptRunnerError,
} from "../Services/ProjectSetupScriptRunner.ts";

const makeProjectSetupScriptRunner = Effect.gen(function* () {
  const projectHookRunner = yield* ProjectHookRunner;

  const runForThread: ProjectSetupScriptRunnerShape["runForThread"] = (input) =>
    projectHookRunner
      .runForThread({
        event: WORKTREE_CREATED_HOOK_EVENT,
        hookRunId: `${input.threadId}:worktree.created`,
        threadId: input.threadId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.projectCwd ? { projectCwd: input.projectCwd } : {}),
        worktreePath: input.worktreePath,
        ...(input.preferredTerminalId ? { preferredTerminalId: input.preferredTerminalId } : {}),
        payload: {
          threadId: input.threadId,
          projectId: input.projectId ?? null,
          projectCwd: input.projectCwd ?? null,
          worktreePath: input.worktreePath,
        },
      })
      .pipe(
        Effect.map((result) => {
          if (result.status !== "started") {
            return result;
          }
          const first = result.scripts[0];
          if (!first) {
            return { status: "no-script" } as const;
          }
          return {
            status: "started",
            scriptId: first.scriptId,
            scriptName: first.scriptName,
            terminalId: first.terminalId,
            cwd: first.cwd,
          } as const;
        }),
        Effect.mapError((cause) => new ProjectSetupScriptRunnerError({ message: cause.message })),
      );

  return {
    runForThread,
  } satisfies ProjectSetupScriptRunnerShape;
});

export const ProjectSetupScriptRunnerLive = Layer.effect(
  ProjectSetupScriptRunner,
  makeProjectSetupScriptRunner,
);
