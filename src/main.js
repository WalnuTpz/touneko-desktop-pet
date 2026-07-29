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
const { StableValueTracker } = require("./core");

const WINDOW_WIDTH = 960;
const WINDOW_HEIGHT = 900;
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
let currentShapeRegions = [];
let firstLayout = true;
let pendingBottomRight = true;
let manifest = null;
let fullscreenProcess = null;
let fullscreenRestartTimer = null;
let fullscreenOutput = "";
let activeFullscreenDisplayIds = new Set();
let fullscreenSamples = 0;
const fullscreenStability = new StableValueTracker("");

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
  tray?.setContextMenu(createPetMenu({ includeActions: false }));
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
  const icon = nativeImage.createEmpty();
  for (const representation of manifest.icons.trayRepresentations) {
    const buffer = fs.readFileSync(generatedPath(...representation.file.split("/")));
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
  if (process.platform !== "win32" || fullscreenProcess || quitting) return;
  clearTimeout(fullscreenRestartTimer);
  fullscreenRestartTimer = null;
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
      runSmokeTest().catch((error) => {
        console.error("冒烟测试失败：", error);
        process.exitCode = 1;
        quitApplication();
      });
    }
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
    createPetMenu({ includeActions: true }).popup({ window: petWindow });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function captureSmokePage(filename) {
  const image = await petWindow.webContents.capturePage();
  const output = path.join(__dirname, "..", "build", "smoke-test", filename);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, image.toPNG());
}

async function rendererSmokeState() {
  return petWindow.webContents.executeJavaScript(
    `({
      mode: document.querySelector("#pet-stage")?.dataset.mode,
      scale: Number(document.querySelector("#pet-stage")?.dataset.scale),
      assetId: document.querySelector("#pet-image")?.dataset.assetId,
      dailyCycle: Number(document.querySelector("#pet-stage")?.dataset.dailyCycle),
      behaviorTrigger: document.querySelector("#pet-stage")?.dataset.behaviorTrigger,
      bubbleVisible: document.querySelector("#speech-bubble")?.classList.contains("visible"),
      dailyRemainingMs:
        typeof state !== "undefined" && state?.dailyTimer
          ? state.dailyTimer.remaining()
          : 0
    })`,
    true,
  );
}

async function verifyHoverMaskRegression() {
  return petWindow.webContents.executeJavaScript(
    `(async () => {
      const pair =
        manifest.daily.find((entry) => entry.number === 7) ||
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

async function runSmokeTest() {
  await delay(300);
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
    `startAction(manifest.staticActions[0], "smoke-manual")`,
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
  await delay(manifest.rules.staticDurationMs.max + 250);
  const dailyAfterManualAction = await rendererSmokeState();
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
  await petWindow.webContents.executeJavaScript(
    `clickTimer = setTimeout(
      () => queueOrExecuteClick("single"),
      DOUBLE_CLICK_DELAY_MS
    )`,
    true,
  );
  const cycleBeforeManualMovement = dailyAfterManualAction.dailyCycle;
  const positionBeforeMovement = petWindow.getPosition();
  sendCommand("random-movement", { interrupt: true });
  await delay(550);
  const movementState = await rendererSmokeState();
  if (movementState.mode !== "movement") {
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
    `if (state.movement) state.movement.remainingMs = 80`,
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
  console.log("第二版 Electron 冒烟测试通过");
  quitApplication();
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
  petWindow.setIgnoreMouseEvents(false);
  petWindow.loadFile(path.join(__dirname, "index.html"));
  petWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  petWindow.webContents.on("will-navigate", (event) => event.preventDefault());
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
