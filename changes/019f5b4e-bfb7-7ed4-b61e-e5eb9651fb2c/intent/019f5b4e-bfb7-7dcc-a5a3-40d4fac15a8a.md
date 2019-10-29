<!-- forksmith:intent:v1
{"schema_version":1,"intent":{"intent_revision_id":"019f5b4e-bfb7-7dcc-a5a3-40d4fac15a8a","change_id":"019f5b4e-bfb7-7ed4-b61e-e5eb9651fb2c","generation":1,"markdown_blob_oid_or_content_hash":"sha256:52798ef8c177ed175df07e4c05c957ac23a05eace2a9ffbd59e5244c0d51d95f","invariants":["upstream remains read-only and no command other than forksmith publish pushes","all fork changes retain explicit intent, lineage, validation, and publication evidence"],"observable_behaviors":["agents discover the current Forksmith state before creating or reconciling fork work","contributors use an isolated Forksmith draft or job clone and submit it through Forksmith"],"created_by":"Marcus Martins","created_at":"2026-07-13T11:48:35.383705Z"}}
-->
# Forksmith workflow adoption

Make Forksmith the durable authority for this fork's reconciliation, change lineage, validation evidence, and publication. Repository instructions and onboarding material must direct contributors and coding agents to its explicit command boundaries without changing application behavior.
