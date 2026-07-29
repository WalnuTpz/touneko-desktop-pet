const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  screen,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const BASE_WIDTH = 280;
const BASE_HEIGHT = 320;
const DEFAULT_SETTINGS = {
  alwaysOnTop: true,
  autoWander: true,
  clickThrough: false,
  scale: 1,
  position: null,
};

let petWindow = null;
let tray = null;
let quitting = false;
let dragState = null;
let saveTimer = null;
let settings = { ...DEFAULT_SETTINGS };

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    settings = { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
  } catch (error) {
    console.error("保存桌宠设置失败：", error);
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 350);
}

function scaledWindowSize(scale = settings.scale) {
  return {
    width: Math.round(BASE_WIDTH * scale),
    height: Math.round(BASE_HEIGHT * scale),
  };
}

function clampPosition(x, y, width, height) {
  const point = {
    x: Math.round(x + width / 2),
    y: Math.round(y + height / 2),
  };
  const { workArea } = screen.getDisplayNearestPoint(point);
  return {
    x: Math.min(Math.max(Math.round(x), workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(Math.round(y), workArea.y), workArea.y + workArea.height - height),
  };
}

function rememberPosition() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const [x, y] = petWindow.getPosition();
  settings.position = { x, y };
  scheduleSave();
}

function initialPosition(width, height) {
  if (settings.position && Number.isFinite(settings.position.x) && Number.isFinite(settings.position.y)) {
    return clampPosition(settings.position.x, settings.position.y, width, height);
  }

  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - width - 28,
    y: workArea.y + workArea.height - height - 16,
  };
}

function sendCommand(command, payload = {}) {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.webContents.send("pet:command", { command, ...payload });
}

function showPet() {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.showInactive();
}

function setAlwaysOnTop(value) {
  settings.alwaysOnTop = Boolean(value);
  petWindow?.setAlwaysOnTop(settings.alwaysOnTop, "floating");
  scheduleSave();
  rebuildTrayMenu();
}

function setClickThrough(value) {
  settings.clickThrough = Boolean(value);
  petWindow?.setIgnoreMouseEvents(settings.clickThrough, { forward: true });
  scheduleSave();
  rebuildTrayMenu();
}

function setAutoWander(value) {
  settings.autoWander = Boolean(value);
  sendCommand("set-auto-wander", { value: settings.autoWander });
  scheduleSave();
  rebuildTrayMenu();
}

function setScale(scale) {
  if (!petWindow || petWindow.isDestroyed()) return;

  const nextScale = Number(scale);
  const oldBounds = petWindow.getBounds();
  const nextSize = scaledWindowSize(nextScale);
  const nextPosition = clampPosition(
    oldBounds.x + (oldBounds.width - nextSize.width) / 2,
    oldBounds.y + oldBounds.height - nextSize.height,
    nextSize.width,
    nextSize.height,
  );

  settings.scale = nextScale;
  petWindow.setBounds({ ...nextPosition, ...nextSize });
  rememberPosition();
  rebuildTrayMenu();
}

function createPetMenu() {
  const visible = Boolean(petWindow?.isVisible());
  return Menu.buildFromTemplate([
    {
      label: visible ? "藏起来" : "叫糖猫回来",
      click: () => {
        if (!petWindow) return;
        visible ? petWindow.hide() : showPet();
        rebuildTrayMenu();
      },
    },
    { type: "separator" },
    {
      label: "摸摸它",
      click: () => {
        showPet();
        sendCommand("pet");
      },
    },
    {
      label: "随机动作",
      click: () => {
        showPet();
        sendCommand("random-action");
      },
    },
    {
      label: "出去走走",
      click: () => {
        showPet();
        sendCommand("walk");
      },
    },
    { type: "separator" },
    {
      label: "自动散步",
      type: "checkbox",
      checked: settings.autoWander,
      click: (item) => setAutoWander(item.checked),
    },
    {
      label: "始终置顶",
      type: "checkbox",
      checked: settings.alwaysOnTop,
      click: (item) => setAlwaysOnTop(item.checked),
    },
    {
      label: "鼠标穿透",
      type: "checkbox",
      checked: settings.clickThrough,
      sublabel: "开启后请从系统托盘恢复操作",
      click: (item) => setClickThrough(item.checked),
    },
    {
      label: "大小",
      submenu: [
        { label: "80%", type: "radio", checked: settings.scale === 0.8, click: () => setScale(0.8) },
        { label: "100%", type: "radio", checked: settings.scale === 1, click: () => setScale(1) },
        { label: "125%", type: "radio", checked: settings.scale === 1.25, click: () => setScale(1.25) },
        { label: "150%", type: "radio", checked: settings.scale === 1.5, click: () => setScale(1.5) },
      ],
    },
    { type: "separator" },
    {
      label: "退出糖猫桌宠",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
}

function rebuildTrayMenu() {
  tray?.setContextMenu(createPetMenu());
}

function createTray() {
  const iconPath = path.join(__dirname, "..", "糖猫合集", "站.png");
  let icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) icon = icon.resize({ width: 24, height: 24 });

  tray = new Tray(icon);
  tray.setToolTip("糖猫桌宠");
  rebuildTrayMenu();
  tray.on("double-click", () => {
    setClickThrough(false);
    showPet();
  });
}

function createWindow() {
  const size = scaledWindowSize();
  const position = initialPosition(size.width, size.height);

  petWindow = new BrowserWindow({
    ...size,
    ...position,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: settings.alwaysOnTop,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  petWindow.setMenu(null);
  petWindow.setAlwaysOnTop(settings.alwaysOnTop, "floating");
  petWindow.setIgnoreMouseEvents(settings.clickThrough, { forward: true });
  petWindow.loadFile(path.join(__dirname, "index.html"));

  petWindow.once("ready-to-show", () => {
    showPet();
    sendCommand("set-auto-wander", { value: settings.autoWander });
  });

  petWindow.on("move", rememberPosition);
  petWindow.on("show", rebuildTrayMenu);
  petWindow.on("hide", rebuildTrayMenu);
  petWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    petWindow.hide();
  });

  petWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  petWindow.webContents.on("will-navigate", (event) => event.preventDefault());
}

function registerIpc() {
  ipcMain.handle("pet:get-settings", () => ({ ...settings }));

  ipcMain.on("pet:drag-start", (_event, point) => {
    if (!petWindow || settings.clickThrough) return;
    const [x, y] = petWindow.getPosition();
    dragState = {
      cursorX: Number(point.screenX),
      cursorY: Number(point.screenY),
      windowX: x,
      windowY: y,
    };
  });

  ipcMain.on("pet:drag-move", (_event, point) => {
    if (!petWindow || !dragState || settings.clickThrough) return;
    const [width, height] = petWindow.getSize();
    const next = clampPosition(
      dragState.windowX + Number(point.screenX) - dragState.cursorX,
      dragState.windowY + Number(point.screenY) - dragState.cursorY,
      width,
      height,
    );
    petWindow.setPosition(next.x, next.y);
  });

  ipcMain.on("pet:drag-end", () => {
    dragState = null;
    rememberPosition();
  });

  ipcMain.handle("pet:move-by", (_event, delta) => {
    if (!petWindow || petWindow.isDestroyed()) return { movedX: 0, movedY: 0 };
    const bounds = petWindow.getBounds();
    const next = clampPosition(
      bounds.x + Number(delta.x || 0),
      bounds.y + Number(delta.y || 0),
      bounds.width,
      bounds.height,
    );
    petWindow.setPosition(next.x, next.y);
    return {
      movedX: next.x - bounds.x,
      movedY: next.y - bounds.y,
    };
  });

  ipcMain.on("pet:open-menu", () => {
    createPetMenu().popup({ window: petWindow });
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", showPet);
  app.whenReady().then(() => {
    loadSettings();
    registerIpc();
    createWindow();
    createTray();
  });
}

app.on("before-quit", () => {
  quitting = true;
  clearTimeout(saveTimer);
  saveSettings();
});

app.on("window-all-closed", () => {
  // 桌宠常驻系统托盘，只有菜单中的“退出”才会结束进程。
});
