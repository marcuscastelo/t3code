// @effect-diagnostics nodeBuiltinImport:off
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationProject,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { describe, expect, it, vi } from "vitest";

import { ServerConfig } from "../../config.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { TerminalManager, type TerminalManagerShape } from "../../terminal/Services/Manager.ts";
import { ProjectHookRunner } from "../Services/ProjectHookRunner.ts";
import { ProjectHookRunnerLive } from "./ProjectHookRunner.ts";

const now = "2026-01-01T00:00:00.000Z";

const project: OrchestrationProject = {
  id: ProjectId.make("project-1"),
  title: "Project",
  workspaceRoot: "/repo/project",
  defaultModelSelection: null,
  scripts: [
    {
      id: "archive",
      name: "Archive",
      command: "scripts/archive-chat",
      icon: "play",
      runOnWorktreeCreate: false,
      runOnEvents: ["thread.archived"],
    },
  ],
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};

const thread: OrchestrationThread = {
  id: ThreadId.make("thread-1"),
  projectId: project.id,
  title: "Archive thread",
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5",
    options: [],
  },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "feature/archive",
  worktreePath: "/repo/worktree",
  latestTurn: null,
  createdAt: now,
  updatedAt: now,
  archivedAt: now,
  deletedAt: null,
  messages: [
    {
      id: MessageId.make("message-1"),
      role: "user",
      text: "hello archive",
      attachments: [
        {
          type: "image",
          id: "image-1",
          name: "screenshot.png",
          mimeType: "image/png",
          sizeBytes: 123,
        },
      ],
      turnId: null,
      streaming: false,
      createdAt: now,
      updatedAt: now,
    },
  ],
  proposedPlans: [],
  activities: [
    {
      id: EventId.make("activity-1"),
      tone: "info",
      kind: "thread.archived",
      summary: "Archived",
      payload: {},
      turnId: null,
      createdAt: now,
    },
  ],
  checkpoints: [],
  session: null,
};

const archivedEvent: Extract<OrchestrationEvent, { type: "thread.archived" }> = {
  sequence: 12,
  eventId: EventId.make("run-1"),
  aggregateKind: "thread",
  aggregateId: thread.id,
  occurredAt: now,
  commandId: CommandId.make("cmd-archive"),
  causationEventId: null,
  correlationId: CommandId.make("cmd-archive"),
  metadata: {},
  type: "thread.archived",
  payload: {
    threadId: thread.id,
    archivedAt: now,
    updatedAt: now,
  },
};

const makeProjectionSnapshotQueryLayer = () =>
  Layer.succeed(ProjectionSnapshotQuery, {
    getCommandReadModel: () => Effect.die("unused"),
    getSnapshot: () =>
      Effect.succeed({
        snapshotSequence: 1,
        projects: [project],
        threads: [thread],
        updatedAt: now,
      }),
    getShellSnapshot: () => Effect.die("unused"),
    getArchivedShellSnapshot: () => Effect.die("unused"),
    getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 1 }),
    getCounts: () => Effect.die("unused"),
    getActiveProjectByWorkspaceRoot: (workspaceRoot) =>
      Effect.succeed(
        workspaceRoot === project.workspaceRoot ? Option.some(project) : Option.none(),
      ),
    getProjectShellById: (projectId) =>
      Effect.succeed(projectId === project.id ? Option.some(project) : Option.none()),
    getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
    getThreadCheckpointContext: () => Effect.die("unused"),
    getFullThreadDiffContext: () => Effect.die("unused"),
    getThreadShellById: () => Effect.die("unused"),
    getThreadDetailById: () => Effect.succeed(Option.some(thread)),
  });

const makeLayer = (baseDir: string, terminalManager: TerminalManagerShape) =>
  ProjectHookRunnerLive.pipe(
    Layer.provideMerge(makeProjectionSnapshotQueryLayer()),
    Layer.provideMerge(Layer.succeed(TerminalManager, terminalManager)),
    Layer.provideMerge(ServerConfig.layerTest(project.workspaceRoot, baseDir)),
    Layer.provideMerge(NodeServices.layer),
  );

describe("ProjectHookRunner", () => {
  it("opens terminals, writes commands, and creates archive artifacts", async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3-project-hook-runner-"));
    const open = vi.fn(() =>
      Effect.succeed({
        threadId: thread.id,
        terminalId: "hook-thread-archived-archive-run-1",
        cwd: "/repo/worktree",
        worktreePath: "/repo/worktree",
        status: "running" as const,
        pid: 123,
        history: "",
        exitCode: null,
        exitSignal: null,
        label: "hook-thread-archived-archive-run-1",
        updatedAt: now,
      }),
    );
    const write = vi.fn(() => Effect.void);

    const runner = await Effect.runPromise(
      Effect.service(ProjectHookRunner).pipe(
        Effect.provide(
          makeLayer(baseDir, {
            open,
            attachStream: () => Effect.die(new Error("unused")),
            write,
            resize: () => Effect.void,
            clear: () => Effect.void,
            restart: () => Effect.die(new Error("unused")),
            close: () => Effect.void,
            subscribe: () => Effect.succeed(() => undefined),
            subscribeMetadata: () => Effect.succeed(() => undefined),
          }),
        ),
      ),
    );

    const result = await Effect.runPromise(
      runner.runForThread({
        event: "thread.archived",
        hookRunId: archivedEvent.eventId,
        threadId: thread.id,
        projectId: project.id,
        worktreePath: thread.worktreePath,
        payload: archivedEvent,
        transcript: {
          event: archivedEvent,
          project,
          thread,
        },
      }),
    );

    expect(result.status).toBe("started");
    if (result.status !== "started") return;

    expect(open).toHaveBeenCalledWith({
      threadId: thread.id,
      terminalId: "hook-thread-archived-archive-run-1",
      cwd: "/repo/worktree",
      worktreePath: "/repo/worktree",
      env: expect.objectContaining({
        T3CODE_PROJECT_ROOT: project.workspaceRoot,
        T3CODE_WORKTREE_PATH: "/repo/worktree",
        T3CODE_HOOK_EVENT: "thread.archived",
        T3CODE_HOOK_RUN_ID: archivedEvent.eventId,
        T3CODE_HOOK_PAYLOAD_JSON: result.payloadJsonPath,
        T3CODE_HOOK_TRANSCRIPT_JSON: result.transcriptJsonPath,
        T3CODE_HOOK_TRANSCRIPT_MD: result.transcriptMarkdownPath,
      }),
    });
    expect(write).toHaveBeenCalledWith({
      threadId: thread.id,
      terminalId: "hook-thread-archived-archive-run-1",
      data: "scripts/archive-chat\r",
    });

    expect(fs.readFileSync(result.payloadJsonPath, "utf8")).toContain('"event":"thread.archived"');
    expect(result.transcriptJsonPath).not.toBeNull();
    expect(result.transcriptMarkdownPath).not.toBeNull();
    if (!result.transcriptJsonPath || !result.transcriptMarkdownPath) return;
    expect(fs.readFileSync(result.transcriptJsonPath, "utf8")).toContain(
      '"title":"Archive thread"',
    );
    const markdown = fs.readFileSync(result.transcriptMarkdownPath, "utf8");
    expect(markdown).toContain("# Archive thread");
    expect(markdown).toContain("hello archive");
    expect(markdown).toContain("screenshot.png");
  });
});
