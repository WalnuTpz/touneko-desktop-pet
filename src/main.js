const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  screen,
} = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const WINDOW_WIDTH = 760;
const WINDOW_HEIGHT = 760;
const EDGE_MARGIN_X = 14;
const EDGE_MARGIN_Y = 10;
const SCALE_OPTIONS = [0.75, 1, 1.25, 1.5];

const runtime = {
  paused: false,
  clickThrough: false,
  scale: 1,
  userHidden: false,
  fullscreenHidden: false,
  pointerOverPet: false,
  currentDisplayId: null,
};

let petWindow = null;
let tray = null;
let quitting = false;
let dragState = null;
let currentLayout = null;
let firstLayout = true;
let pendingBottomRight = true;
let manifest = null;
let fullscreenProcess = null;
let fullscreenOutput = "";
let activeFullscreenDisplayId = null;

function generatedPath(...parts) {
  return path.join(__dirname, "..", "assets", "generated", ...parts);
}

function loadManifest() {
  const manifestPath = generatedPath("manifest.json");
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `无法读取生成素材：${manifestPath}\n请先运行 npm run prepare:assets\n${error.message}`,
    );
  }
}

function displayById(displayId) {
  return screen
    .getAllDisplays()
    .find((display) => String(display.id) === String(displayId));
}

function currentDisplay() {
  return displayById(runtime.currentDisplayId) || screen.getPrimaryDisplay();
}

function sanitizeRect(rect) {
  if (!rect || typeof rect !== "object") return null;
  const result = {
    x: Number(rect.x),
    y: Number(rect.y),
    width: Number(rect.width),
    height: Number(rect.height),
  };
  if (
    !Object.values(result).every(Number.isFinite) ||
    result.width <= 0 ||
    result.height <= 0 ||
    result.width > WINDOW_WIDTH * 2 ||
    result.height > WINDOW_HEIGHT * 2
  ) {
    return null;
  }
  return result;
}

function absoluteCollider(windowBounds = petWindow?.getBounds(), layout = currentLayout) {
  if (!windowBounds || !layout) return null;
  return {
    x: windowBounds.x + layout.x,
    y: windowBounds.y + layout.y,
    width: layout.width,
    height: layout.height,
  };
}

function displayForCollider(collider) {
  if (!collider) return currentDisplay();
  return screen.getDisplayNearestPoint({
    x: Math.round(collider.x + collider.width / 2),
    y: Math.round(collider.y + collider.height / 2),
  });
}

function setCurrentDisplay(display) {
  if (display) runtime.currentDisplayId = display.id;
}

function clampWindowToDisplay(display = currentDisplay()) {
  if (!petWindow || petWindow.isDestroyed() || !currentLayout) return;
  const bounds = petWindow.getBounds();
  const collider = absoluteCollider(bounds);
  const area = display.workArea;
  let dx = 0;
  let dy = 0;

  if (collider.x < area.x) {
    dx = area.x - collider.x;
  } else if (collider.x + collider.width > area.x + area.width) {
    dx = area.x + area.width - collider.x - collider.width;
  }
  if (collider.y < area.y) {
    dy = area.y - collider.y;
  } else if (collider.y + collider.height > area.y + area.height) {
    dy = area.y + area.height - collider.y - collider.height;
  }
  if (dx || dy) {
    petWindow.setPosition(Math.round(bounds.x + dx), Math.round(bounds.y + dy));
  }
  setCurrentDisplay(display);
}

function positionBottomRight(display = currentDisplay()) {
  if (!petWindow || petWindow.isDestroyed() || !currentLayout) return;
  const area = display.workArea;
  const x =
    area.x +
    area.width -
    EDGE_MARGIN_X -
    currentLayout.x -
    currentLayout.width;
  const y =
    area.y +
    area.height -
    EDGE_MARGIN_Y -
    currentLayout.y -
    currentLayout.height;
  petWindow.setPosition(Math.round(x), Math.round(y));
  setCurrentDisplay(display);
}

function sendCommand(command, payload = {}) {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.webContents.send("pet:command", { command, ...payload });
}

function updateMouseIgnoring() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const ignored = runtime.clickThrough || !runtime.pointerOverPet;
  petWindow.setIgnoreMouseEvents(ignored, { forward: true });
}

function showWindowIfAllowed() {
  if (
    !petWindow ||
    petWindow.isDestroyed() ||
    runtime.userHidden ||
    runtime.fullscreenHidden ||
    !currentLayout
  ) {
    return;
  }
  petWindow.showInactive();
  updateMouseIgnoring();
}

function updateMenus() {
  tray?.setContextMenu(createPetMenu({ includeActions: false }));
}

function setPaused(value) {
  runtime.paused = Boolean(value);
  sendCommand("set-paused", { value: runtime.paused });
  updateMenus();
}

function setClickThrough(value) {
  runtime.clickThrough = Boolean(value);
  runtime.pointerOverPet = false;
  sendCommand("set-click-through", { value: runtime.clickThrough });
  updateMouseIgnoring();
  updateMenus();
}

function setScale(value) {
  const scale = Number(value);
  if (!SCALE_OPTIONS.includes(scale)) return;
  runtime.scale = scale;
  sendCommand("set-scale", { value: scale });
  updateMenus();
}

function hideByUser() {
  if (!petWindow || runtime.userHidden) return;
  runtime.userHidden = true;
  runtime.pointerOverPet = false;
  sendCommand("user-hide");
  petWindow.hide();
  updateMenus();
}

function callPetBack() {
  if (!petWindow || !runtime.userHidden) return;
  runtime.userHidden = false;
  pendingBottomRight = true;
  runtime.pointerOverPet = false;
  sendCommand("call-back", {
    paused: runtime.paused,
    clickThrough: runtime.clickThrough,
    scale: runtime.scale,
  });
  updateMenus();
}

function toggleHidden() {
  if (runtime.userHidden) {
    callPetBack();
  } else {
    hideByUser();
  }
}

function quitApplication() {
  quitting = true;
  app.quit();
}

function scaleSubmenu() {
  return SCALE_OPTIONS.map((scale) => ({
    label: `${Math.round(scale * 100)}%`,
    type: "radio",
    checked: runtime.scale === scale,
    click: () => setScale(scale),
  }));
}

function createPetMenu({ includeActions }) {
  const template = [];
  if (includeActions) {
    template.push(
      {
        label: "随机动作",
        click: () => sendCommand("random-action", { interrupt: true }),
      },
      {
        label: "出去走走",
        click: () => sendCommand("random-movement", { interrupt: true }),
      },
      { type: "separator" },
    );
  }
  template.push(
    {
      label: runtime.paused ? "继续活动" : "暂停活动",
      click: () => setPaused(!runtime.paused),
    },
    {
      label: "鼠标穿透",
      type: "checkbox",
      checked: runtime.clickThrough,
      click: (item) => setClickThrough(item.checked),
    },
    {
      label: "调整大小",
      submenu: scaleSubmenu(),
    },
    { type: "separator" },
    {
      label: runtime.userHidden ? "叫糖猫回来" : "藏起来",
      click: toggleHidden,
    },
    {
      label: "退出",
      click: quitApplication,
    },
  );
  return Menu.buildFromTemplate(template);
}

function createTray() {
  let icon = nativeImage.createFromPath(generatedPath("icon-source.png"));
  if (!icon.isEmpty()) {
    icon = icon.resize({ width: 24, height: 24 });
  }
  tray = new Tray(icon);
  tray.setToolTip("糖猫桌宠");
  updateMenus();
}

function updateFullscreenVisibility() {
  const shouldHide =
    activeFullscreenDisplayId !== null &&
    String(activeFullscreenDisplayId) === String(runtime.currentDisplayId);
  if (shouldHide === runtime.fullscreenHidden) return;

  runtime.fullscreenHidden = shouldHide;
  runtime.pointerOverPet = false;
  if (shouldHide) {
    sendCommand("fullscreen-pause");
    petWindow?.hide();
  } else {
    sendCommand("fullscreen-resume");
    showWindowIfAllowed();
  }
}

function parseFullscreenLine(line) {
  if (!line.trim()) return;
  try {
    const state = JSON.parse(line);
    if (!state.fullscreen || Number(state.processId) === process.pid) {
      activeFullscreenDisplayId = null;
    } else {
      const center = {
        x: Math.round((Number(state.left) + Number(state.right)) / 2),
        y: Math.round((Number(state.top) + Number(state.bottom)) / 2),
      };
      activeFullscreenDisplayId = screen.getDisplayNearestPoint(center).id;
    }
    updateFullscreenVisibility();
  } catch {
    // 忽略监测进程退出时可能残留的不完整输出。
  }
}

function fullscreenMonitorPath() {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "scripts",
      "fullscreen-monitor.ps1",
    );
  }
  return path.join(__dirname, "..", "scripts", "fullscreen-monitor.ps1");
}

function startFullscreenMonitor() {
  if (process.platform !== "win32") return;
  const monitorPath = fullscreenMonitorPath();
  if (!fs.existsSync(monitorPath)) return;

  fullscreenProcess = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-WindowStyle",
      "Hidden",
      "-File",
      monitorPath,
      "-ParentProcessId",
      String(process.pid),
    ],
    {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  fullscreenProcess.stdout.setEncoding("utf8");
  fullscreenProcess.stdout.on("data", (chunk) => {
    fullscreenOutput += chunk;
    const lines = fullscreenOutput.split(/\r?\n/);
    fullscreenOutput = lines.pop() || "";
    lines.forEach(parseFullscreenLine);
  });
  fullscreenProcess.on("exit", () => {
    fullscreenProcess = null;
    activeFullscreenDisplayId = null;
    if (!quitting) updateFullscreenVisibility();
  });
}

function stopFullscreenMonitor() {
  if (!fullscreenProcess) return;
  fullscreenProcess.kill();
  fullscreenProcess = null;
}

function moveBy(delta) {
  if (!petWindow || petWindow.isDestroyed() || !currentLayout) {
    return { movedX: 0, movedY: 0, hitX: 0, hitY: 0 };
  }
  const requestedX = Number(delta?.x) || 0;
  const requestedY = Number(delta?.y) || 0;
  const bounds = petWindow.getBounds();
  const collider = absoluteCollider(bounds);
  const area = currentDisplay().workArea;
  const minimumX = area.x;
  const maximumX = area.x + area.width - collider.width;
  const minimumY = area.y;
  const maximumY = area.y + area.height - collider.height;
  const desiredX = collider.x + requestedX;
  const desiredY = collider.y + requestedY;
  const nextColliderX = Math.min(Math.max(desiredX, minimumX), maximumX);
  const nextColliderY = Math.min(Math.max(desiredY, minimumY), maximumY);
  const movedX = nextColliderX - collider.x;
  const movedY = nextColliderY - collider.y;

  petWindow.setPosition(
    Math.round(bounds.x + movedX),
    Math.round(bounds.y + movedY),
  );
  return {
    movedX,
    movedY,
    hitX:
      Math.abs(movedX - requestedX) < 0.01 ? 0 : requestedX < 0 ? -1 : 1,
    hitY:
      Math.abs(movedY - requestedY) < 0.01 ? 0 : requestedY < 0 ? -1 : 1,
  };
}

function registerIpc() {
  ipcMain.handle("pet:get-bootstrap", () => ({
    manifest,
    runtime: {
      paused: runtime.paused,
      clickThrough: runtime.clickThrough,
      scale: runtime.scale,
    },
    window: {
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    },
  }));

  ipcMain.on("pet:renderer-ready", () => {
    if (app.commandLine.hasSwitch("smoke-test")) {
      setTimeout(quitApplication, 1200);
    }
  });

  ipcMain.on("pet:update-layout", (_event, rect) => {
    const nextLayout = sanitizeRect(rect);
    if (!nextLayout || !petWindow || petWindow.isDestroyed()) return;
    currentLayout = nextLayout;
    if (firstLayout || pendingBottomRight) {
      firstLayout = false;
      pendingBottomRight = false;
      positionBottomRight(currentDisplay());
    } else {
      clampWindowToDisplay(currentDisplay());
    }
    updateFullscreenVisibility();
    showWindowIfAllowed();
  });

  ipcMain.on("pet:set-pointer-region", (_event, overPet) => {
    runtime.pointerOverPet = Boolean(overPet);
    updateMouseIgnoring();
  });

  ipcMain.on("pet:drag-start", (_event, point) => {
    if (!petWindow || runtime.clickThrough || !currentLayout) return;
    const bounds = petWindow.getBounds();
    dragState = {
      cursorX: Number(point.screenX),
      cursorY: Number(point.screenY),
      windowX: bounds.x,
      windowY: bounds.y,
      touchingLeft: false,
      touchingRight: false,
    };
  });

  ipcMain.handle("pet:drag-move", (_event, point) => {
    if (!petWindow || !dragState || runtime.clickThrough || !currentLayout) {
      return { flipHorizontal: false };
    }
    const desiredWindowX =
      dragState.windowX + Number(point.screenX) - dragState.cursorX;
    const desiredWindowY =
      dragState.windowY + Number(point.screenY) - dragState.cursorY;
    const display = screen.getDisplayNearestPoint({
      x: Math.round(Number(point.screenX)),
      y: Math.round(Number(point.screenY)),
    });
    const area = display.workArea;
    const desiredCollider = {
      x: desiredWindowX + currentLayout.x,
      y: desiredWindowY + currentLayout.y,
      width: currentLayout.width,
      height: currentLayout.height,
    };
    const touchingLeft = desiredCollider.x <= area.x;
    const touchingRight =
      desiredCollider.x + desiredCollider.width >= area.x + area.width;
    const colliderX = Math.min(
      Math.max(desiredCollider.x, area.x),
      area.x + area.width - desiredCollider.width,
    );
    const colliderY = Math.min(
      Math.max(desiredCollider.y, area.y),
      area.y + area.height - desiredCollider.height,
    );
    petWindow.setPosition(
      Math.round(colliderX - currentLayout.x),
      Math.round(colliderY - currentLayout.y),
    );
    setCurrentDisplay(display);
    updateFullscreenVisibility();

    const flipHorizontal =
      (touchingLeft && !dragState.touchingLeft) ||
      (touchingRight && !dragState.touchingRight);
    dragState.touchingLeft = touchingLeft;
    dragState.touchingRight = touchingRight;
    return { flipHorizontal };
  });

  ipcMain.on("pet:drag-end", () => {
    dragState = null;
  });

  ipcMain.handle("pet:move-by", (_event, delta) => moveBy(delta));

  ipcMain.on("pet:open-menu", () => {
    if (!petWindow || runtime.clickThrough) return;
    createPetMenu({ includeActions: true }).popup({ window: petWindow });
  });
}

function createWindow() {
  petWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: -WINDOW_WIDTH,
    y: -WINDOW_HEIGHT,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  runtime.currentDisplayId = screen.getPrimaryDisplay().id;
  petWindow.setMenu(null);
  petWindow.setAlwaysOnTop(true, "floating");
  petWindow.setIgnoreMouseEvents(true, { forward: true });
  petWindow.loadFile(path.join(__dirname, "index.html"));
  petWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  petWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  petWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    hideByUser();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // 严格单实例：重复启动静默退出，不影响已有实例。
  });
  app.whenReady().then(() => {
    loadManifest();
    registerIpc();
    createWindow();
    createTray();
    startFullscreenMonitor();
  });
}

app.on("before-quit", () => {
  quitting = true;
  stopFullscreenMonitor();
});

app.on("window-all-closed", () => {
  // 桌宠由托盘菜单控制生命周期，只有“退出”会结束进程。
});
