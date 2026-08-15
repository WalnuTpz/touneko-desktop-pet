const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  powerMonitor,
  protocol,
  screen,
  session,
} = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { StableValueTracker } = require("./core");
const {
  normalizeResourcePath,
  openEncryptedPack,
} = require("./secure-resources");

const WINDOW_WIDTH = 960;
const WINDOW_HEIGHT = 900;
const EDGE_MARGIN_X = 14;
const EDGE_MARGIN_Y = 10;
const SCALE_OPTIONS = [0.75, 1, 1.25, 1.5];
const RESOURCE_SCHEME = "tangmao-resource";
const RESOURCE_HOST = "app";
const RESOURCE_KEY_SYMBOL = Symbol.for("tangmao.resource-key");
const FULLSCREEN_HASH_SYMBOL = Symbol.for("tangmao.fullscreen-monitor-hash");
const PET_SESSION_PARTITION = "tangmao-memory";
const SETTINGS_FILENAME = "settings.json";
const PERSONALITY_VALUES = ["quiet", "default", "active"];
const DEFAULT_SETTINGS = Object.freeze({
  personality: "default",
  environmentAwareness: true,
});
const ENVIRONMENT_SAMPLE_INTERVAL_MS = 1000;
const ACTIVE_IDLE_SECONDS = 2;
const IDLE_THRESHOLD_SECONDS = 600;
const ACTIVITY_SAMPLE_COUNT = 10;
const HIGH_ACTIVITY_SAMPLE_COUNT = 8;
const WORK_BIAS_RETENTION_MS = 30_000;
const PLAY_DURATION_MS = 90_000;

protocol.registerSchemesAsPrivileged([
  {
    scheme: RESOURCE_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
    },
  },
]);

const runtime = {
  paused: false,
  clickThrough: false,
  scale: 1,
  playing: false,
  personality: DEFAULT_SETTINGS.personality,
  environmentAwareness: DEFAULT_SETTINGS.environmentAwareness,
  environment: {
    night: false,
    idle: false,
    highActivity: false,
    workBias: false,
  },
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
let currentShapeRegions = [];
let firstLayout = true;
let pendingBottomRight = true;
let manifest = null;
let fullscreenProcess = null;
let fullscreenRestartTimer = null;
let fullscreenOutput = "";
let activeFullscreenDisplayIds = new Set();
let fullscreenSamples = 0;
let protectedResources = null;
let petSession = null;
let fullscreenMonitorExpectedHash = null;
let smokeReadyTimer = null;
let environmentSampleTimer = null;
let workBiasUntil = 0;
const activitySamples = [];
const fullscreenStability = new StableValueTracker("");

function generatedPath(...parts) {
  return path.join(__dirname, "..", "assets", "generated", ...parts);
}

function persistentSettingsPath() {
  return path.join(app.getPath("userData"), SETTINGS_FILENAME);
}

function isValidPersistentSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value).sort();
  return (
    keys.length === 2 &&
    keys[0] === "environmentAwareness" &&
    keys[1] === "personality" &&
    PERSONALITY_VALUES.includes(value.personality) &&
    typeof value.environmentAwareness === "boolean"
  );
}

function savePersistentSettings() {
  const outputPath = persistentSettingsPath();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        personality: runtime.personality,
        environmentAwareness: runtime.environmentAwareness,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function loadPersistentSettings() {
  const inputPath = persistentSettingsPath();
  let settings;

  if (fs.existsSync(inputPath)) {
    const source = fs.readFileSync(inputPath, "utf8");
    try {
      settings = JSON.parse(source);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      console.warn("糖猫桌宠设置文件已损坏，已恢复默认设置");
    }
    if (settings !== undefined && !isValidPersistentSettings(settings)) {
      console.warn("糖猫桌宠设置内容无效，已恢复默认设置");
      settings = undefined;
    }
  }

  const resolved = settings || DEFAULT_SETTINGS;
  runtime.personality = resolved.personality;
  runtime.environmentAwareness = resolved.environmentAwareness;
  if (settings === undefined) savePersistentSettings();
}

function environmentSnapshot() {
  return { ...runtime.environment };
}

function sameEnvironment(left, right) {
  return (
    left.night === right.night &&
    left.idle === right.idle &&
    left.highActivity === right.highActivity &&
    left.workBias === right.workBias
  );
}

function publishEnvironmentState() {
  sendCommand("environment-state", {
    environment: environmentSnapshot(),
  });
}

function sampleEnvironment() {
  const now = Date.now();
  const idleSeconds = powerMonitor.getSystemIdleTime();
  activitySamples.push(idleSeconds <= ACTIVE_IDLE_SECONDS);
  if (activitySamples.length > ACTIVITY_SAMPLE_COUNT) {
    activitySamples.shift();
  }

  const activeCount = activitySamples.filter(Boolean).length;
  const highActivity = activeCount >= HIGH_ACTIVITY_SAMPLE_COUNT;
  if (runtime.environment.highActivity && !highActivity) {
    workBiasUntil = now + WORK_BIAS_RETENTION_MS;
  } else if (highActivity) {
    workBiasUntil = 0;
  }

  const hour = new Date(now).getHours();
  const nextEnvironment = {
    night: hour >= 21 || hour < 8,
    idle: idleSeconds >= IDLE_THRESHOLD_SECONDS,
    highActivity,
    workBias: highActivity || now < workBiasUntil,
  };
  if (sameEnvironment(runtime.environment, nextEnvironment)) return;
  runtime.environment = nextEnvironment;
  publishEnvironmentState();
}

function startEnvironmentMonitor() {
  sampleEnvironment();
  environmentSampleTimer = setInterval(
    sampleEnvironment,
    ENVIRONMENT_SAMPLE_INTERVAL_MS,
  );
}

function stopEnvironmentMonitor() {
  clearInterval(environmentSampleTimer);
  environmentSampleTimer = null;
}

function loadManifest() {
  if (app.isPackaged) {
    const embeddedKey = globalThis[RESOURCE_KEY_SYMBOL];
    if (!embeddedKey) {
      throw new Error("正式版本缺少加密资源密钥");
    }
    const key = Buffer.from(embeddedKey);
    try {
      const packPath = path.join(
        __dirname,
        "..",
        "assets",
        "runtime.tpack",
      );
      protectedResources = openEncryptedPack(fs.readFileSync(packPath), key);
      manifest = JSON.parse(
        protectedResources
          .read("app/assets/manifest.json")
          .toString("utf8"),
      );
    } catch (error) {
      throw new Error(`无法验证或解密正式版资源：${error.message}`);
    } finally {
      key.fill(0);
      if (Buffer.isBuffer(embeddedKey)) embeddedKey.fill(0);
      delete globalThis[RESOURCE_KEY_SYMBOL];
    }
    return;
  }

  const manifestPath = generatedPath("manifest.json");
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `无法读取生成素材：${manifestPath}\n请先运行 npm run prepare:assets\n${error.message}`,
    );
  }
}

function readGeneratedResource(relativePath) {
  const normalizedPath = normalizeResourcePath(relativePath);
  if (protectedResources) {
    return protectedResources.read(`app/assets/${normalizedPath}`);
  }
  return fs.readFileSync(generatedPath(...normalizedPath.split("/")));
}

function resourceContentType(resourcePath) {
  const extension = path.extname(resourcePath).toLowerCase();
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
    }[extension] || "application/octet-stream"
  );
}

function registerProtectedResourceProtocol() {
  petSession = session.fromPartition(PET_SESSION_PARTITION, { cache: true });
  if (!protectedResources) return;
  petSession.protocol.handle(RESOURCE_SCHEME, (request) => {
    try {
      const url = new URL(request.url);
      if (
        request.method !== "GET" ||
        url.hostname !== RESOURCE_HOST ||
        url.username ||
        url.password ||
        url.port ||
        url.search ||
        url.hash
      ) {
        return new Response("Not found", { status: 404 });
      }
      const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const resourcePath = normalizeResourcePath(
        `${RESOURCE_HOST}/${pathname}`,
      );
      const data = protectedResources.read(resourcePath);
      const immutable = /\.(?:css|js|png)$/i.test(resourcePath);
      return new Response(data, {
        headers: {
          "Cache-Control": immutable
            ? "public, max-age=31536000, immutable"
            : "no-store",
          "Content-Type": resourceContentType(resourcePath),
          "Cross-Origin-Resource-Policy": "same-origin",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
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

function failApplicationStartup(error) {
  console.error("糖猫桌宠启动失败：", error);
  quitting = true;
  clearTimeout(smokeReadyTimer);
  smokeReadyTimer = null;
  stopEnvironmentMonitor();
  stopFullscreenMonitor();
  app.exit(1);
}

function updateMouseIgnoring() {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.setIgnoreMouseEvents(runtime.clickThrough, { forward: true });
}

function updateWindowShape() {
  if (
    !petWindow ||
    petWindow.isDestroyed() ||
    !currentLayout ||
    typeof petWindow.setShape !== "function"
  ) {
    return;
  }
  const regions =
    currentShapeRegions.length > 0 ? currentShapeRegions : [currentLayout];
  petWindow.setShape(
    regions.map((region) => ({
      x: Math.floor(region.x),
      y: Math.floor(region.y),
      width: Math.max(1, Math.ceil(region.width)),
      height: Math.max(1, Math.ceil(region.height)),
    })),
  );
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
  tray?.setContextMenu(createTrayMenu());
}

function setPaused(value) {
  runtime.paused = Boolean(value);
  sendCommand("set-paused", { value: runtime.paused });
  updateMenus();
}

function setClickThrough(value) {
  runtime.clickThrough = Boolean(value);
  if (runtime.clickThrough) dragState = null;
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

function setPersonality(value) {
  if (!PERSONALITY_VALUES.includes(value)) {
    throw new TypeError(`未知性格：${value}`);
  }
  if (runtime.personality === value) return;
  runtime.personality = value;
  savePersistentSettings();
  sendCommand("set-personality", { value });
  updateMenus();
}

function setEnvironmentAwareness(value) {
  const enabled = Boolean(value);
  if (runtime.environmentAwareness === enabled) return;
  runtime.environmentAwareness = enabled;
  savePersistentSettings();
  sendCommand("set-environment-awareness", { value: enabled });
  publishEnvironmentState();
  updateMenus();
}

function requestPlaying(value) {
  const playing = Boolean(value);
  if (playing && runtime.fullscreenHidden) return;
  sendCommand("set-playing", { value: playing });
}

function hideByUser() {
  if (!petWindow || runtime.userHidden) return;
  dragState = null;
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

function playMenuItem() {
  return {
    label: runtime.playing ? "停止玩耍" : "和糖猫玩耍",
    enabled: runtime.playing || !runtime.fullscreenHidden,
    click: () => requestPlaying(!runtime.playing),
  };
}

function personalitySubmenu() {
  return [
    { label: "安静", value: "quiet" },
    { label: "默认", value: "default" },
    { label: "活泼", value: "active" },
  ].map(({ label, value }) => ({
    label,
    type: "radio",
    checked: runtime.personality === value,
    click: () => setPersonality(value),
  }));
}

function createPetMenu() {
  return Menu.buildFromTemplate([
    {
      label: "随机动作",
      click: () => sendCommand("random-action", { interrupt: true }),
    },
    {
      label: "出去走走",
      click: () => sendCommand("random-movement", { interrupt: true }),
    },
    playMenuItem(),
    { type: "separator" },
    {
      label: runtime.paused ? "继续活动" : "暂停活动",
      click: () => setPaused(!runtime.paused),
    },
    {
      label: "调整大小",
      submenu: scaleSubmenu(),
    },
    { type: "separator" },
    {
      label: "藏起来",
      click: hideByUser,
    },
    {
      label: "退出",
      click: quitApplication,
    },
  ]);
}

function createTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: runtime.paused ? "继续活动" : "暂停活动",
      click: () => setPaused(!runtime.paused),
    },
    {
      label: "环境感知",
      type: "checkbox",
      checked: runtime.environmentAwareness,
      click: (item) => setEnvironmentAwareness(item.checked),
    },
    {
      label: "鼠标穿透",
      type: "checkbox",
      checked: runtime.clickThrough,
      click: (item) => setClickThrough(item.checked),
    },
    {
      label: "性格",
      submenu: personalitySubmenu(),
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
  ]);
}

function createTray() {
  const icon = nativeImage.createEmpty();
  for (const representation of manifest.icons.trayRepresentations) {
    const buffer = readGeneratedResource(representation.file);
    icon.addRepresentation({
      scaleFactor: representation.scaleFactor,
      buffer,
    });
  }
  tray = new Tray(icon);
  tray.setToolTip("糖猫桌宠");
  updateMenus();
}

function updateFullscreenVisibility() {
  if (app.commandLine.hasSwitch("smoke-test")) return;
  const shouldHide = activeFullscreenDisplayIds.has(
    String(runtime.currentDisplayId),
  );
  if (shouldHide === runtime.fullscreenHidden) return;

  runtime.fullscreenHidden = shouldHide;
  runtime.pointerOverPet = false;
  if (shouldHide) {
    dragState = null;
    sendCommand("fullscreen-pause");
    petWindow?.hide();
  } else {
    sendCommand("fullscreen-resume");
    showWindowIfAllowed();
  }
  updateMenus();
}

function parseFullscreenLine(line) {
  if (!line.trim()) return;
  try {
    const fullscreenState = JSON.parse(line);
    fullscreenSamples += 1;
    if (fullscreenState.eligible === false) {
      return;
    }
    const fullscreenWindows = Array.isArray(fullscreenState.fullscreenWindows)
      ? fullscreenState.fullscreenWindows
      : fullscreenState.fullscreen
        ? [fullscreenState]
        : [];
    const candidateDisplayIds = new Set();
    for (const windowState of fullscreenWindows) {
      if (Number(windowState.processId) === process.pid) continue;
      const coordinates = [
        Number(windowState.left),
        Number(windowState.top),
        Number(windowState.right),
        Number(windowState.bottom),
      ];
      if (!coordinates.every(Number.isFinite)) continue;
      const center = {
        x: Math.round((coordinates[0] + coordinates[2]) / 2),
        y: Math.round((coordinates[1] + coordinates[3]) / 2),
      };
      candidateDisplayIds.add(
        String(screen.getDisplayNearestPoint(center).id),
      );
    }
    const candidateKey = [...candidateDisplayIds].sort().join(",");
    const stable = fullscreenStability.sample(
      candidateKey,
      candidateKey === "" ? 2 : 3,
    );
    if (stable.changed) {
      activeFullscreenDisplayIds = new Set(
        stable.value ? String(stable.value).split(",") : [],
      );
      updateFullscreenVisibility();
    }
  } catch {
    // 忽略监测进程退出时可能残留的不完整输出。
  }
}

function fullscreenMonitorPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "fullscreen-monitor.ps1");
  }
  return path.join(__dirname, "..", "scripts", "fullscreen-monitor.ps1");
}

function verifyFullscreenMonitorIntegrity() {
  if (!app.isPackaged) return;
  if (!fullscreenMonitorExpectedHash) {
    fullscreenMonitorExpectedHash = String(
      globalThis[FULLSCREEN_HASH_SYMBOL] || "",
    ).toLowerCase();
    delete globalThis[FULLSCREEN_HASH_SYMBOL];
  }
  const expected = fullscreenMonitorExpectedHash;
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error("正式版本缺少全屏监测脚本校验值");
  }
  const monitorPath = fullscreenMonitorPath();
  const actual = crypto
    .createHash("sha256")
    .update(fs.readFileSync(monitorPath))
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  if (!crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    throw new Error("全屏监测脚本完整性校验失败");
  }
}

function startFullscreenMonitor() {
  if (process.platform !== "win32" || fullscreenProcess || quitting) return;
  clearTimeout(fullscreenRestartTimer);
  fullscreenRestartTimer = null;
  try {
    verifyFullscreenMonitorIntegrity();
  } catch (error) {
    console.error("拒绝启动全屏监测：", error);
    return;
  }
  const monitorPath = fullscreenMonitorPath();
  if (!fs.existsSync(monitorPath)) return;

  fullscreenOutput = "";
  const child = spawn(
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
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  fullscreenProcess = child;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    fullscreenOutput += chunk;
    const lines = fullscreenOutput.split(/\r?\n/);
    fullscreenOutput = lines.pop() || "";
    lines.forEach(parseFullscreenLine);
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    if (app.commandLine.hasSwitch("smoke-test")) {
      console.error("全屏监测：", chunk.trim());
    }
  });
  const handleMonitorStop = () => {
    if (fullscreenProcess !== child) return;
    fullscreenProcess = null;
    fullscreenStability.reset("");
    activeFullscreenDisplayIds = new Set();
    if (quitting) return;
    updateFullscreenVisibility();
    fullscreenRestartTimer = setTimeout(startFullscreenMonitor, 1500);
  };
  child.once("error", handleMonitorStop);
  child.once("exit", handleMonitorStop);
}

function stopFullscreenMonitor() {
  clearTimeout(fullscreenRestartTimer);
  fullscreenRestartTimer = null;
  if (!fullscreenProcess) return;
  const child = fullscreenProcess;
  fullscreenProcess = null;
  child.kill();
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
    assetBaseUrl: protectedResources
      ? `${RESOURCE_SCHEME}://${RESOURCE_HOST}/assets/`
      : null,
    smokeTest: app.commandLine.hasSwitch("smoke-test"),
    runtime: {
      paused: runtime.paused,
      clickThrough: runtime.clickThrough,
      scale: runtime.scale,
      playing: runtime.playing,
      personality: runtime.personality,
      environmentAwareness: runtime.environmentAwareness,
    },
    environment: environmentSnapshot(),
    window: {
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    },
  }));

  ipcMain.on("pet:renderer-ready", () => {
    clearTimeout(smokeReadyTimer);
    smokeReadyTimer = null;
    publishEnvironmentState();
    if (app.commandLine.hasSwitch("smoke-test")) {
      runSmokeTest().catch((error) => {
        console.error("冒烟测试失败：", error);
        quitting = true;
        stopEnvironmentMonitor();
        stopFullscreenMonitor();
        app.exit(1);
      });
    }
  });
  ipcMain.on("pet:renderer-failed", (_event, message) => {
    failApplicationStartup(
      new Error(`渲染进程初始化失败：${String(message || "未知错误")}`),
    );
  });

  ipcMain.on("pet:set-playing", (_event, value) => {
    runtime.playing = Boolean(value);
    updateMenus();
  });

  ipcMain.on("pet:update-layout", (_event, rect) => {
    const nextLayout = sanitizeRect(rect?.collision || rect);
    if (!nextLayout || !petWindow || petWindow.isDestroyed()) return;
    currentLayout = nextLayout;
    const requestedRegions = Array.isArray(rect?.regions) ? rect.regions : [];
    currentShapeRegions = requestedRegions
      .map(sanitizeRect)
      .filter(Boolean)
      .slice(0, 8);
    if (currentShapeRegions.length === 0) {
      currentShapeRegions = [nextLayout];
    }
    updateWindowShape();
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

  ipcMain.handle("pet:get-pointer-position", () => {
    if (!petWindow || petWindow.isDestroyed()) return null;
    const cursor = screen.getCursorScreenPoint();
    const bounds = petWindow.getBounds();
    return {
      clientX: cursor.x - bounds.x,
      clientY: cursor.y - bounds.y,
      screenX: cursor.x,
      screenY: cursor.y,
    };
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
    createPetMenu().popup({ window: petWindow });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function captureSmokePage(filename) {
  const image = await petWindow.webContents.capturePage();
  const outputRoot = app.isPackaged
    ? path.join(app.getPath("temp"), "tangmao-desktop-pet-smoke-output")
    : path.join(__dirname, "..", "build", "smoke-test");
  const output = path.join(outputRoot, filename);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, image.toPNG());
}

async function rendererSmokeState() {
  return petWindow.webContents.executeJavaScript(
    `(() => {
      const smoke = window.__TANGMAO_SMOKE__;
      const state = smoke?.state;
      return {
        mode: document.querySelector("#pet-stage")?.dataset.mode,
        scale: Number(document.querySelector("#pet-stage")?.dataset.scale),
        assetId: document.querySelector("#pet-image")?.dataset.assetId,
        frameIndex: Number(document.querySelector("#pet-image")?.dataset.frameIndex),
        imageComplete: Boolean(document.querySelector("#pet-image")?.complete),
        imageNaturalWidth: Number(document.querySelector("#pet-image")?.naturalWidth),
        dailyCycle: Number(document.querySelector("#pet-stage")?.dataset.dailyCycle),
        behaviorTrigger: document.querySelector("#pet-stage")?.dataset.behaviorTrigger,
        bubbleVisible: document.querySelector("#speech-bubble")?.classList.contains("visible"),
        bubbleText: document.querySelector("#speech-bubble")?.textContent || "",
        dragging: state?.mode === "dragging",
        dailyRemainingMs: state?.dailyTimer ? state.dailyTimer.remaining() : 0,
        actionRemainingMs: state?.actionTimer ? state.actionTimer.remaining() : 0,
        playRemainingMs: state?.playTimer ? state.playTimer.remaining() : 0,
        playing: Boolean(state?.play),
        playSwatBaseFacing: state?.play?.swatBaseFacing || null,
        manualPaused: Boolean(state?.manualPaused),
        fullscreenPaused: Boolean(state?.fullscreenPaused),
        personality: state?.personality,
        environmentAwareness: state?.environmentAwareness,
        facing: state?.facing,
        facingY: state?.facingY,
        movementKind: state?.movement?.kind || null,
        movementName: state?.movement?.name || null,
        movementAxis: state?.movement?.axis || null,
        movementCycleCount: state?.movement?.cycleCount || null,
        movementDurationMs: state?.movement?.durationMs || null
      };
    })()`,
    true,
  );
}

async function verifyHoverMaskRegression() {
  return petWindow.webContents.executeJavaScript(
    `(async () => {
      const smoke = window.__TANGMAO_SMOKE__;
      if (!smoke) throw new Error("缺少冒烟测试接口");
      const {
        captureHoverAnchor,
        currentAsset,
        currentFrame,
        drawHitCanvas,
        enterDaily,
        geometryFor,
        hitTest,
        hitTestHoverAnchor,
        petImage,
        renderFrame,
        setMode,
        stopCurrent
      } = smoke;
      const assets = smoke.assets;
      const manifest = smoke.manifest;
      const state = smoke.state;
      const pair =
        manifest.daily.find((entry) => entry.id === "sleeping") ||
        manifest.daily[0];
      const waitForImage = () =>
        petImage.complete && petImage.naturalWidth
          ? Promise.resolve()
          : new Promise((resolve) =>
              petImage.addEventListener("load", resolve, { once: true })
            );
      let result = null;
      state.fullscreenPaused = true;
      try {
        stopCurrent({ clearPending: true });
        state.currentDaily = pair;
        state.currentHoverId = null;
        setMode("daily");
        renderFrame(pair.idle, 0);
        await waitForImage();
        drawHitCanvas();
        if (!captureHoverAnchor()) {
          return { foundAnchorOnlyPoint: false, lift: 0 };
        }
        state.currentHoverId = pair.hovers[0];
        setMode("hover");
        renderFrame(state.currentHoverId, 0);
        await waitForImage();
        drawHitCanvas();

        const idleAsset = assets[pair.idle];
        const idleGeometry = geometryFor(idleAsset, idleAsset.frames[0]);
        let point = null;
        const left = Math.floor(idleGeometry.collision.x);
        const top = Math.floor(idleGeometry.collision.y);
        const right = Math.ceil(
          idleGeometry.collision.x + idleGeometry.collision.width
        );
        const bottom = Math.ceil(
          idleGeometry.collision.y + idleGeometry.collision.height
        );
        for (let y = top; y <= bottom && !point; y += 2) {
          for (let x = left; x <= right; x += 2) {
            if (
              hitTestHoverAnchor(x, y, 0) &&
              !hitTest(x, y, manifest.rules.hoverTolerance)
            ) {
              point = { x, y };
              break;
            }
          }
        }
        const hoverGeometry = geometryFor(currentAsset(), currentFrame());
        result = {
          foundAnchorOnlyPoint: Boolean(point),
          unionKeepsHover: Boolean(
            point &&
              (hitTest(point.x, point.y, manifest.rules.hoverTolerance) ||
                hitTestHoverAnchor(
                  point.x,
                  point.y,
                  manifest.rules.hoverTolerance
                ))
          ),
          lift: hoverGeometry.imageTop - hoverGeometry.imageLayoutTop,
        };
      } finally {
        state.fullscreenPaused = false;
        enterDaily();
      }
      return result;
    })()`,
    true,
  );
}

function menuSignature(menu) {
  return menu.items.map((item) =>
    item.type === "separator" ? "separator" : item.label,
  );
}

function verifyMainProcessV3Contract() {
  const petMenu = createPetMenu();
  const trayMenu = createTrayMenu();
  const petSignature = menuSignature(petMenu);
  const traySignature = menuSignature(trayMenu);
  const playLabel = runtime.playing ? "停止玩耍" : "和糖猫玩耍";
  const pauseLabel = runtime.paused ? "继续活动" : "暂停活动";

  const expectedPetSignature = [
    "随机动作",
    "出去走走",
    playLabel,
    "separator",
    pauseLabel,
    "调整大小",
    "separator",
    "藏起来",
    "退出",
  ];
  const expectedTraySignature = [
    pauseLabel,
    "环境感知",
    "鼠标穿透",
    "性格",
    "调整大小",
    "separator",
    runtime.userHidden ? "叫糖猫回来" : "藏起来",
    "退出",
  ];
  if (
    JSON.stringify(petSignature) !== JSON.stringify(expectedPetSignature) ||
    JSON.stringify(traySignature) !== JSON.stringify(expectedTraySignature)
  ) {
    throw new Error(
      `第三版菜单顺序无效：${JSON.stringify({
        petSignature,
        traySignature,
      })}`,
    );
  }

  const personalityLabels = trayMenu.items[3].submenu.items.map(
    (item) => item.label,
  );
  if (
    JSON.stringify(personalityLabels) !==
      JSON.stringify(["安静", "默认", "活泼"]) ||
    trayMenu.items[1].checked !== runtime.environmentAwareness ||
    trayMenu.items[2].checked !== runtime.clickThrough ||
    petMenu.items[2].enabled !==
      (runtime.playing || !runtime.fullscreenHidden)
  ) {
    throw new Error("第三版菜单动态状态无效");
  }

  const storedSettings = JSON.parse(
    fs.readFileSync(persistentSettingsPath(), "utf8"),
  );
  if (
    !isValidPersistentSettings(storedSettings) ||
    storedSettings.personality !== runtime.personality ||
    storedSettings.environmentAwareness !== runtime.environmentAwareness
  ) {
    throw new Error("第三版持久设置无效");
  }

  if (
    !Object.values(runtime.environment).every(
      (value) => typeof value === "boolean",
    ) ||
    activitySamples.length < 1 ||
    activitySamples.length > ACTIVITY_SAMPLE_COUNT
  ) {
    throw new Error("第三版环境采样状态无效");
  }
}

async function runSmokeTest() {
  verifyMainProcessV3Contract();
  await delay(300);
  const startupState = await rendererSmokeState();
  if (
    startupState.mode !== "daily" ||
    !startupState.bubbleVisible ||
    startupState.bubbleText.length < 12 ||
    startupState.bubbleText.length > 24
  ) {
    throw new Error(`启动开场白无效：${JSON.stringify(startupState)}`);
  }
  const hoverMaskRegression = await verifyHoverMaskRegression();
  if (
    !hoverMaskRegression?.foundAnchorOnlyPoint ||
    !hoverMaskRegression.unionKeepsHover ||
    hoverMaskRegression.lift !== -4
  ) {
    throw new Error(
      `悬停联合遮罩或微动几何无效：${JSON.stringify(hoverMaskRegression)}`,
    );
  }
  await delay(150);
  const dailyState = await rendererSmokeState();
  if (dailyState.mode !== "daily" || !dailyState.assetId) {
    throw new Error(`初始日常状态无效：${JSON.stringify(dailyState)}`);
  }
  const dragBefore = await rendererSmokeState();
  await petWindow.webContents.executeJavaScript(
    `window.__TANGMAO_SMOKE__.beginDragVisual(); "drag-started"`,
    true,
  );
  await delay(180);
  const dragDuring = await rendererSmokeState();
  await petWindow.webContents.executeJavaScript(
    `(() => {
      const smoke = window.__TANGMAO_SMOKE__;
      smoke.endDragVisual();
      smoke.enterDaily();
      return "drag-ended";
    })()`,
    true,
  );
  await delay(60);
  const dragAfter = await rendererSmokeState();
  const dragState = {
    before: {
      mode: dragBefore.mode,
      assetId: dragBefore.assetId,
      remainingMs: dragBefore.dailyRemainingMs,
    },
    during: {
      mode: dragDuring.mode,
      assetId: dragDuring.assetId,
      remainingMs: dragDuring.dailyRemainingMs,
    },
    after: {
      mode: dragAfter.mode,
      assetId: dragAfter.assetId,
      remainingMs: dragAfter.dailyRemainingMs,
      dailyCycle: dragAfter.dailyCycle,
    },
    expectedDragAsset: manifest.dragAsset,
  };
  if (
    dragState.during.mode !== "dragging" ||
    dragState.during.assetId !== dragState.expectedDragAsset ||
    dragState.during.remainingMs !== 0 ||
    dragState.after.mode !== "daily" ||
    dragState.after.dailyCycle <= dragBefore.dailyCycle ||
    dragState.after.remainingMs < manifest.rules.dailyDelayMs.min - 1000 ||
    dragState.after.remainingMs > manifest.rules.dailyDelayMs.max
  ) {
    throw new Error(`第三版正常放下语义无效：${JSON.stringify(dragState)}`);
  }
  petWindow.webContents.sendInputEvent({
    type: "mouseMove",
    x: Math.round(currentLayout.x + currentLayout.width / 2),
    y: Math.round(currentLayout.y + currentLayout.height / 2),
  });
  await delay(100);
  const hoverState = await rendererSmokeState();
  if (hoverState.mode !== "hover") {
    throw new Error(`日常悬停状态无效：${JSON.stringify(hoverState)}`);
  }
  petWindow.webContents.sendInputEvent({ type: "mouseMove", x: 1, y: 1 });
  await delay(manifest.rules.hoverLeaveDelayMs + 80);
  const leaveHoverState = await rendererSmokeState();
  if (leaveHoverState.mode !== "daily") {
    throw new Error(`悬停恢复状态无效：${JSON.stringify(leaveHoverState)}`);
  }
  await captureSmokePage("01-daily.png");
  const cycleBeforeManualAction = leaveHoverState.dailyCycle;
  await petWindow.webContents.executeJavaScript(
    `(() => {
      const smoke = window.__TANGMAO_SMOKE__;
      smoke.startAction(smoke.manifest.staticActions[0], "smoke-manual");
    })()`,
    true,
  );
  await delay(300);
  const actionState = await rendererSmokeState();
  if (
    actionState.mode !== "action-static" ||
    actionState.behaviorTrigger !== "smoke-manual" ||
    !actionState.bubbleVisible
  ) {
    throw new Error(`随机动作状态无效：${JSON.stringify(actionState)}`);
  }
  await captureSmokePage("02-action.png");
  const actionDeadline =
    Date.now() + manifest.rules.staticDurationMs.max + 1000;
  let dailyAfterManualAction = await rendererSmokeState();
  while (
    dailyAfterManualAction.mode === "action-static" &&
    Date.now() < actionDeadline
  ) {
    await delay(50);
    dailyAfterManualAction = await rendererSmokeState();
  }
  if (
    !["daily", "hover"].includes(dailyAfterManualAction.mode) ||
    dailyAfterManualAction.dailyCycle <= cycleBeforeManualAction ||
    dailyAfterManualAction.dailyRemainingMs <
      manifest.rules.dailyDelayMs.min - 1000 ||
    dailyAfterManualAction.dailyRemainingMs >
      manifest.rules.dailyDelayMs.max
  ) {
    throw new Error(
      `手动动作结束后没有重置日常倒计时：${JSON.stringify(dailyAfterManualAction)}`,
    );
  }
  const gifAssetId = [...manifest.gifActions]
    .filter((assetId) => manifest.assets[assetId]?.frames?.length > 1)
    .sort((left, right) => {
      const shortestFrame = (assetId) =>
        Math.min(
          ...manifest.assets[assetId].frames.map((frame) => frame.durationMs),
        );
      return shortestFrame(left) - shortestFrame(right);
    })[0];
  if (!gifAssetId) {
    throw new Error("没有可用于冒烟测试的多帧 GIF");
  }
  await petWindow.webContents.executeJavaScript(
    `window.__TANGMAO_SMOKE__.startAction(
      ${JSON.stringify(gifAssetId)},
      "smoke-gif"
    )`,
    true,
  );
  await delay(50);
  const gifTransitionState = await rendererSmokeState();
  if (
    gifTransitionState.mode !== "action-gif" ||
    !gifTransitionState.bubbleVisible ||
    !gifTransitionState.imageComplete ||
    gifTransitionState.imageNaturalWidth <= 0
  ) {
    throw new Error(
      `GIF 预载期间出现空白：${JSON.stringify(gifTransitionState)}`,
    );
  }
  const gifReadyDeadline = Date.now() + 2000;
  let firstGifState = gifTransitionState;
  while (
    (firstGifState.assetId !== gifAssetId ||
      !firstGifState.imageComplete ||
      firstGifState.imageNaturalWidth <= 0) &&
    Date.now() < gifReadyDeadline
  ) {
    await delay(50);
    firstGifState = await rendererSmokeState();
  }
  const gifFrameDeadline = Date.now() + 1200;
  let laterGifState = firstGifState;
  while (
    laterGifState.frameIndex === firstGifState.frameIndex &&
    Date.now() < gifFrameDeadline
  ) {
    await delay(50);
    laterGifState = await rendererSmokeState();
  }
  if (
    firstGifState.mode !== "action-gif" ||
    firstGifState.assetId !== gifAssetId ||
    !firstGifState.bubbleVisible ||
    laterGifState.frameIndex === firstGifState.frameIndex ||
    !firstGifState.imageComplete ||
    firstGifState.imageNaturalWidth <= 0 ||
    !laterGifState.imageComplete ||
    laterGifState.imageNaturalWidth <= 0
  ) {
    throw new Error(
      `加密 GIF 帧播放无效：${JSON.stringify({ firstGifState, laterGifState })}`,
    );
  }
  await petWindow.webContents.executeJavaScript(
    `window.__TANGMAO_SMOKE__.queueTestSingleClick()`,
    true,
  );
  await delay(350);
  const interruptedGifState = await rendererSmokeState();
  if (
    !["action-static", "action-gif"].includes(interruptedGifState.mode) ||
    interruptedGifState.assetId === gifAssetId ||
    interruptedGifState.behaviorTrigger !== "single"
  ) {
    throw new Error(
      `单击没有立即替换普通 GIF：${JSON.stringify(interruptedGifState)}`,
    );
  }
  const cycleBeforeManualMovement = dailyAfterManualAction.dailyCycle;
  const positionBeforeMovement = petWindow.getPosition();
  sendCommand("random-movement", { interrupt: true });
  await delay(550);
  const movementState = await rendererSmokeState();
  const movementEntry = manifest.movement[movementState.movementName];
  const movementCycleDuration =
    movementEntry?.animation.type === "gif"
      ? manifest.assets[movementEntry.animation.asset].loopDurationMs
      : movementEntry?.animation.frames.reduce(
          (total, frame) => total + frame.durationMs,
          0,
        );
  if (
    movementState.mode !== "movement" ||
    movementState.movementKind !== "autonomous" ||
    !["horizontal", "vertical"].includes(movementState.movementAxis) ||
    !Number.isInteger(movementState.movementCycleCount) ||
    movementState.movementDurationMs !==
      movementCycleDuration * movementState.movementCycleCount ||
    movementState.movementDurationMs < manifest.rules.movementDurationMs.min ||
    movementState.movementDurationMs > manifest.rules.movementDurationMs.max
  ) {
    throw new Error(`随机移动状态无效：${JSON.stringify(movementState)}`);
  }
  const positionAfterMovement = petWindow.getPosition();
  if (
    positionBeforeMovement[0] === positionAfterMovement[0] &&
    positionBeforeMovement[1] === positionAfterMovement[1]
  ) {
    throw new Error("随机移动没有改变窗口位置");
  }
  sendCommand("fullscreen-pause");
  const pauseDeadline = Date.now() + 1000;
  while (
    !(await petWindow.webContents.executeJavaScript(
      `Boolean(window.__TANGMAO_SMOKE__?.state?.fullscreenPaused)`,
      true,
    )) &&
    Date.now() < pauseDeadline
  ) {
    await delay(20);
  }
  const positionBeforeFullscreenPause = petWindow.getPosition();
  await delay(220);
  const positionDuringFullscreenPause = petWindow.getPosition();
  if (
    positionBeforeFullscreenPause[0] !== positionDuringFullscreenPause[0] ||
    positionBeforeFullscreenPause[1] !== positionDuringFullscreenPause[1]
  ) {
    throw new Error("全屏暂停期间窗口仍在移动");
  }
  sendCommand("fullscreen-resume");
  const resumeDeadline = Date.now() + 1000;
  while (
    (await petWindow.webContents.executeJavaScript(
      `Boolean(window.__TANGMAO_SMOKE__?.state?.fullscreenPaused)`,
      true,
    )) &&
    Date.now() < resumeDeadline
  ) {
    await delay(20);
  }
  await delay(260);
  const positionAfterFullscreenResume = petWindow.getPosition();
  if (
    positionDuringFullscreenPause[0] === positionAfterFullscreenResume[0] &&
    positionDuringFullscreenPause[1] === positionAfterFullscreenResume[1]
  ) {
    throw new Error("退出全屏暂停后移动没有恢复");
  }
  await captureSmokePage("03-movement.png");
  await petWindow.webContents.executeJavaScript(
    `window.__TANGMAO_SMOKE__.enterDaily()`,
    true,
  );
  await delay(300);
  const dailyAfterManualMovement = await rendererSmokeState();
  if (
    !["daily", "hover"].includes(dailyAfterManualMovement.mode) ||
    dailyAfterManualMovement.dailyCycle <= cycleBeforeManualMovement ||
    dailyAfterManualMovement.dailyRemainingMs <
      manifest.rules.dailyDelayMs.min - 1000 ||
    dailyAfterManualMovement.dailyRemainingMs >
      manifest.rules.dailyDelayMs.max
  ) {
    throw new Error(
      `手动移动结束后没有重置日常倒计时：${JSON.stringify(dailyAfterManualMovement)}`,
    );
  }

  const positionBeforeThrow = petWindow.getPosition();
  await petWindow.webContents.executeJavaScript(
    `window.__TANGMAO_SMOKE__.startThrow({
      x: -1200,
      y: -600,
      speed: Math.hypot(1200, 600)
    })`,
    true,
  );
  await delay(240);
  const throwState = await rendererSmokeState();
  const positionDuringThrow = petWindow.getPosition();
  if (
    throwState.mode !== "throwing" ||
    throwState.movementKind !== "throw" ||
    throwState.bubbleVisible ||
    throwState.facing !== -1 ||
    throwState.facingY !== 1 ||
    (positionBeforeThrow[0] === positionDuringThrow[0] &&
      positionBeforeThrow[1] === positionDuringThrow[1])
  ) {
    throw new Error(`投掷飞行状态无效：${JSON.stringify(throwState)}`);
  }
  sendCommand("fullscreen-pause");
  await delay(80);
  const positionBeforeThrowPause = petWindow.getPosition();
  await delay(180);
  const positionDuringThrowPause = petWindow.getPosition();
  if (
    positionBeforeThrowPause[0] !== positionDuringThrowPause[0] ||
    positionBeforeThrowPause[1] !== positionDuringThrowPause[1]
  ) {
    throw new Error("全屏隐藏期间投掷飞行没有暂停");
  }
  sendCommand("fullscreen-resume");
  await delay(220);
  const positionAfterThrowResume = petWindow.getPosition();
  if (
    positionDuringThrowPause[0] === positionAfterThrowResume[0] &&
    positionDuringThrowPause[1] === positionAfterThrowResume[1]
  ) {
    throw new Error("退出全屏后投掷飞行没有恢复");
  }
  await petWindow.webContents.executeJavaScript(
    `(() => {
      const smoke = window.__TANGMAO_SMOKE__;
      smoke.finishThrow(smoke.state.movement);
    })()`,
    true,
  );
  await delay(100);
  const landingState = await rendererSmokeState();
  if (
    landingState.mode !== "landing" ||
    !manifest.throwBehavior.landingActions.includes(landingState.assetId) ||
    landingState.bubbleVisible ||
    landingState.facingY !== 1
  ) {
    throw new Error(`投掷落地反馈无效：${JSON.stringify(landingState)}`);
  }
  await petWindow.webContents.executeJavaScript(
    `window.__TANGMAO_SMOKE__.enterDaily()`,
    true,
  );

  await petWindow.webContents.executeJavaScript(
    `window.__TANGMAO_SMOKE__.startPlay()`,
    true,
  );
  await delay(120);
  const playState = await rendererSmokeState();
  if (
    !playState.playing ||
    !["playing", "play-approach", "play-swat"].includes(playState.mode) ||
    playState.playRemainingMs < PLAY_DURATION_MS - 1000 ||
    playState.playRemainingMs > PLAY_DURATION_MS ||
    playState.bubbleVisible ||
    !runtime.playing
  ) {
    throw new Error(`90秒玩耍初态无效：${JSON.stringify(playState)}`);
  }
  const greetingAssetId = manifest.playBehavior.greetingAsset;
  await petWindow.webContents.executeJavaScript(
    `(() => {
      const smoke = window.__TANGMAO_SMOKE__;
      smoke.setFacing(1);
      smoke.startPlaySwat(
        performance.now(),
        1,
        ${JSON.stringify(greetingAssetId)}
      );
    })()`,
    true,
  );
  await delay(80);
  const greetingSwatState = await rendererSmokeState();
  if (
    greetingSwatState.mode !== "play-swat" ||
    greetingSwatState.assetId !== greetingAssetId ||
    ![-1, 1].includes(greetingSwatState.playSwatBaseFacing) ||
    greetingSwatState.facing !== -greetingSwatState.playSwatBaseFacing
  ) {
    throw new Error(
      `玩耍打招呼没有朝鼠标侧额外翻转：${JSON.stringify(greetingSwatState)}`,
    );
  }
  await petWindow.webContents.executeJavaScript(
    `window.__TANGMAO_SMOKE__.resumePlayIdle()`,
    true,
  );
  await delay(50);
  const restoredGreetingState = await rendererSmokeState();
  if (
    !restoredGreetingState.playing ||
    restoredGreetingState.facing !== greetingSwatState.playSwatBaseFacing
  ) {
    throw new Error(
      `玩耍打招呼结束后没有恢复朝向：${JSON.stringify(restoredGreetingState)}`,
    );
  }
  setPaused(true);
  const playBeforePauseDelay = await rendererSmokeState();
  await delay(160);
  const playAfterPauseDelay = await rendererSmokeState();
  setPaused(false);
  if (
    playBeforePauseDelay.playRemainingMs -
      playAfterPauseDelay.playRemainingMs <
    100
  ) {
    throw new Error("手动暂停错误地暂停了玩耍计时");
  }
  sendCommand("fullscreen-pause");
  await delay(120);
  const playAfterFullscreen = await rendererSmokeState();
  if (
    playAfterFullscreen.playing ||
    !["daily", "hover"].includes(playAfterFullscreen.mode) ||
    runtime.playing
  ) {
    throw new Error(
      `全屏开始后没有结束玩耍：${JSON.stringify(playAfterFullscreen)}`,
    );
  }
  sendCommand("fullscreen-resume");
  await delay(80);

  setPersonality("active");
  await delay(80);
  const activePersonalityState = await rendererSmokeState();
  if (
    activePersonalityState.personality !== "active" ||
    activePersonalityState.dailyRemainingMs < 9000 ||
    activePersonalityState.dailyRemainingMs > 18_000
  ) {
    throw new Error(
      `活泼性格倒计时无效：${JSON.stringify(activePersonalityState)}`,
    );
  }
  setPersonality("default");
  setEnvironmentAwareness(false);
  await delay(80);
  const environmentDisabledState = await rendererSmokeState();
  if (environmentDisabledState.environmentAwareness) {
    throw new Error("环境感知关闭状态没有同步到渲染进程");
  }
  setEnvironmentAwareness(true);

  setScale(1.5);
  await delay(250);
  const scaleState = await rendererSmokeState();
  if (scaleState.scale !== 1.5) {
    throw new Error(`缩放状态无效：${JSON.stringify(scaleState)}`);
  }
  await captureSmokePage("04-scale-150.png");
  if (process.platform === "win32") {
    const monitorDeadline = Date.now() + 3000;
    while (fullscreenSamples < 1 && Date.now() < monitorDeadline) {
      await delay(100);
    }
    if (fullscreenSamples < 1) {
      throw new Error("没有收到全屏监测进程的有效状态");
    }
  }
  console.log("第三版 Electron 冒烟测试通过");
  quitApplication();
}

async function createWindow() {
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
      devTools: !app.isPackaged,
      backgroundThrottling: false,
      partition: PET_SESSION_PARTITION,
    },
  });

  runtime.currentDisplayId = screen.getPrimaryDisplay().id;
  petWindow.setMenu(null);
  petWindow.setAlwaysOnTop(true, "floating");
  petWindow.setIgnoreMouseEvents(false);
  petWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  petWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  petWindow.webContents.on(
    "render-process-gone",
    (_event, details) => {
      if (quitting) return;
      failApplicationStartup(
        new Error(`渲染进程异常退出：${details.reason} (${details.exitCode})`),
      );
    },
  );
  smokeReadyTimer = setTimeout(
    () => failApplicationStartup(new Error("渲染进程就绪等待超时")),
    20000,
  );
  if (protectedResources) {
    await petWindow.loadURL(`${RESOURCE_SCHEME}://${RESOURCE_HOST}/index.html`);
  } else {
    await petWindow.loadFile(path.join(__dirname, "index.html"));
  }
  petWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    hideByUser();
  });
}

if (app.commandLine.hasSwitch("smoke-test")) {
  app.setPath(
    "userData",
    path.join(app.getPath("temp"), "tangmao-desktop-pet-smoke"),
  );
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // 严格单实例：重复启动静默退出，不影响已有实例。
  });
  app
    .whenReady()
    .then(async () => {
      loadManifest();
      loadPersistentSettings();
      startEnvironmentMonitor();
      registerProtectedResourceProtocol();
      verifyFullscreenMonitorIntegrity();
      registerIpc();
      await createWindow();
      createTray();
      startFullscreenMonitor();
    })
    .catch(failApplicationStartup);
}

app.on("before-quit", () => {
  quitting = true;
  stopEnvironmentMonitor();
  stopFullscreenMonitor();
});

app.on("window-all-closed", () => {
  // 桌宠由托盘菜单控制生命周期，只有“退出”会结束进程。
});
