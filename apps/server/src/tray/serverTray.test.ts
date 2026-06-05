import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vitest";

import type { ServerConfigShape } from "../config.ts";
import { launchServerTray } from "./serverTray.ts";

const existsSyncProbe = vi.hoisted(() => ({ calls: 0 }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: (..._args: Parameters<typeof actual.existsSync>) => {
      existsSyncProbe.calls += 1;
      return false;
    },
  };
});

const testConfig = {
  logLevel: "Info",
  traceMinLevel: "Info",
  traceTimingEnabled: true,
  traceBatchWindowMs: 200,
  traceMaxBytes: 10 * 1024 * 1024,
  traceMaxFiles: 10,
  otlpTracesUrl: undefined,
  otlpMetricsUrl: undefined,
  otlpExportIntervalMs: 10_000,
  otlpServiceName: "t3-server",
  mode: "web",
  port: 3773,
  host: "127.0.0.1",
  cwd: "/tmp/t3-server-tray-test",
  baseDir: "/tmp/t3-server-tray-test",
  stateDir: "/tmp/t3-server-tray-test/userdata",
  dbPath: "/tmp/t3-server-tray-test/userdata/state.sqlite",
  keybindingsConfigPath: "/tmp/t3-server-tray-test/userdata/keybindings.json",
  settingsPath: "/tmp/t3-server-tray-test/userdata/settings.json",
  providerStatusCacheDir: "/tmp/t3-server-tray-test/caches",
  worktreesDir: "/tmp/t3-server-tray-test/worktrees",
  attachmentsDir: "/tmp/t3-server-tray-test/userdata/attachments",
  logsDir: "/tmp/t3-server-tray-test/userdata/logs",
  serverLogPath: "/tmp/t3-server-tray-test/userdata/logs/server.log",
  serverTracePath: "/tmp/t3-server-tray-test/userdata/logs/server.trace.ndjson",
  providerLogsDir: "/tmp/t3-server-tray-test/userdata/logs/provider",
  providerEventLogPath: "/tmp/t3-server-tray-test/userdata/logs/provider/events.log",
  terminalLogsDir: "/tmp/t3-server-tray-test/userdata/logs/terminals",
  anonymousIdPath: "/tmp/t3-server-tray-test/userdata/anonymous-id",
  environmentIdPath: "/tmp/t3-server-tray-test/userdata/environment-id",
  serverRuntimeStatePath: "/tmp/t3-server-tray-test/userdata/server-runtime.json",
  secretsDir: "/tmp/t3-server-tray-test/userdata/secrets",
  staticDir: undefined,
  devUrl: undefined,
  noBrowser: true,
  startupPresentation: "headless",
  desktopBootstrapToken: undefined,
  autoBootstrapProjectFromCwd: false,
  logWebSocketEvents: false,
  tailscaleServeEnabled: false,
  tailscaleServePort: 8443,
} satisfies ServerConfigShape;

function withProcessEnvValue<A, E, R>(
  name: string,
  value: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env[name];
      process.env[name] = value;
      return previous;
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = previous;
        }
      }),
  );
}

it.effect("skips launching when running under a tray supervisor", () =>
  withProcessEnvValue(
    "T3CODE_TRAY_SUPERVISOR_PID",
    "123",
    Effect.gen(function* () {
      existsSyncProbe.calls = 0;

      const handle = yield* launchServerTray(testConfig);
      yield* handle.shutdown;

      assert.equal(existsSyncProbe.calls, 0);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
