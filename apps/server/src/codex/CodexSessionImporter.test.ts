import { ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeOS from "node:os";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig } from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { CodexSessionImporter, CodexSessionImporterLive } from "./CodexSessionImporter.ts";

const TEST_THREAD_ID = ThreadId.make("thread-1");
const TEST_PROVIDER_THREAD_ID = "019e6f57-772b-7081-bd7e-c98a4b0b12c8";
const encodeCodexJsonString = Schema.encodeEffect(Schema.fromJsonString(Schema.Json));

const layer = CodexSessionImporterLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-codex-importer-" })),
  Layer.provideMerge(NodeServices.layer),
);

const makeCodexHome = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({
    directory: NodeOS.tmpdir(),
    prefix: "t3-codex-home-",
  });
  const sessions = path.join(root, "sessions", "2026", "05", "28");
  yield* fileSystem.makeDirectory(sessions, { recursive: true });
  const filePath = path.join(
    sessions,
    `rollout-2026-05-28T12-56-35-${TEST_PROVIDER_THREAD_ID}.jsonl`,
  );
  const lines = yield* Effect.all(
    [
      {
        timestamp: "2026-05-28T16:07:43.670Z",
        type: "event_msg",
        payload: {
          type: "task_started",
          turn_id: "turn-1",
          started_at: 1779984463,
        },
      },
      {
        timestamp: "2026-05-28T16:07:44.252Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "manda a choice dnv",
        },
      },
      {
        timestamp: "2026-05-28T16:07:48.628Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "choice enviada",
        },
      },
      {
        timestamp: "2026-05-28T16:07:48.696Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-1",
          completed_at: 1779984468,
          last_agent_message: "choice enviada",
        },
      },
      {
        timestamp: "2026-05-28T16:39:06.143Z",
        type: "event_msg",
        payload: {
          type: "task_started",
          turn_id: "turn-2",
          started_at: 1779986346,
        },
      },
      {
        timestamp: "2026-05-28T16:39:06.494Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "oi",
        },
      },
      {
        timestamp: "2026-05-28T16:39:09.603Z",
        type: "event_msg",
        payload: {
          type: "turn_aborted",
          turn_id: "turn-2",
          completed_at: 1779986349,
        },
      },
    ].map((line) => encodeCodexJsonString(line)),
  );
  yield* fileSystem.writeFileString(filePath, lines.join("\n"));
  return { root, filePath };
});

const seedProjection = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO projection_projects (
      project_id,
      title,
      workspace_root,
      default_model_selection_json,
      scripts_json,
      created_at,
      updated_at,
      deleted_at
    )
    VALUES (
      'project-1',
      'Project',
      '/tmp/project',
      '{"provider":"codex","model":"gpt-5"}',
      '[]',
      '2026-05-28T16:00:00.000Z',
      '2026-05-28T16:00:00.000Z',
      NULL
    )
  `;
  yield* sql`
    INSERT INTO projection_threads (
      thread_id,
      project_id,
      title,
      model_selection_json,
      runtime_mode,
      interaction_mode,
      branch,
      worktree_path,
      latest_turn_id,
      latest_user_message_at,
      pending_approval_count,
      pending_user_input_count,
      has_actionable_proposed_plan,
      archived_at,
      created_at,
      updated_at,
      deleted_at
    )
    VALUES (
      ${TEST_THREAD_ID},
      'project-1',
      'Thread',
      '{"provider":"codex","model":"gpt-5"}',
      'full-access',
      'default',
      NULL,
      NULL,
      NULL,
      NULL,
      0,
      1,
      0,
      NULL,
      '2026-05-28T16:00:00.000Z',
      '2026-05-28T16:00:00.000Z',
      NULL
    )
  `;
});

it.effect("CodexSessionImporter imports Codex JSONL messages and clears stale input", () =>
  Effect.gen(function* () {
    const { root, filePath } = yield* makeCodexHome;
    yield* seedProjection;
    const importer = yield* CodexSessionImporter;

    const result = yield* importer.importSession({
      threadId: TEST_THREAD_ID,
      providerThreadId: TEST_PROVIDER_THREAD_ID,
      codexHomePath: root,
    });

    assert.equal(result.sourcePath, filePath);
    assert.equal(result.importedEvents, 7);
    assert.equal(result.importedMessages, 3);
    assert.equal(result.importedTurns, 2);
    assert.equal(result.staleRequestsCleared, 1);

    const sql = yield* SqlClient.SqlClient;
    const messages = yield* sql<{ readonly role: string; readonly text: string }>`
      SELECT role, text
      FROM projection_thread_messages
      WHERE thread_id = ${TEST_THREAD_ID}
      ORDER BY created_at, message_id
    `;
    assert.deepStrictEqual(
      messages.map((message) => [message.role, message.text]),
      [
        ["user", "manda a choice dnv"],
        ["assistant", "choice enviada"],
        ["user", "oi"],
      ],
    );

    const turns = yield* sql<{ readonly turnId: string; readonly state: string }>`
      SELECT turn_id AS "turnId", state
      FROM projection_turns
      WHERE thread_id = ${TEST_THREAD_ID}
      ORDER BY turn_id
    `;
    assert.deepStrictEqual(turns, [
      { turnId: "turn-1", state: "completed" },
      { turnId: "turn-2", state: "interrupted" },
    ]);
  }).pipe(Effect.provide(layer)),
);

it.effect("CodexSessionImporter is idempotent", () =>
  Effect.gen(function* () {
    const { root } = yield* makeCodexHome;
    yield* seedProjection;
    const importer = yield* CodexSessionImporter;

    yield* importer.importSession({
      threadId: TEST_THREAD_ID,
      providerThreadId: TEST_PROVIDER_THREAD_ID,
      codexHomePath: root,
    });
    const second = yield* importer.importSession({
      threadId: TEST_THREAD_ID,
      providerThreadId: TEST_PROVIDER_THREAD_ID,
      codexHomePath: root,
    });

    assert.equal(second.importedEvents, 0);
    assert.equal(second.importedMessages, 0);
    assert.equal(second.importedTurns, 0);
  }).pipe(Effect.provide(layer)),
);

it.effect("CodexSessionImporter does not mark a live provider runtime ready", () =>
  Effect.gen(function* () {
    const { root } = yield* makeCodexHome;
    yield* seedProjection;
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO projection_thread_sessions (
        thread_id,
        status,
        provider_name,
        provider_instance_id,
        provider_session_id,
        provider_thread_id,
        active_turn_id,
        last_error,
        updated_at,
        runtime_mode
      )
      VALUES (
        ${TEST_THREAD_ID},
        'running',
        'codex',
        'codex',
        'session-1',
        ${TEST_PROVIDER_THREAD_ID},
        'turn-live',
        NULL,
        '2026-05-28T16:00:00.000Z',
        'full-access'
      )
    `;
    yield* sql`
      INSERT INTO provider_session_runtime (
        thread_id,
        provider_name,
        provider_instance_id,
        adapter_key,
        runtime_mode,
        status,
        last_seen_at,
        resume_cursor_json,
        runtime_payload_json
      )
      VALUES (
        ${TEST_THREAD_ID},
        'codex',
        'codex',
        'codex:session-1',
        'full-access',
        'running',
        '2026-05-28T16:00:00.000Z',
        '{"threadId":"019e6f57-772b-7081-bd7e-c98a4b0b12c8"}',
        '{}'
      )
    `;
    const importer = yield* CodexSessionImporter;

    yield* importer.importSession({
      threadId: TEST_THREAD_ID,
      providerThreadId: TEST_PROVIDER_THREAD_ID,
      codexHomePath: root,
    });

    const sessions = yield* sql<{
      readonly status: string;
      readonly activeTurnId: string | null;
    }>`
      SELECT status, active_turn_id AS "activeTurnId"
      FROM projection_thread_sessions
      WHERE thread_id = ${TEST_THREAD_ID}
    `;
    assert.deepStrictEqual(sessions, [{ status: "running", activeTurnId: "turn-live" }]);
  }).pipe(Effect.provide(layer)),
);
