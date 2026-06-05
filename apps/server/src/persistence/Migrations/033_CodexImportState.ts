import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS codex_import_state (
      provider_thread_id TEXT PRIMARY KEY,
      source_path TEXT,
      last_timestamp TEXT,
      last_offset INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS codex_import_events (
      event_key TEXT PRIMARY KEY,
      provider_thread_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      source_offset INTEGER NOT NULL,
      event_timestamp TEXT NOT NULL,
      event_type TEXT NOT NULL,
      imported_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_codex_import_events_thread_timestamp
    ON codex_import_events(provider_thread_id, event_timestamp)
  `;
});
