import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN worktree_ownership TEXT
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    UPDATE projection_threads
    SET worktree_ownership = 'managed'
    WHERE worktree_path IS NOT NULL
      AND TRIM(worktree_path) <> ''
      AND worktree_ownership IS NULL
  `;
});
