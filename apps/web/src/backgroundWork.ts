import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime";
import type {
  EnvironmentId,
  OrchestrationThreadActivity,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";

import { compareActivitiesByOrder } from "./session-logic";
import type { ThreadTerminalState } from "./terminalStateStore";
import type { Thread } from "./types";

export type BackgroundWorkKind = "turn" | "tool" | "task" | "terminal";

export interface BackgroundWorkItem {
  id: string;
  kind: BackgroundWorkKind;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  projectId: ProjectId;
  threadTitle: string;
  label: string;
  startedAt: string;
  detail?: string | undefined;
  terminalId?: string | undefined;
}

type BackgroundThread = Pick<
  Thread,
  | "id"
  | "environmentId"
  | "projectId"
  | "title"
  | "session"
  | "latestTurn"
  | "updatedAt"
  | "createdAt"
  | "activities"
>;

type TerminalStateForBackground = Pick<ThreadTerminalState, "runningTerminalIds"> &
  Partial<Pick<ThreadTerminalState, "runningTerminalStartedAtById">>;

export interface DeriveBackgroundWorkItemsInput {
  threads: ReadonlyArray<BackgroundThread>;
  terminalStateByThreadKey: Record<string, TerminalStateForBackground | undefined>;
}

interface ActiveActivityWork {
  key: string;
  fallbackKey: string;
  lifecycleFallbackKey?: string;
  kind: "tool" | "task";
  startedAt: string;
  label: string;
  detail?: string | undefined;
}

const BACKGROUND_WORK_KIND_RANK: Record<BackgroundWorkKind, number> = {
  turn: 0,
  task: 1,
  tool: 2,
  terminal: 3,
};

export function deriveBackgroundWorkItems(
  input: DeriveBackgroundWorkItemsInput,
): BackgroundWorkItem[] {
  const items = input.threads.flatMap((thread) => [
    ...deriveThreadTurnWorkItems(thread),
    ...deriveThreadActivityWorkItems(thread),
    ...deriveThreadTerminalWorkItems(thread, input.terminalStateByThreadKey),
  ]);

  return items.toSorted(compareBackgroundWorkItems);
}

function deriveThreadTurnWorkItems(thread: BackgroundThread): BackgroundWorkItem[] {
  const activeTurnId = thread.session?.activeTurnId;
  if (thread.session?.status !== "running" || activeTurnId == null) {
    return [];
  }

  const activeLatestTurn = thread.latestTurn?.turnId === activeTurnId ? thread.latestTurn : null;
  const startedAt = activeLatestTurn?.startedAt ?? thread.session.updatedAt;

  return [
    {
      id: `turn:${thread.environmentId}:${thread.id}:${activeTurnId}`,
      kind: "turn",
      environmentId: thread.environmentId,
      threadId: thread.id,
      projectId: thread.projectId,
      threadTitle: thread.title,
      label: "Agent turn",
      startedAt,
    },
  ];
}

function deriveThreadActivityWorkItems(thread: BackgroundThread): BackgroundWorkItem[] {
  const activeTurnId = thread.session?.activeTurnId;
  if (thread.session?.status !== "running" || activeTurnId == null) {
    return [];
  }

  const active = new Map<string, ActiveActivityWork>();
  const orderedActivities = [...thread.activities]
    .filter((activity) => activity.turnId === activeTurnId)
    .toSorted(compareActivitiesByOrder);

  for (const activity of orderedActivities) {
    const activityKind = toActivityBackgroundKind(activity.kind);
    if (!activityKind) continue;

    const payload = asRecord(activity.payload);
    const fallbackKey = deriveActivityFallbackKey(activity, activityKind, payload);
    const preciseKey = deriveActivityPreciseKey(activityKind, payload);
    const key = preciseKey ?? fallbackKey;
    const lifecycleFallbackKey = deriveLifecycleFallbackKey(activityKind, payload);

    if (isCompletedActivityKind(activity.kind)) {
      deleteActiveActivity(active, key, fallbackKey, lifecycleFallbackKey);
      continue;
    }

    upsertActiveActivity(active, {
      key,
      fallbackKey,
      ...(lifecycleFallbackKey ? { lifecycleFallbackKey } : {}),
      kind: activityKind,
      startedAt: activity.createdAt,
      label: deriveActivityLabel(activity, activityKind, payload),
      detail: asTrimmedString(payload?.detail) ?? undefined,
    });
  }

  return [...active.values()].map((work) => {
    const item: BackgroundWorkItem = {
      id: `${work.kind}:${thread.environmentId}:${thread.id}:${work.key}`,
      kind: work.kind,
      environmentId: thread.environmentId,
      threadId: thread.id,
      projectId: thread.projectId,
      threadTitle: thread.title,
      label: work.label,
      startedAt: work.startedAt,
    };
    if (work.detail) {
      item.detail = work.detail;
    }
    return item;
  });
}

function deriveThreadTerminalWorkItems(
  thread: BackgroundThread,
  terminalStateByThreadKey: Record<string, TerminalStateForBackground | undefined>,
): BackgroundWorkItem[] {
  const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
  const terminalState = terminalStateByThreadKey[threadKey];
  if (!terminalState || terminalState.runningTerminalIds.length === 0) {
    return [];
  }

  const runningTerminalIds = [...new Set(terminalState.runningTerminalIds)];
  return runningTerminalIds.map((terminalId) => {
    const startedAt =
      terminalState.runningTerminalStartedAtById?.[terminalId] ??
      thread.updatedAt ??
      thread.createdAt;
    return {
      id: `terminal:${thread.environmentId}:${thread.id}:${terminalId}`,
      kind: "terminal" as const,
      environmentId: thread.environmentId,
      threadId: thread.id,
      projectId: thread.projectId,
      threadTitle: thread.title,
      label: terminalId === "default" ? "Terminal" : terminalId,
      startedAt,
      terminalId,
    };
  });
}

function upsertActiveActivity(active: Map<string, ActiveActivityWork>, next: ActiveActivityWork) {
  const previous = active.get(next.key) ?? active.get(next.fallbackKey);
  if (next.key !== next.fallbackKey) {
    active.delete(next.fallbackKey);
  }

  active.set(next.key, {
    ...next,
    startedAt: previous?.startedAt ?? next.startedAt,
    detail: next.detail ?? previous?.detail,
  });
}

function deleteActiveActivity(
  active: Map<string, ActiveActivityWork>,
  key: string,
  fallbackKey: string,
  lifecycleFallbackKey: string | null,
) {
  active.delete(key);
  active.delete(fallbackKey);
  const entries = lifecycleFallbackKey ? [...active.entries()].toReversed() : [...active.entries()];
  for (const [activeKey, work] of entries) {
    if (
      work.fallbackKey === fallbackKey ||
      (lifecycleFallbackKey && work.lifecycleFallbackKey === lifecycleFallbackKey)
    ) {
      active.delete(activeKey);
      if (lifecycleFallbackKey) {
        return;
      }
    }
  }
}

function toActivityBackgroundKind(kind: string): "tool" | "task" | null {
  if (kind === "tool.started" || kind === "tool.updated" || kind === "tool.completed") {
    return "tool";
  }
  if (kind === "task.started" || kind === "task.progress" || kind === "task.completed") {
    return "task";
  }
  return null;
}

function isCompletedActivityKind(kind: string): boolean {
  return kind === "tool.completed" || kind === "task.completed";
}

function deriveActivityPreciseKey(
  activityKind: "tool" | "task",
  payload: Record<string, unknown> | null,
): string | null {
  if (activityKind === "task") {
    const taskId = asTrimmedString(payload?.taskId);
    return taskId ? `task:${taskId}` : null;
  }

  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const toolCallId = asTrimmedString(
    payload?.itemId ?? payload?.toolCallId ?? data?.toolCallId ?? data?.itemId ?? item?.id,
  );
  return toolCallId ? `tool:${toolCallId}` : null;
}

function deriveLifecycleFallbackKey(
  activityKind: "tool" | "task",
  payload: Record<string, unknown> | null,
): string | null {
  if (activityKind === "task") {
    const taskId = asTrimmedString(payload?.taskId);
    return taskId ? `task:${taskId}` : null;
  }

  const itemType = asTrimmedString(payload?.itemType);
  return itemType ? `tool:${itemType}` : null;
}

function deriveActivityFallbackKey(
  activity: OrchestrationThreadActivity,
  activityKind: "tool" | "task",
  payload: Record<string, unknown> | null,
): string {
  const itemKind =
    activityKind === "tool"
      ? asTrimmedString(payload?.itemType)
      : asTrimmedString(payload?.taskType);
  const label = normalizeLifecycleLabel(activity.summary);
  return [activityKind, activity.turnId ?? "", itemKind ?? "", label].join("\u001f");
}

function deriveActivityLabel(
  activity: OrchestrationThreadActivity,
  activityKind: "tool" | "task",
  payload: Record<string, unknown> | null,
): string {
  if (activityKind === "task") {
    return (
      asTrimmedString(payload?.summary) ??
      asTrimmedString(payload?.detail) ??
      stripLifecycleSuffix(activity.summary)
    );
  }
  return asTrimmedString(payload?.title) ?? stripLifecycleSuffix(activity.summary);
}

function stripLifecycleSuffix(value: string): string {
  const stripped = value.replace(/\s+(?:started|updated|complete|completed)\s*$/i, "").trim();
  return stripped.length > 0 ? stripped : value;
}

function normalizeLifecycleLabel(value: string): string {
  return stripLifecycleSuffix(value).replace(/\s+/g, " ").toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function compareBackgroundWorkItems(left: BackgroundWorkItem, right: BackgroundWorkItem): number {
  return (
    left.startedAt.localeCompare(right.startedAt) ||
    BACKGROUND_WORK_KIND_RANK[left.kind] - BACKGROUND_WORK_KIND_RANK[right.kind] ||
    left.threadTitle.localeCompare(right.threadTitle) ||
    left.label.localeCompare(right.label) ||
    left.id.localeCompare(right.id)
  );
}
