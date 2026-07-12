import { ProjectId, type ProjectScript, type ProjectScriptHookEvent } from "@t3tools/contracts";
import {
  projectScriptCwd,
  projectScriptRuntimeEnv,
  projectScriptsForHookEvent,
  WORKTREE_CREATED_HOOK_EVENT,
} from "@t3tools/shared/projectScripts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { ServerConfig } from "../../config.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { TerminalManager } from "../../terminal/Services/Manager.ts";
import {
  type ProjectHookRunnerInput,
  ProjectHookRunner,
  ProjectHookRunnerError,
  type ProjectHookRunnerResult,
  type ProjectHookRunnerShape,
  type ProjectHookTranscript,
} from "../Services/ProjectHookRunner.ts";

const eventSlug = (event: ProjectScriptHookEvent) => event.replace(/[^a-z0-9]+/g, "-");
const encodeJsonString = Schema.encodeEffect(Schema.UnknownFromJsonString);

const safePathSegment = (value: string) =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "hook";

const toRunnerError = (cause: unknown): ProjectHookRunnerError => {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    cause._tag === "ProjectHookRunnerError"
  ) {
    return cause as ProjectHookRunnerError;
  }
  const message =
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string"
      ? cause.message
      : String(cause);
  return new ProjectHookRunnerError({ message });
};

function markdownEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
}

function renderTranscriptMarkdown(input: ProjectHookTranscript): string {
  const { event, project, thread } = input;
  const lines: string[] = [
    `# ${thread.title}`,
    "",
    `- Project: ${project.title}`,
    `- Project root: \`${markdownEscape(project.workspaceRoot)}\``,
    `- Thread: \`${thread.id}\``,
    `- Event: \`${event.type}\``,
    `- Occurred: ${event.occurredAt}`,
    "",
    "## Messages",
    "",
  ];

  for (const message of thread.messages) {
    lines.push(`### ${message.role} - ${message.createdAt}`, "");
    lines.push(message.text.length > 0 ? message.text : "_No text._", "");
    if (message.attachments && message.attachments.length > 0) {
      lines.push("Attachments:");
      for (const attachment of message.attachments) {
        lines.push(
          `- ${attachment.name} (${attachment.mimeType}) id=\`${markdownEscape(attachment.id)}\``,
        );
      }
      lines.push("");
    }
  }

  if (thread.activities.length > 0) {
    lines.push("## Activities", "");
    for (const activity of thread.activities) {
      lines.push(
        `- ${activity.createdAt} [${activity.tone}] ${activity.kind}: ${activity.summary}`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

const makeProjectHookRunner = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const terminalManager = yield* TerminalManager;

  const resolveProject = (input: ProjectHookRunnerInput) =>
    Effect.gen(function* () {
      if (input.transcript) {
        return input.transcript.project;
      }
      if (input.projectId) {
        const project = yield* projectionSnapshotQuery
          .getProjectShellById(ProjectId.make(input.projectId))
          .pipe(Effect.map(Option.getOrUndefined));
        if (project) {
          return project;
        }
      }
      if (input.projectCwd) {
        const project = yield* projectionSnapshotQuery
          .getActiveProjectByWorkspaceRoot(input.projectCwd)
          .pipe(Effect.map(Option.getOrUndefined));
        if (project) {
          return project;
        }
      }
      const snapshot = yield* projectionSnapshotQuery.getSnapshot();
      const thread = snapshot.threads.find((candidate) => candidate.id === input.threadId);
      if (!thread) {
        return null;
      }
      return snapshot.projects.find((project) => project.id === thread.projectId) ?? null;
    });

  const writeArtifacts = (input: ProjectHookRunnerInput) =>
    Effect.gen(function* () {
      const safeRunId = safePathSegment(input.hookRunId);
      const artifactDir = path.join(config.stateDir, "hook-runs", safeRunId);
      yield* fileSystem.makeDirectory(artifactDir, { recursive: true });

      const payloadJsonPath = path.join(artifactDir, "payload.json");
      const payloadJson = yield* encodeJsonString({
        event: input.event,
        hookRunId: input.hookRunId,
        threadId: input.threadId,
        projectId: input.projectId ?? input.transcript?.project.id ?? null,
        projectCwd: input.projectCwd ?? input.transcript?.project.workspaceRoot ?? null,
        worktreePath: input.worktreePath ?? input.transcript?.thread.worktreePath ?? null,
        payload: input.payload ?? null,
      });
      yield* fileSystem.writeFileString(payloadJsonPath, `${payloadJson}\n`);

      if (!input.transcript) {
        return {
          payloadJsonPath,
          transcriptJsonPath: null,
          transcriptMarkdownPath: null,
        } as const;
      }

      const transcriptJsonPath = path.join(artifactDir, "transcript.json");
      const transcriptMarkdownPath = path.join(artifactDir, "transcript.md");
      const transcriptJson = yield* encodeJsonString(input.transcript);
      yield* fileSystem.writeFileString(transcriptJsonPath, `${transcriptJson}\n`);
      yield* fileSystem.writeFileString(
        transcriptMarkdownPath,
        renderTranscriptMarkdown(input.transcript),
      );

      return {
        payloadJsonPath,
        transcriptJsonPath,
        transcriptMarkdownPath,
      } as const;
    });

  const terminalIdForScript = (
    input: ProjectHookRunnerInput,
    script: ProjectScript,
    index: number,
  ) => {
    if (input.preferredTerminalId && index === 0) {
      return input.preferredTerminalId;
    }
    if (input.event === WORKTREE_CREATED_HOOK_EVENT) {
      return `setup-${script.id}`;
    }
    const suffix = safePathSegment(input.hookRunId).slice(-8);
    return `hook-${eventSlug(input.event)}-${script.id}-${suffix}`;
  };

  const runForThread: ProjectHookRunnerShape["runForThread"] = (input) =>
    Effect.gen(function* () {
      const project = yield* resolveProject(input);
      if (!project) {
        return yield* new ProjectHookRunnerError({
          message: "Project was not found for hook execution.",
        });
      }

      const scripts = projectScriptsForHookEvent(project.scripts, input.event);
      if (scripts.length === 0) {
        return { status: "no-script" } as const;
      }

      const artifacts = yield* writeArtifacts(input);
      const worktreePath = input.worktreePath ?? input.transcript?.thread.worktreePath ?? null;
      const cwd = projectScriptCwd({
        project: { cwd: project.workspaceRoot },
        worktreePath,
      });
      const env = projectScriptRuntimeEnv({
        project: { cwd: project.workspaceRoot },
        worktreePath,
        hook: {
          event: input.event,
          runId: input.hookRunId,
          payloadJsonPath: artifacts.payloadJsonPath,
          transcriptJsonPath: artifacts.transcriptJsonPath,
          transcriptMarkdownPath: artifacts.transcriptMarkdownPath,
        },
      });

      const started = yield* Effect.forEach(
        scripts,
        (script, index) =>
          Effect.gen(function* () {
            const terminalId = terminalIdForScript(input, script, index);
            yield* terminalManager.open({
              threadId: input.threadId,
              terminalId,
              cwd,
              worktreePath,
              env,
            });
            yield* terminalManager.write({
              threadId: input.threadId,
              terminalId,
              data: `${script.command}\r`,
            });
            return {
              scriptId: script.id,
              scriptName: script.name,
              terminalId,
              cwd,
            } as const;
          }),
        { concurrency: 1 },
      );

      return {
        status: "started",
        scripts: started,
        payloadJsonPath: artifacts.payloadJsonPath,
        transcriptJsonPath: artifacts.transcriptJsonPath,
        transcriptMarkdownPath: artifacts.transcriptMarkdownPath,
      } satisfies ProjectHookRunnerResult;
    }).pipe(Effect.mapError(toRunnerError));

  return {
    runForThread,
  } satisfies ProjectHookRunnerShape;
});

export const ProjectHookRunnerLive = Layer.effect(ProjectHookRunner, makeProjectHookRunner);
