const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { platform } = require("node:os");
const { app, BrowserWindow, Menu, Tray, nativeImage, shell } = require("electron");

const parentPid = Number.parseInt(process.env.T3CODE_TRAY_PARENT_PID ?? "", 10);
const supervisorPid = Number.parseInt(process.env.T3CODE_TRAY_SUPERVISOR_PID ?? "", 10);
const serverUrl = process.env.T3CODE_TRAY_SERVER_URL ?? "";
const traySessionToken = process.env.T3CODE_TRAY_SESSION_TOKEN ?? "";
const iconPath = process.env.T3CODE_TRAY_ICON_PATH ?? "";
const restartExecPath = process.env.T3CODE_TRAY_RESTART_EXEC_PATH ?? "";
const restartCwd = process.env.T3CODE_TRAY_RESTART_CWD ?? process.cwd();
const hostPlatform = platform();

let tray = null;
let contextMenu = null;
let smokeWindow = null;

function isParentAlive() {
  return isPidAlive(parentPid);
}

function isSupervisorAlive() {
  return isPidAlive(supervisorPid);
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function shutdownServer() {
  if (isSupervisorAlive()) {
    process.kill(supervisorPid, "SIGTERM");
  }
  if (isParentAlive()) {
    process.kill(parentPid, "SIGTERM");
  }
  app.quit();
}

function restartServer() {
  if (isSupervisorAlive()) {
    if (isParentAlive()) {
      process.kill(parentPid, "SIGTERM");
    }
    app.quit();
    return;
  }

  let args = [];
  try {
    args = JSON.parse(process.env.T3CODE_TRAY_RESTART_ARGV ?? "[]");
  } catch {
    args = [];
  }

  if (restartExecPath.length > 0) {
    const child = spawn(restartExecPath, args, {
      cwd: restartCwd,
      detached: true,
      env: process.env,
      stdio: "ignore",
    });
    child.unref();
  }

  shutdownServer();
}

function buildServerUrl() {
  return serverUrl;
}

async function buildPairingUrl() {
  if (serverUrl.length === 0) {
    return "";
  }

  if (traySessionToken.length === 0 || typeof fetch !== "function") {
    return serverUrl;
  }

  const endpoint = new URL("/api/auth/pairing-token", serverUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${traySessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      label: "Tray web app",
      scopes: [
        "orchestration:read",
        "orchestration:operate",
        "terminal:operate",
        "review:write",
        "access:read",
        "access:write",
        "relay:write",
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Pairing token request failed: ${response.status}`);
  }

  const body = await response.json();
  const credential = typeof body.credential === "string" ? body.credential : "";
  if (credential.length === 0) {
    throw new Error("Pairing token response did not include a credential.");
  }

  const url = new URL("/pair", serverUrl);
  url.hash = new URLSearchParams([["token", credential]]).toString();
  return url.toString();
}

async function openWebApp() {
  try {
    const url = await buildPairingUrl();
    if (url.length > 0) {
      void shell.openExternal(url);
    }
  } catch (error) {
    console.error(
      `Could not create pairing link: ${error instanceof Error ? error.message : error}`,
    );
    const fallbackUrl = buildServerUrl();
    if (fallbackUrl.length > 0) {
      void shell.openExternal(fallbackUrl);
    }
  }
}

function openDesktopApp() {
  if (!isSupervisorAlive()) {
    openWebApp();
    return;
  }

  try {
    process.kill(supervisorPid, "SIGUSR2");
  } catch (error) {
    console.error(`Could not open desktop app: ${error instanceof Error ? error.message : error}`);
  }
}

function buildMenu() {
  const template = [];
  if (isSupervisorAlive()) {
    template.push({ label: "Open Desktop App", click: openDesktopApp });
  }
  template.push(
    { label: "Open Web App", click: openWebApp },
    { type: "separator" },
    { label: "Restart server", click: restartServer },
    { label: "Shutdown server", click: shutdownServer },
  );
  return Menu.buildFromTemplate(template);
}

app.setName("T3 Code Server");
app.commandLine.appendSwitch("enable-features", "StatusNotifierWatcher");

function createTrayImage() {
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    console.error(`Tray icon could not be loaded: ${iconPath}`);
    return iconPath;
  }

  if (hostPlatform === "linux") {
    return image.resize({ width: 22, height: 22 });
  }

  return image;
}

function openContextMenu() {
  if (tray && contextMenu) {
    tray.popUpContextMenu(contextMenu);
  }
}

app.whenReady().then(() => {
  if (!existsSync(iconPath)) {
    console.error(`Tray icon not found: ${iconPath}`);
    app.quit();
    return;
  }

  contextMenu = buildMenu();
  tray = new Tray(createTrayImage());
  tray.setToolTip("T3 Code Server");
  tray.setContextMenu(contextMenu);
  tray.on("click", openContextMenu);
  tray.on("right-click", openContextMenu);
  tray.on("double-click", () => {
    if (isSupervisorAlive()) {
      openDesktopApp();
      return;
    }
    openWebApp();
  });
  if (hostPlatform === "linux") {
    tray.setTitle("T3");
  }

  // Exercise the actual native menu in visual automation without invoking an
  // item or changing the production interaction path. Anchoring the popup to a
  // real window makes the status-only process observable to accessibility
  // tools that cannot attach directly to a menu-bar extra.
  if (process.env.T3CODE_TRAY_VISUAL_SMOKE === "1") {
    smokeWindow = new BrowserWindow({
      width: 420,
      height: 240,
      title: "T3 Code Server Tray Smoke",
      webPreferences: { sandbox: true },
    });
    const smokeDocument = encodeURIComponent(`<!doctype html>
      <meta charset="utf-8">
      <title>T3 Code Server Tray Smoke</title>
      <style>
        :root { color-scheme: light dark; font: 16px system-ui; }
        body { margin: 32px; }
      </style>
      <h1>T3 Code Server</h1>
      <p>Native tray menu visual smoke.</p>`);
    void smokeWindow.loadURL(`data:text/html;charset=utf-8,${smokeDocument}`).then(() => {
      contextMenu?.popup({ window: smokeWindow });
    });
  }

  const timer = setInterval(() => {
    if (!isParentAlive()) {
      clearInterval(timer);
      app.quit();
    }
  }, 2_000);
  timer.unref?.();
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});

app.on("before-quit", () => {
  tray?.destroy();
  tray = null;
  smokeWindow = null;
});
