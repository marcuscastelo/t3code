import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime";
import {
  EnvironmentId,
  EventId,
  ProjectId,
  ProviderDriverKind,
  ThreadId,
  TurnId,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { deriveBackgroundWorkItems } from "./backgroundWork";
import type { Thread } from "./types";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const PROJECT_ID = ProjectId.make("project-1");
const THREAD_ID = ThreadId.make("thread-1");
const TURN_ID = TurnId.make("turn-1");

function makeActivity(
  overrides: Omit<Partial<OrchestrationThreadActivity>, "id" | "kind" | "createdAt"> & {
    id: string;
    kind: string;
    createdAt: string;
  },
): OrchestrationThreadActivity {
  return {
    id: EventId.make(overrides.id),
    tone: overrides.tone ?? "tool",
    kind: overrides.kind,
    summary: overrides.summary ?? "Tool call",
    payload: overrides.payload ?? {},
    turnId: overrides.turnId ?? TURN_ID,
    createdAt: overrides.createdAt,
    ...(overrides.sequence !== undefined ? { sequence: overrides.sequence } : {}),
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: THREAD_ID,
    environmentId: ENVIRONMENT_ID,
    codexThreadId: null,
    projectId: PROJECT_ID,
    title: "Build UI",
    modelSelection: { instanceId: "codex", model: "gpt-5" } as Thread["modelSelection"],
    runtimeMode: "full-access",
    interactionMode: "default",
    session: {
      provider: ProviderDriverKind.make("codex"),
      status: "running",
      activeTurnId: TURN_ID,
      createdAt: "2026-04-02T20:00:00.000Z",
      updatedAt: "2026-04-02T20:00:05.000Z",
      orchestrationStatus: "running",
    },
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-04-02T19:59:00.000Z",
    archivedAt: null,
    updatedAt: "2026-04-02T20:00:05.000Z",
    latestTurn: {
      turnId: TURN_ID,
      state: "running",
      requestedAt: "2026-04-02T20:00:00.000Z",
      startedAt: "2026-04-02T20:00:01.000Z",
      completedAt: null,
      assistantMessageId: null,
    },
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

describe("deriveBackgroundWorkItems", () => {
  it("includes running turns", () => {
    const items = deriveBackgroundWorkItems({
      threads: [makeThread()],
      terminalStateByThreadKey: {},
    });

    expect(items).toMatchObject([
      {
        kind: "turn",
        environmentId: ENVIRONMENT_ID,
        threadId: THREAD_ID,
        projectId: PROJECT_ID,
        threadTitle: "Build UI",
        label: "Agent turn",
        startedAt: "2026-04-02T20:00:01.000Z",
      },
    ]);
  });

  it("excludes non-running turns", () => {
    const completed = makeThread({
      session: {
        provider: ProviderDriverKind.make("codex"),
        status: "ready",
        activeTurnId: undefined,
        createdAt: "2026-04-02T20:00:00.000Z",
        updatedAt: "2026-04-02T20:02:00.000Z",
        orchestrationStatus: "ready",
      },
      latestTurn: {
        turnId: TURN_ID,
        state: "completed",
        requestedAt: "2026-04-02T20:00:00.000Z",
        startedAt: "2026-04-02T20:00:01.000Z",
        completedAt: "2026-04-02T20:02:00.000Z",
        assistantMessageId: null,
      },
    });
    const errored = makeThread({
      id: ThreadId.make("thread-2"),
      session: {
        provider: ProviderDriverKind.make("codex"),
        status: "error",
        activeTurnId: TURN_ID,
        createdAt: "2026-04-02T20:00:00.000Z",
        updatedAt: "2026-04-02T20:02:00.000Z",
        orchestrationStatus: "error",
      },
    });

    expect(
      deriveBackgroundWorkItems({
        threads: [completed, errored],
        terminalStateByThreadKey: {},
      }),
    ).toEqual([]);
  });

  it("includes open task and tool activities", () => {
    const items = deriveBackgroundWorkItems({
      threads: [
        makeThread({
          activities: [
            makeActivity({
              id: "task-start",
              kind: "task.started",
              createdAt: "2026-04-02T20:00:02.000Z",
              summary: "Task started",
              payload: { taskId: "task-1", detail: "Plan edits" },
            }),
            makeActivity({
              id: "task-progress",
              kind: "task.progress",
              createdAt: "2026-04-02T20:00:03.000Z",
              summary: "Reasoning update",
              payload: { taskId: "task-1", summary: "Reading files" },
            }),
            makeActivity({
              id: "tool-start",
              kind: "tool.started",
              createdAt: "2026-04-02T20:00:04.000Z",
              summary: "Read file started",
              payload: { itemType: "file_read" },
            }),
            makeActivity({
              id: "tool-update",
              kind: "tool.updated",
              createdAt: "2026-04-02T20:00:05.000Z",
              summary: "Read file",
              payload: { itemType: "file_read", data: { toolCallId: "tool-1" } },
            }),
          ],
        }),
      ],
      terminalStateByThreadKey: {},
    });

    expect(items.filter((item) => item.kind !== "turn")).toMatchObject([
      {
        kind: "task",
        label: "Reading files",
        startedAt: "2026-04-02T20:00:02.000Z",
      },
      {
        kind: "tool",
        label: "Read file",
        startedAt: "2026-04-02T20:00:04.000Z",
      },
    ]);
  });

  it("excludes completed task and tool activities", () => {
    const items = deriveBackgroundWorkItems({
      threads: [
        makeThread({
          activities: [
            makeActivity({
              id: "task-start",
              kind: "task.started",
              createdAt: "2026-04-02T20:00:02.000Z",
              payload: { taskId: "task-1" },
            }),
            makeActivity({
              id: "task-complete",
              kind: "task.completed",
              createdAt: "2026-04-02T20:00:03.000Z",
              payload: { taskId: "task-1" },
            }),
            makeActivity({
              id: "tool-start",
              kind: "tool.started",
              createdAt: "2026-04-02T20:00:04.000Z",
              summary: "Read file started",
              payload: { itemType: "file_read" },
            }),
            makeActivity({
              id: "tool-complete",
              kind: "tool.completed",
              createdAt: "2026-04-02T20:00:05.000Z",
              summary: "Read file",
              payload: { itemType: "file_read", data: { toolCallId: "tool-1" } },
            }),
          ],
        }),
      ],
      terminalStateByThreadKey: {},
    });

    expect(items.filter((item) => item.kind === "task" || item.kind === "tool")).toEqual([]);
  });

  it("excludes legacy completed tools when started and completed labels differ", () => {
    const items = deriveBackgroundWorkItems({
      threads: [
        makeThread({
          activities: [
            makeActivity({
              id: "tool-start",
              kind: "tool.started",
              createdAt: "2026-04-02T20:00:04.000Z",
              summary: "Tool started",
              payload: { itemType: "command_execution", detail: "bun lint" },
            }),
            makeActivity({
              id: "tool-update",
              kind: "tool.updated",
              createdAt: "2026-04-02T20:00:05.000Z",
              summary: "Tool updated",
              payload: { itemType: "command_execution", detail: "bun lint" },
            }),
            makeActivity({
              id: "tool-complete",
              kind: "tool.completed",
              createdAt: "2026-04-02T20:00:06.000Z",
              summary: "Ran command",
              payload: { itemType: "command_execution", detail: "bun lint\nExit code: 0" },
            }),
          ],
        }),
      ],
      terminalStateByThreadKey: {},
    });

    expect(items.filter((item) => item.kind === "tool")).toEqual([]);
  });

  it("sorts items by startedAt", () => {
    const threadRef = scopeThreadRef(ENVIRONMENT_ID, THREAD_ID);
    const items = deriveBackgroundWorkItems({
      threads: [
        makeThread({
          activities: [
            makeActivity({
              id: "task-start",
              kind: "task.started",
              createdAt: "2026-04-02T20:00:02.000Z",
              payload: { taskId: "task-1" },
            }),
          ],
          latestTurn: {
            turnId: TURN_ID,
            state: "running",
            requestedAt: "2026-04-02T20:00:00.000Z",
            startedAt: "2026-04-02T20:00:03.000Z",
            completedAt: null,
            assistantMessageId: null,
          },
        }),
      ],
      terminalStateByThreadKey: {
        [scopedThreadKey(threadRef)]: {
          runningTerminalIds: ["default"],
          runningTerminalStartedAtById: {
            default: "2026-04-02T20:00:01.000Z",
          },
        },
      },
    });

    expect(items.map((item) => item.kind)).toEqual(["terminal", "task", "turn"]);
  });
});
