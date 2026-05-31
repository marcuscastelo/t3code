import type {
  OrchestrationEvent,
  OrchestrationProject,
  OrchestrationThread,
  ProjectScriptHookEvent,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

export interface ProjectHookRunnerResultNoScript {
  readonly status: "no-script";
}

export interface ProjectHookRunnerStartedScript {
  readonly scriptId: string;
  readonly scriptName: string;
  readonly terminalId: string;
  readonly cwd: string;
}

export interface ProjectHookRunnerResultStarted {
  readonly status: "started";
  readonly scripts: ReadonlyArray<ProjectHookRunnerStartedScript>;
  readonly payloadJsonPath: string;
  readonly transcriptJsonPath: string | null;
  readonly transcriptMarkdownPath: string | null;
}

export type ProjectHookRunnerResult =
  | ProjectHookRunnerResultNoScript
  | ProjectHookRunnerResultStarted;

export interface ProjectHookRunnerInput {
  readonly event: ProjectScriptHookEvent;
  readonly hookRunId: string;
  readonly threadId: string;
  readonly projectId?: string;
  readonly projectCwd?: string;
  readonly worktreePath?: string | null;
  readonly preferredTerminalId?: string;
  readonly payload?: unknown;
  readonly transcript?: ProjectHookTranscript | null;
}

export interface ProjectHookTranscript {
  readonly event: Extract<
    OrchestrationEvent,
    {
      readonly type:
        | "thread.archived"
        | "thread.turn-start-requested"
        | "thread.turn-diff-completed";
    }
  >;
  readonly project: OrchestrationProject;
  readonly thread: OrchestrationThread;
}

export class ProjectHookRunnerError extends Data.TaggedError("ProjectHookRunnerError")<{
  readonly message: string;
}> {}

export interface ProjectHookRunnerShape {
  readonly runForThread: (
    input: ProjectHookRunnerInput,
  ) => Effect.Effect<ProjectHookRunnerResult, ProjectHookRunnerError>;
}

export class ProjectHookRunner extends Context.Service<ProjectHookRunner, ProjectHookRunnerShape>()(
  "t3/project/Services/ProjectHookRunner",
) {}
