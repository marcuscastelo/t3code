const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { app, Menu, Tray, nativeImage, shell } = require("electron");

const parentPid = Number.parseInt(process.env.T3CODE_TRAY_PARENT_PID ?? "", 10);
const supervisorPid = Number.parseInt(process.env.T3CODE_TRAY_SUPERVISOR_PID ?? "", 10);
const serverUrl = process.env.T3CODE_TRAY_SERVER_URL ?? "";
const pairingToken = process.env.T3CODE_TRAY_PAIRING_TOKEN ?? "";
const iconPath = process.env.T3CODE_TRAY_ICON_PATH ?? "";
const restartExecPath = process.env.T3CODE_TRAY_RESTART_EXEC_PATH ?? "";
const restartCwd = process.env.T3CODE_TRAY_RESTART_CWD ?? process.cwd();

let tray = null;
let contextMenu = null;

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
  if (serverUrl.length === 0) {
    return "";
  }
  if (pairingToken.length === 0) {
    return serverUrl;
  }

  const url = new URL("/pair", serverUrl);
  url.hash = new URLSearchParams([["token", pairingToken]]).toString();
  return url.toString();
}

function openWebApp() {
  const url = buildServerUrl();
  if (url.length > 0) {
    void shell.openExternal(url);
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

  if (process.platform === "linux") {
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
  if (process.platform === "linux") {
    tray.setTitle("T3");
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
});
