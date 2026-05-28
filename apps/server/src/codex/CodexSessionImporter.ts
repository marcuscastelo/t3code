import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";

import { MessageId, ThreadId, TurnId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export const CodexSessionImportInput = Schema.Struct({
  threadId: ThreadId,
  providerThreadId: Schema.String,
  codexHomePath: Schema.optional(Schema.String),
});
export type CodexSessionImportInput = typeof CodexSessionImportInput.Type;

export const CodexSessionImportResult = Schema.Struct({
  providerThreadId: Schema.String,
  sourcePath: Schema.NullOr(Schema.String),
  importedEvents: Schema.Number,
  importedMessages: Schema.Number,
  importedTurns: Schema.Number,
  staleRequestsCleared: Schema.Number,
});
export type CodexSessionImportResult = typeof CodexSessionImportResult.Type;

export interface CodexSessionImporterShape {
  readonly importSession: (
    input: CodexSessionImportInput,
  ) => Effect.Effect<CodexSessionImportResult, CodexSessionImportError>;
  readonly importThread: (
    input: Pick<CodexSessionImportInput, "threadId">,
  ) => Effect.Effect<CodexSessionImportResult, CodexSessionImportError>;
}

export class CodexSessionImportError extends Schema.TaggedErrorClass<CodexSessionImportError>()(
  "CodexSessionImportError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {
  override get message(): string {
    return `${this.operation}: ${this.detail}`;
  }
}

export class CodexSessionImporter extends Context.Service<
  CodexSessionImporter,
  CodexSessionImporterShape
>()("t3/codex/CodexSessionImporter") {}

type CodexRolloutPayload =
  | { readonly type: "task_started"; readonly turn_id?: unknown; readonly started_at?: unknown }
  | { readonly type: "user_message"; readonly message?: unknown }
  | {
      readonly type: "agent_message";
      readonly message?: unknown;
      readonly phase?: unknown;
    }
  | {
      readonly type: "task_complete";
      readonly turn_id?: unknown;
      readonly completed_at?: unknown;
      readonly last_agent_message?: unknown;
    }
  | {
      readonly type: "turn_aborted";
      readonly turn_id?: unknown;
      readonly completed_at?: unknown;
    };

interface CodexRolloutEvent {
  readonly timestamp: string;
  readonly offset: number;
  readonly payload: CodexRolloutPayload;
}

interface ImportCursor {
  readonly sourcePath: string | null;
  readonly lastOffset: number;
}

function hash(parts: ReadonlyArray<unknown>): string {
  return NodeCrypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function stableMessageId(input: {
  readonly providerThreadId: string;
  readonly timestamp: string;
  readonly role: "user" | "assistant";
  readonly text: string;
}): MessageId {
  return MessageId.make(
    `codex-import-${input.role}-${hash([
      input.providerThreadId,
      input.timestamp,
      input.role,
      input.text,
    ]).slice(0, 24)}`,
  );
}

function toIsoFromCodexSeconds(value: unknown, fallback: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Option.match(DateTime.make(value * 1000), {
    onNone: () => fallback,
    onSome: DateTime.formatIso,
  });
}

function isPayload(value: unknown): value is CodexRolloutPayload {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  const type = (value as { readonly type?: unknown }).type;
  return (
    type === "task_started" ||
    type === "user_message" ||
    type === "agent_message" ||
    type === "task_complete" ||
    type === "turn_aborted"
  );
}

function parseCodexRollout(content: string): ReadonlyArray<CodexRolloutEvent> {
  const events: CodexRolloutEvent[] = [];
  let offset = 0;
  for (const line of content.split(/\n/)) {
    const lineOffset = offset;
    offset += Buffer.byteLength(line) + 1;
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as {
        readonly timestamp?: unknown;
        readonly type?: unknown;
        readonly payload?: unknown;
      };
      if (
        parsed.type === "event_msg" &&
        typeof parsed.timestamp === "string" &&
        isPayload(parsed.payload)
      ) {
        events.push({
          timestamp: parsed.timestamp,
          offset: lineOffset,
          payload: parsed.payload,
        });
      }
    } catch {
      continue;
    }
  }
  return events;
}

const makeCodexSessionImporter = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json));
  const mapImportError = (operation: string) => (cause: unknown) =>
    new CodexSessionImportError({
      operation,
      detail: Cause.isCause(cause) ? Cause.pretty(cause) : "Failed to import Codex session.",
      cause,
    });

  const findCodexRolloutFile = (root: string, providerThreadId: string) =>
    Effect.gen(function* () {
      const sessionsDir = path.join(root, "sessions");
      const entries = yield* fileSystem
        .readDirectory(sessionsDir, { recursive: true })
        .pipe(Effect.catch(() => Effect.succeed([] as Array<string>)));
      let latest: { path: string; mtimeMs: number } | null = null;
      for (const entry of entries) {
        if (!entry.endsWith(".jsonl") || !entry.includes(providerThreadId)) continue;
        const fullPath = path.join(sessionsDir, entry);
        const stat = yield* fileSystem
          .stat(fullPath)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (stat === null || stat.type !== "File") continue;
        const mtimeMs = Option.match(stat.mtime, {
          onNone: () => 0,
          onSome: (mtime) => mtime.getTime(),
        });
        if (latest === null || mtimeMs > latest.mtimeMs) {
          latest = { path: fullPath, mtimeMs };
        }
      }
      return latest?.path ?? null;
    });

  const readCursor = (providerThreadId: string) =>
    sql<{
      readonly sourcePath: string | null;
      readonly lastOffset: number;
    }>`
      SELECT source_path AS "sourcePath", last_offset AS "lastOffset"
      FROM codex_import_state
      WHERE provider_thread_id = ${providerThreadId}
      LIMIT 1
    `.pipe(Effect.map((rows): ImportCursor => rows[0] ?? { sourcePath: null, lastOffset: -1 }));

  const insertEventOnce = (input: {
    readonly eventKey: string;
    readonly providerThreadId: string;
    readonly sourcePath: string;
    readonly sourceOffset: number;
    readonly eventTimestamp: string;
    readonly eventType: string;
    readonly importedAt: string;
  }) =>
    Effect.gen(function* () {
      yield* sql`
        INSERT OR IGNORE INTO codex_import_events (
          event_key,
          provider_thread_id,
          source_path,
          source_offset,
          event_timestamp,
          event_type,
          imported_at
        )
        VALUES (
          ${input.eventKey},
          ${input.providerThreadId},
          ${input.sourcePath},
          ${input.sourceOffset},
          ${input.eventTimestamp},
          ${input.eventType},
          ${input.importedAt}
        )
      `;
      const changes = yield* sql<{ readonly changed: number }>`SELECT changes() AS changed`;
      return (changes[0]?.changed ?? 0) > 0;
    });

  const clearStaleRequests = (threadId: ThreadId, at: string) =>
    Effect.gen(function* () {
      const rows = yield* sql<{ readonly count: number }>`
        SELECT pending_user_input_count AS count
        FROM projection_threads
        WHERE thread_id = ${threadId}
        LIMIT 1
      `;
      const staleRequestsCleared = Math.max(0, rows[0]?.count ?? 0);
      if (staleRequestsCleared === 0) return 0;
      yield* sql`
        UPDATE projection_threads
        SET pending_user_input_count = 0, updated_at = ${at}
        WHERE thread_id = ${threadId}
      `;
      yield* sql`
        INSERT OR IGNORE INTO projection_thread_activities (
          activity_id,
          thread_id,
          turn_id,
          tone,
          kind,
          summary,
          payload_json,
          sequence,
          created_at
        )
        VALUES (
          ${`codex-import-stale-user-input-${threadId}-${hash([threadId, at]).slice(0, 16)}`},
          ${threadId},
          NULL,
          'warning',
          'provider.user-input.respond.failed',
          'Cleared stale Codex user input request after importing durable session state.',
          ${encodeJson({
            detail: "Unknown pending Codex user input request after Codex session recovery.",
            source: "codex-session-importer",
          })},
          NULL,
          ${at}
        )
      `;
      return staleRequestsCleared;
    });

  const importSession: CodexSessionImporterShape["importSession"] = (input) =>
    Effect.gen(function* () {
      const codexHomePath =
        input.codexHomePath && input.codexHomePath.trim().length > 0
          ? input.codexHomePath.replace(/^~(?=$|\/)/, NodeOS.homedir())
          : path.join(NodeOS.homedir(), ".codex");
      const sourcePath = yield* findCodexRolloutFile(codexHomePath, input.providerThreadId);
      if (sourcePath === null) {
        return {
          providerThreadId: input.providerThreadId,
          sourcePath: null,
          importedEvents: 0,
          importedMessages: 0,
          importedTurns: 0,
          staleRequestsCleared: 0,
        };
      }

      const cursor = yield* readCursor(input.providerThreadId);
      const content = yield* fileSystem.readFileString(sourcePath);
      const events = parseCodexRollout(content).filter(
        (event) => cursor.sourcePath !== sourcePath || event.offset > cursor.lastOffset,
      );
      let currentTurnId: TurnId | null = null;
      let lastAssistantMessageId: MessageId | null = null;
      let importedEvents = 0;
      let importedMessages = 0;
      const importedTurnIds = new Set<string>();
      let maxOffset = cursor.sourcePath === sourcePath ? cursor.lastOffset : -1;
      let maxTimestamp = "";

      yield* sql.withTransaction(
        Effect.gen(function* () {
          for (const event of events) {
            maxOffset = Math.max(maxOffset, event.offset);
            maxTimestamp = event.timestamp > maxTimestamp ? event.timestamp : maxTimestamp;
            const text =
              "message" in event.payload && typeof event.payload.message === "string"
                ? event.payload.message
                : "last_agent_message" in event.payload &&
                    typeof event.payload.last_agent_message === "string"
                  ? event.payload.last_agent_message
                  : "";
            const eventKey = hash([
              input.providerThreadId,
              event.timestamp,
              event.offset,
              event.payload.type,
              text,
            ]);
            const importedAt = yield* nowIso;
            const shouldImport = yield* insertEventOnce({
              eventKey,
              providerThreadId: input.providerThreadId,
              sourcePath,
              sourceOffset: event.offset,
              eventTimestamp: event.timestamp,
              eventType: event.payload.type,
              importedAt,
            });
            if (!shouldImport) continue;
            importedEvents += 1;

            if (event.payload.type === "task_started") {
              if (typeof event.payload.turn_id !== "string") continue;
              currentTurnId = TurnId.make(event.payload.turn_id);
              lastAssistantMessageId = null;
              const startedAt = toIsoFromCodexSeconds(event.payload.started_at, event.timestamp);
              yield* sql`
                INSERT INTO projection_turns (
                  thread_id,
                  turn_id,
                  pending_message_id,
                  source_proposed_plan_thread_id,
                  source_proposed_plan_id,
                  assistant_message_id,
                  state,
                  requested_at,
                  started_at,
                  completed_at,
                  checkpoint_turn_count,
                  checkpoint_ref,
                  checkpoint_status,
                  checkpoint_files_json
                )
                VALUES (
                  ${input.threadId},
                  ${currentTurnId},
                  NULL,
                  NULL,
                  NULL,
                  NULL,
                  'running',
                  ${startedAt},
                  ${startedAt},
                  NULL,
                  NULL,
                  NULL,
                  NULL,
                  '[]'
                )
                ON CONFLICT (thread_id, turn_id)
                DO UPDATE SET
                  state = CASE
                    WHEN projection_turns.state IN ('completed', 'interrupted', 'error')
                    THEN projection_turns.state
                    ELSE 'running'
                  END,
                  requested_at = COALESCE(projection_turns.requested_at, excluded.requested_at),
                  started_at = COALESCE(projection_turns.started_at, excluded.started_at)
              `;
              importedTurnIds.add(currentTurnId);
              continue;
            }

            if (event.payload.type === "user_message") {
              if (typeof event.payload.message !== "string" || event.payload.message.length === 0) {
                continue;
              }
              const messageId = stableMessageId({
                providerThreadId: input.providerThreadId,
                timestamp: event.timestamp,
                role: "user",
                text: event.payload.message,
              });
              yield* sql`
                INSERT INTO projection_thread_messages (
                  message_id,
                  thread_id,
                  turn_id,
                  role,
                  text,
                  attachments_json,
                  is_streaming,
                  created_at,
                  updated_at
                )
                VALUES (
                  ${messageId},
                  ${input.threadId},
                  NULL,
                  'user',
                  ${event.payload.message},
                  '[]',
                  0,
                  ${event.timestamp},
                  ${event.timestamp}
                )
                ON CONFLICT (message_id) DO NOTHING
              `;
              importedMessages += 1;
              if (currentTurnId !== null) {
                yield* sql`
                  UPDATE projection_turns
                  SET pending_message_id = COALESCE(pending_message_id, ${messageId})
                  WHERE thread_id = ${input.threadId}
                    AND turn_id = ${currentTurnId}
                `;
              }
              yield* sql`
                UPDATE projection_threads
                SET latest_user_message_at = ${event.timestamp}, updated_at = ${event.timestamp}
                WHERE thread_id = ${input.threadId}
              `;
              continue;
            }

            if (event.payload.type === "agent_message") {
              if (typeof event.payload.message !== "string" || event.payload.message.length === 0) {
                continue;
              }
              const messageId = stableMessageId({
                providerThreadId: input.providerThreadId,
                timestamp: event.timestamp,
                role: "assistant",
                text: event.payload.message,
              });
              lastAssistantMessageId = messageId;
              yield* sql`
                INSERT INTO projection_thread_messages (
                  message_id,
                  thread_id,
                  turn_id,
                  role,
                  text,
                  attachments_json,
                  is_streaming,
                  created_at,
                  updated_at
                )
                VALUES (
                  ${messageId},
                  ${input.threadId},
                  ${currentTurnId},
                  'assistant',
                  ${event.payload.message},
                  '[]',
                  0,
                  ${event.timestamp},
                  ${event.timestamp}
                )
                ON CONFLICT (message_id) DO NOTHING
              `;
              importedMessages += 1;
              if (currentTurnId !== null) {
                yield* sql`
                UPDATE projection_turns
                SET assistant_message_id = ${messageId},
                    state = CASE
                      WHEN state IN ('interrupted', 'error') THEN state
                      ELSE 'completed'
                    END,
                    completed_at = COALESCE(completed_at, ${event.timestamp})
                WHERE thread_id = ${input.threadId}
                  AND turn_id = ${currentTurnId}
              `;
              }
              continue;
            }

            if (event.payload.type === "task_complete") {
              const turnId =
                typeof event.payload.turn_id === "string"
                  ? TurnId.make(event.payload.turn_id)
                  : currentTurnId;
              if (turnId === null) continue;
              const completedAt = toIsoFromCodexSeconds(
                event.payload.completed_at,
                event.timestamp,
              );
              yield* sql`
                UPDATE projection_turns
                SET state = 'completed',
                    assistant_message_id = COALESCE(${lastAssistantMessageId}, assistant_message_id),
                    completed_at = ${completedAt}
                WHERE thread_id = ${input.threadId}
                  AND turn_id = ${turnId}
              `;
              yield* sql`
                UPDATE projection_threads
                SET latest_turn_id = ${turnId}, updated_at = ${completedAt}
                WHERE thread_id = ${input.threadId}
              `;
              importedTurnIds.add(turnId);
              currentTurnId = null;
              lastAssistantMessageId = null;
              continue;
            }

            if (event.payload.type === "turn_aborted") {
              const turnId =
                typeof event.payload.turn_id === "string"
                  ? TurnId.make(event.payload.turn_id)
                  : currentTurnId;
              if (turnId === null) continue;
              const completedAt = toIsoFromCodexSeconds(
                event.payload.completed_at,
                event.timestamp,
              );
              yield* sql`
                UPDATE projection_turns
                SET state = 'interrupted',
                    completed_at = ${completedAt}
                WHERE thread_id = ${input.threadId}
                  AND turn_id = ${turnId}
              `;
              yield* sql`
                UPDATE projection_threads
                SET latest_turn_id = ${turnId}, updated_at = ${completedAt}
                WHERE thread_id = ${input.threadId}
              `;
              importedTurnIds.add(turnId);
              currentTurnId = null;
              lastAssistantMessageId = null;
            }
          }

          const updatedAt = maxTimestamp || (yield* nowIso);
          yield* sql`
            INSERT INTO codex_import_state (
              provider_thread_id,
              source_path,
              last_timestamp,
              last_offset,
              updated_at
            )
            VALUES (
              ${input.providerThreadId},
              ${sourcePath},
              ${maxTimestamp || null},
              ${Math.max(0, maxOffset)},
              ${updatedAt}
            )
            ON CONFLICT (provider_thread_id)
            DO UPDATE SET
              source_path = excluded.source_path,
              last_timestamp = excluded.last_timestamp,
              last_offset = MAX(codex_import_state.last_offset, excluded.last_offset),
              updated_at = excluded.updated_at
          `;

          yield* sql`
            UPDATE projection_thread_sessions
            SET status = 'ready',
                active_turn_id = NULL,
                updated_at = ${updatedAt}
            WHERE thread_id = ${input.threadId}
              AND status IN ('running', 'starting')
          `;
        }),
      );

      const staleRequestsCleared = yield* clearStaleRequests(
        input.threadId,
        maxTimestamp || (yield* nowIso),
      );
      return {
        providerThreadId: input.providerThreadId,
        sourcePath,
        importedEvents,
        importedMessages,
        importedTurns: importedTurnIds.size,
        staleRequestsCleared,
      };
    }).pipe(Effect.mapError(mapImportError("CodexSessionImporter.importSession")));

  const importThread: CodexSessionImporterShape["importThread"] = ({ threadId }) =>
    Effect.gen(function* () {
      const rows = yield* sql<{
        readonly providerName: string;
        readonly resumeCursorJson: string | null;
      }>`
        SELECT
          provider_name AS "providerName",
          resume_cursor_json AS "resumeCursorJson"
        FROM provider_session_runtime
        WHERE thread_id = ${threadId}
        LIMIT 1
      `;
      const row = rows[0];
      if (!row || row.providerName !== "codex") {
        return {
          providerThreadId: "",
          sourcePath: null,
          importedEvents: 0,
          importedMessages: 0,
          importedTurns: 0,
          staleRequestsCleared: 0,
        };
      }
      const resumeCursor = yield* Effect.try({
        try: () => {
          if (row.resumeCursorJson === null) return {};
          return JSON.parse(row.resumeCursorJson) as { readonly threadId?: unknown };
        },
        catch: () => ({}),
      });
      const providerThreadId =
        typeof resumeCursor.threadId === "string" ? resumeCursor.threadId : "";
      if (providerThreadId.length === 0) {
        return {
          providerThreadId,
          sourcePath: null,
          importedEvents: 0,
          importedMessages: 0,
          importedTurns: 0,
          staleRequestsCleared: 0,
        };
      }

      return yield* importSession({ threadId, providerThreadId });
    }).pipe(Effect.mapError(mapImportError("CodexSessionImporter.importThread")));

  return { importSession, importThread } satisfies CodexSessionImporterShape;
});

export const CodexSessionImporterLive = Layer.effect(
  CodexSessionImporter,
  makeCodexSessionImporter,
);
