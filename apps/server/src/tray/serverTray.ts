// @effect-diagnostics nodeBuiltinImport:off
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AuthControlPlaneRuntimeLive } from "../auth/Layers/AuthControlPlane.ts";
import { AuthControlPlane } from "../auth/Services/AuthControlPlane.ts";
import { ServerConfig, type ServerConfigShape } from "../config.ts";

export interface ServerTrayHandle {
  readonly shutdown: Effect.Effect<void>;
}

function normalizeServerHost(host: string | undefined): string {
  if (!host || host === "0.0.0.0" || host === "::") {
    return "127.0.0.1";
  }
  return host;
}

function resolveTrayHostPath(): string | null {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(currentDir, "trayHost.cjs"),
    path.join(process.cwd(), "src", "trayHost.cjs"),
    path.join(process.cwd(), "apps", "server", "src", "trayHost.cjs"),
    path.join(process.cwd(), "dist", "trayHost.cjs"),
    path.join(process.cwd(), "apps", "server", "dist", "trayHost.cjs"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function resolveTrayIconPath(config: ServerConfigShape): string | null {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(config.staticDir ?? "", "favicon-32x32.png"),
    path.join(currentDir, "client", "favicon-32x32.png"),
    path.join(process.cwd(), "apps", "desktop", "resources", "icon.png"),
    path.join(process.cwd(), "..", "desktop", "resources", "icon.png"),
    path.join(config.staticDir ?? "", "favicon.ico"),
    path.join(currentDir, "client", "favicon.ico"),
    path.join(process.cwd(), "apps", "desktop", "resources", "icon.ico"),
    path.join(process.cwd(), "..", "desktop", "resources", "icon.ico"),
  ].filter((candidate) => candidate.length > 0);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function resolveElectronPath(): string | null {
  const electronFallback = [
    process.env.T3CODE_ELECTRON_PATH,
    "/usr/bin/electron",
    process.execPath,
    path.join(process.cwd(), "node_modules", ".bin", "electron"),
    path.join(process.cwd(), "..", "..", "node_modules", ".bin", "electron"),
  ].find((candidate) => Boolean(candidate && existsSync(candidate)));

  try {
    const require = createRequire(import.meta.url);
    const electron = require("electron") as string | { default?: string };
    if (typeof electron === "string") {
      return electron;
    }
    if (typeof electron.default === "string") {
      return electron.default;
    }
  } catch {
    return electronFallback ?? null;
  }
  return electronFallback ?? null;
}

const issueTraySessionToken = Effect.fn("server.tray.issueSessionToken")(function* (
  config: ServerConfigShape,
) {
  return yield* Effect.gen(function* () {
    const authControlPlane = yield* AuthControlPlane;
    const issued = yield* authControlPlane.issueSession({
      role: "owner",
      subject: "tray-server",
      label: "T3 Code tray",
    });
    return issued.token;
  }).pipe(
    Effect.provide(
      Layer.mergeAll(AuthControlPlaneRuntimeLive).pipe(
        Layer.provide(Layer.succeed(ServerConfig, config)),
      ),
    ),
  );
});

export const launchServerTray = Effect.fn("server.tray.launch")(function* (
  config: ServerConfigShape,
) {
  if (process.env.T3CODE_TRAY === "0" || process.env.T3CODE_SERVER_TRAY === "0") {
    return { shutdown: Effect.void };
  }

  const electronPath = resolveElectronPath();
  const trayHostPath = resolveTrayHostPath();
  const iconPath = resolveTrayIconPath(config);
  if (!electronPath || !trayHostPath || !iconPath) {
    yield* Effect.logWarning("server tray disabled; missing Electron runtime or tray assets", {
      hasElectron: electronPath !== null,
      hasTrayHost: trayHostPath !== null,
      hasIcon: iconPath !== null,
    });
    return { shutdown: Effect.void };
  }

  const serverUrl = `http://${normalizeServerHost(config.host)}:${config.port}`;
  const traySessionToken = yield* issueTraySessionToken(config).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("server tray could not issue pairing session token", { cause }).pipe(
        Effect.as(""),
      ),
    ),
  );
  const trayEnv: NodeJS.ProcessEnv = {
    ...process.env,
    T3CODE_TRAY_ICON_PATH: iconPath,
    T3CODE_TRAY_PARENT_PID: String(process.pid),
    T3CODE_TRAY_SESSION_TOKEN: traySessionToken,
    T3CODE_TRAY_SUPERVISOR_PID: process.env.T3CODE_TRAY_SUPERVISOR_PID,
    // @effect-diagnostics-next-line preferSchemaOverJson:off - argv is passed only to the local tray helper process
    T3CODE_TRAY_RESTART_ARGV: JSON.stringify(process.argv.slice(1)),
    T3CODE_TRAY_RESTART_CWD: process.cwd(),
    T3CODE_TRAY_RESTART_EXEC_PATH: process.execPath,
    T3CODE_TRAY_SERVER_URL: serverUrl,
  };
  delete trayEnv.ELECTRON_RUN_AS_NODE;

  const child = yield* Effect.sync(() =>
    spawn(electronPath, [trayHostPath], {
      cwd: process.cwd(),
      detached: false,
      env: trayEnv,
      stdio: ["ignore", "ignore", "pipe"],
    }),
  );

  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[t3-tray] ${chunk.toString()}`);
  });
  child.on("error", (error) => {
    process.stderr.write(`[t3] server tray failed: ${error.message}\n`);
  });
  child.on("exit", (code, signal) => {
    if (code !== 0 && signal !== "SIGTERM") {
      process.stderr.write(
        `[t3] server tray exited: code=${String(code)} signal=${String(signal)}\n`,
      );
    }
  });

  child.unref();
  yield* Effect.logInfo("server tray launched", { serverUrl, trayHostPath, iconPath });

  return {
    shutdown: Effect.sync(() => {
      shutdownTrayChild(child);
    }),
  };
});

function shutdownTrayChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.killed) {
    return;
  }
  child.kill("SIGTERM");
}
