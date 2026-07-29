const stage = document.querySelector("#pet-stage");
const petImage = document.querySelector("#pet-image");
const speechBubble = document.querySelector("#speech-bubble");
const {
  PausableTimer,
  chooseGifLoopCount,
  pickUniform,
  pickWithRecent,
  pushRecent,
  randomBetween,
} = window.PetCore;
const {
  bubbleMessageForAction,
  dialogueForAsset,
  openingDialogueForLaunch,
} = window.PetDialogue;

const GENERATED_ROOT = new URL("../assets/generated/", window.location.href);
const DOUBLE_CLICK_DELAY_MS = 280;
const DRAG_THRESHOLD = 5;
const BASELINE_MARGIN = 18;
const POINTER_POLL_INTERVAL_MS = 80;
const PET_SHAPE_PADDING = 8;
const BUBBLE_GAP = 17;

let manifest = null;
let assets = null;
let windowSize = { width: 960, height: 900 };
let state = null;
let pointerState = null;
let suppressClickUntil = 0;
let clickTimer = null;
let lastPointerRegion = null;
let lastPointerPosition = null;
let imageLoaded = false;
let readyReported = false;
let pointerPollInFlight = false;
let pointerPollTimer = null;
let pointerPollWarningShown = false;
let pointerPollStopped = false;
let bubbleShapeReleaseTimer = null;
let hoverAnchor = null;

const hitCanvas = document.createElement("canvas");
const hitContext = hitCanvas.getContext("2d", { willReadFrequently: true });
const hoverAnchorCanvas = document.createElement("canvas");
const hoverAnchorContext = hoverAnchorCanvas.getContext("2d", {
  willReadFrequently: true,
});

function assetUrl(relativePath) {
  return new URL(relativePath, GENERATED_ROOT).href;
}

function currentAsset() {
  return state?.currentAssetId ? assets[state.currentAssetId] : null;
}

function currentFrame() {
  const asset = currentAsset();
  return asset?.frames[state.currentFrameIndex] || null;
}

function setMode(mode) {
  state.mode = mode;
  stage.dataset.mode = mode;
}

function reportPointerRegion(overPet) {
  const next = Boolean(overPet) && !state?.clickThrough;
  if (lastPointerRegion === next) return;
  lastPointerRegion = next;
  window.desktopPet.setPointerRegion(next);
}

function setFacing(value) {
  state.facing = value < 0 ? -1 : 1;
  petImage.style.setProperty("--facing", String(state.facing));
  updateGeometry();
}

function toggleFacing() {
  setFacing(-state.facing);
}

function geometryFor(asset, frame) {
  const scale = asset.displayScale * state.userScale;
  const imageWidth = asset.canvas.width * scale;
  const imageHeight = asset.canvas.height * scale;
  const imageLeft = (windowSize.width - imageWidth) / 2;
  const imageLayoutTop = windowSize.height - BASELINE_MARGIN - imageHeight;
  const hoverLift =
    state.mode === "hover" && asset.id === state.currentHoverId ? -4 : 0;
  const imageTop = imageLayoutTop + hoverLift;
  const sourceBounds = frame.bounds;
  const sourceX =
    state.facing > 0
      ? sourceBounds.x
      : asset.canvas.width - sourceBounds.x - sourceBounds.width;
  const padding = Number(asset.collisionPadding) || 0;
  return {
    scale,
    imageWidth,
    imageHeight,
    imageLeft,
    imageTop,
    imageLayoutTop,
    bubbleAnchor: {
      centerX: imageLeft + imageWidth / 2,
      topY: imageTop + asset.contentBounds.y * scale,
    },
    collision: {
      x: imageLeft + sourceX * scale - padding,
      y: imageTop + sourceBounds.y * scale - padding,
      width: sourceBounds.width * scale + padding * 2,
      height: sourceBounds.height * scale + padding * 2,
    },
  };
}

function expandedRect(rect, padding) {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

function positionBubble(geometry) {
  if (!bubbleOccupiesShape()) return null;
  const width = speechBubble.offsetWidth;
  const height = speechBubble.offsetHeight;
  const halfWidth = width / 2;
  const desiredCenter = geometry.bubbleAnchor.centerX;
  const center = Math.min(
    windowSize.width - halfWidth - 8,
    Math.max(halfWidth + 8, desiredCenter),
  );
  const top = Math.max(
    8,
    geometry.bubbleAnchor.topY - height - BUBBLE_GAP,
  );
  speechBubble.style.left = `${center}px`;
  speechBubble.style.top = `${top}px`;
  return {
    x: center - halfWidth - 4,
    y: top - 4,
    width: width + 8,
    height: height + 16,
  };
}

function drawHitCanvas() {
  const asset = currentAsset();
  if (!asset || !imageLoaded || !petImage.naturalWidth) return;
  const geometry = geometryFor(asset, currentFrame());
  const width = Math.max(1, Math.ceil(geometry.imageWidth));
  const height = Math.max(1, Math.ceil(geometry.imageHeight));
  if (hitCanvas.width !== width) hitCanvas.width = width;
  if (hitCanvas.height !== height) hitCanvas.height = height;
  hitContext.clearRect(0, 0, width, height);
  hitContext.drawImage(petImage, 0, 0, width, height);
}

function updateGeometry() {
  const asset = currentAsset();
  const frame = currentFrame();
  if (!asset || !frame) return;
  const geometry = geometryFor(asset, frame);
  petImage.style.left = `${geometry.imageLeft}px`;
  petImage.style.top = `${geometry.imageLayoutTop}px`;
  petImage.style.width = `${geometry.imageWidth}px`;
  petImage.style.height = `${geometry.imageHeight}px`;
  const regions = [
    expandedRect(geometry.collision, PET_SHAPE_PADDING),
  ];
  if (state.mode === "hover" && hoverAnchor) {
    const idleAsset = assets[hoverAnchor.assetId];
    const idleFrame = idleAsset?.frames[hoverAnchor.frameIndex];
    if (idleAsset && idleFrame) {
      const idleGeometry = geometryFor(idleAsset, idleFrame);
      regions.push(
        expandedRect(idleGeometry.collision, PET_SHAPE_PADDING),
      );
    }
  }
  const bubbleRegion = positionBubble(geometry);
  if (bubbleRegion) regions.push(bubbleRegion);
  window.desktopPet.updateLayout({
    collision: geometry.collision,
    regions,
  });
  drawHitCanvas();
}

function renderFrame(assetId, frameIndex = 0) {
  const asset = assets[assetId];
  if (!asset) {
    throw new Error(`未知素材：${assetId}`);
  }
  const normalizedIndex = Math.min(
    asset.frames.length - 1,
    Math.max(0, Number(frameIndex) || 0),
  );
  const frame = asset.frames[normalizedIndex];
  const nextSource = assetUrl(frame.file);
  state.currentAssetId = assetId;
  state.currentFrameIndex = normalizedIndex;
  petImage.dataset.assetId = assetId;
  petImage.dataset.frameIndex = String(normalizedIndex);
  imageLoaded = petImage.src === nextSource && petImage.complete;
  if (petImage.src !== nextSource) {
    petImage.src = nextSource;
  }
  updateGeometry();
}

petImage.addEventListener("load", () => {
  imageLoaded = true;
  drawHitCanvas();
  updateGeometry();
  if (!readyReported) {
    readyReported = true;
    window.desktopPet.reportReady();
  }
  if (lastPointerPosition && !pointerState) {
    queueMicrotask(() =>
      updatePointerPosition(lastPointerPosition.x, lastPointerPosition.y),
    );
  }
});

petImage.addEventListener("error", () => {
  imageLoaded = false;
  console.error("桌宠素材载入失败：", petImage.src);
});

function hitTestCanvas(
  canvas,
  context,
  geometry,
  clientX,
  clientY,
  tolerance = 0,
) {
  if (!canvas.width || !canvas.height) return false;
  let x = clientX - geometry.imageLeft;
  const y = clientY - geometry.imageTop;
  if (state.facing < 0) {
    x = geometry.imageWidth - x;
  }
  if (
    x < -tolerance ||
    y < -tolerance ||
    x >= geometry.imageWidth + tolerance ||
    y >= geometry.imageHeight + tolerance
  ) {
    return false;
  }

  const scaleX = canvas.width / geometry.imageWidth;
  const scaleY = canvas.height / geometry.imageHeight;
  const centerX = Math.round(x * scaleX);
  const centerY = Math.round(y * scaleY);
  const radiusX = Math.max(0, Math.ceil(tolerance * scaleX));
  const radiusY = Math.max(0, Math.ceil(tolerance * scaleY));
  const startX = Math.max(0, centerX - radiusX);
  const startY = Math.max(0, centerY - radiusY);
  const endX = Math.min(canvas.width - 1, centerX + radiusX);
  const endY = Math.min(canvas.height - 1, centerY + radiusY);
  if (endX < startX || endY < startY) return false;
  const pixels = context.getImageData(
    startX,
    startY,
    endX - startX + 1,
    endY - startY + 1,
  ).data;
  const threshold = Number(manifest.rules.alphaThreshold) || 8;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] >= threshold) return true;
  }
  return false;
}

function hitTest(clientX, clientY, tolerance = 0) {
  const asset = currentAsset();
  const frame = currentFrame();
  if (!asset || !frame || !imageLoaded) return false;
  return hitTestCanvas(
    hitCanvas,
    hitContext,
    geometryFor(asset, frame),
    clientX,
    clientY,
    tolerance,
  );
}

function captureHoverAnchor() {
  if (
    !state.currentDaily ||
    !imageLoaded ||
    !hitCanvas.width ||
    !hitCanvas.height
  ) {
    return false;
  }
  hoverAnchorCanvas.width = hitCanvas.width;
  hoverAnchorCanvas.height = hitCanvas.height;
  hoverAnchorContext.clearRect(
    0,
    0,
    hoverAnchorCanvas.width,
    hoverAnchorCanvas.height,
  );
  hoverAnchorContext.drawImage(hitCanvas, 0, 0);
  hoverAnchor = {
    assetId: state.currentDaily.idle,
    frameIndex: state.currentFrameIndex,
  };
  return true;
}

function hitTestHoverAnchor(clientX, clientY, tolerance = 0) {
  if (!hoverAnchor) return false;
  const asset = assets[hoverAnchor.assetId];
  const frame = asset?.frames[hoverAnchor.frameIndex];
  if (!asset || !frame) return false;
  return hitTestCanvas(
    hoverAnchorCanvas,
    hoverAnchorContext,
    geometryFor(asset, frame),
    clientX,
    clientY,
    tolerance,
  );
}

class GifPlayer {
  constructor() {
    this.assetId = null;
    this.frameIndex = 0;
    this.completedLoops = 0;
    this.targetLoops = 1;
    this.remainingMs = 0;
    this.startedAt = 0;
    this.timeout = null;
    this.paused = false;
    this.onComplete = null;
    this.token = 0;
  }

  start(assetId, targetLoops, onComplete) {
    this.stop();
    this.assetId = assetId;
    this.frameIndex = 0;
    this.completedLoops = 0;
    this.targetLoops = Math.max(1, targetLoops);
    this.onComplete = onComplete;
    this.token += 1;
    renderFrame(assetId, 0);
    this.remainingMs = assets[assetId].frames[0].durationMs;
    this.#arm(this.token);
  }

  #arm(token) {
    this.paused = false;
    this.startedAt = performance.now();
    this.timeout = setTimeout(() => this.#advance(token), this.remainingMs);
  }

  #advance(token) {
    if (token !== this.token || !this.assetId) return;
    this.timeout = null;
    const asset = assets[this.assetId];
    this.frameIndex += 1;
    if (this.frameIndex >= asset.frames.length) {
      this.frameIndex = 0;
      this.completedLoops += 1;
      if (this.completedLoops >= this.targetLoops) {
        const callback = this.onComplete;
        this.stop();
        callback?.();
        return;
      }
    }
    renderFrame(this.assetId, this.frameIndex);
    this.remainingMs = asset.frames[this.frameIndex].durationMs;
    this.#arm(token);
  }

  pause() {
    if (!this.assetId || this.paused || this.timeout === null) return;
    clearTimeout(this.timeout);
    this.timeout = null;
    this.remainingMs = Math.max(
      0,
      this.remainingMs - (performance.now() - this.startedAt),
    );
    this.paused = true;
  }

  resume() {
    if (!this.assetId || !this.paused) return;
    this.#arm(this.token);
  }

  stop() {
    if (this.timeout !== null) clearTimeout(this.timeout);
    this.timeout = null;
    this.assetId = null;
    this.frameIndex = 0;
    this.completedLoops = 0;
    this.remainingMs = 0;
    this.paused = false;
    this.onComplete = null;
    this.token += 1;
  }

  isActive() {
    return Boolean(this.assetId);
  }
}

function cancelMovement() {
  if (!state.movement) return;
  state.movement.token += 1;
  if (state.movement.raf !== null) {
    cancelAnimationFrame(state.movement.raf);
  }
  state.movement = null;
}

function bubbleIsPresent() {
  return (
    speechBubble.classList.contains("visible") ||
    speechBubble.classList.contains("fading")
  );
}

function bubbleOccupiesShape() {
  return state?.mode !== "dragging" && bubbleIsPresent();
}

function beginDragVisual() {
  if (state.mode === "dragging" || !manifest.dragAsset) return;
  const movement = state.movement;
  state.dragSnapshot = {
    mode: state.mode,
    assetId: state.currentAssetId,
    frameIndex: state.currentFrameIndex,
    resumeDailyTimer: state.dailyTimer.running,
    resumeActionTimer: state.actionTimer.running,
    resumeHoverLeaveTimer: state.hoverLeaveTimer.running,
    resumeBubbleTimer: state.bubbleTimer.running,
    resumeGif: state.gifPlayer.isActive() && !state.gifPlayer.paused,
    resumeMovement: Boolean(movement),
  };
  state.dailyTimer.pause();
  state.actionTimer.pause();
  state.hoverLeaveTimer.pause();
  state.bubbleTimer.pause();
  state.gifPlayer.pause();
  if (movement) {
    movement.token += 1;
    if (movement.raf !== null) {
      cancelAnimationFrame(movement.raf);
      movement.raf = null;
    }
    movement.lastTimestamp = null;
  }
  setMode("dragging");
  stage.classList.add("dragging");
  renderFrame(manifest.dragAsset, 0);
}

function endDragVisual() {
  const snapshot = state.dragSnapshot;
  if (!snapshot) {
    stage.classList.remove("dragging");
    return;
  }
  state.dragSnapshot = null;
  stage.classList.remove("dragging");
  setMode(snapshot.mode);
  renderFrame(snapshot.assetId, snapshot.frameIndex);
  if (state.fullscreenPaused) return;
  if (snapshot.resumeDailyTimer && !state.manualPaused) {
    state.dailyTimer.resume();
  }
  if (snapshot.resumeActionTimer) state.actionTimer.resume();
  if (snapshot.resumeHoverLeaveTimer) state.hoverLeaveTimer.resume();
  if (snapshot.resumeBubbleTimer) state.bubbleTimer.resume();
  if (snapshot.resumeGif) state.gifPlayer.resume();
  if (snapshot.resumeMovement && state.movement) {
    state.movement.lastTimestamp = null;
    scheduleMovementFrame(state.movement);
  }
}

function releaseBubbleShape() {
  bubbleShapeReleaseTimer = null;
  speechBubble.classList.remove("fading");
  speechBubble.textContent = "";
  updateGeometry();
}

function hideBubble(immediate = false) {
  clearTimeout(bubbleShapeReleaseTimer);
  bubbleShapeReleaseTimer = null;
  if (!bubbleIsPresent()) return;
  speechBubble.classList.remove("visible");
  if (state?.bubbleTimer) state.bubbleTimer.cancel();
  if (immediate) {
    speechBubble.classList.remove("fading");
    speechBubble.textContent = "";
    updateGeometry();
    return;
  }
  speechBubble.classList.add("fading");
  updateGeometry();
  bubbleShapeReleaseTimer = setTimeout(releaseBubbleShape, 170);
}

function showBubble(message, durationMs) {
  if (!message) return;
  clearTimeout(bubbleShapeReleaseTimer);
  bubbleShapeReleaseTimer = null;
  speechBubble.classList.remove("fading");
  speechBubble.textContent = message;
  speechBubble.classList.add("visible");
  state.bubbleTimer.start(Math.max(800, Number(durationMs) || 0));
  if (state.fullscreenPaused) state.bubbleTimer.pause();
  updateGeometry();
}

function showActionBubble(asset, actionDurationMs, force = false) {
  const message = force
    ? dialogueForAsset(asset.name, () => 0)
    : bubbleMessageForAction(asset.name);
  const duration = Math.max(
    1200,
    Math.min(2800, Number(actionDurationMs) - 120),
  );
  showBubble(message, duration);
}

function showOpeningBubble() {
  showBubble(
    openingDialogueForLaunch(),
    manifest.rules.openingBubbleDurationMs,
  );
}

function stopCurrent({ clearPending = false } = {}) {
  state.dailyTimer.cancel();
  state.actionTimer.cancel();
  state.hoverLeaveTimer.cancel();
  state.bubbleTimer.cancel();
  state.gifPlayer.stop();
  cancelMovement();
  hideBubble(true);
  hoverAnchor = null;
  if (clearPending) {
    state.pendingClick = null;
    clearTimeout(clickTimer);
    clickTimer = null;
  }
}

function rememberAsset(assetId) {
  state.recent = pushRecent(
    state.recent,
    assetId,
    manifest.rules.recentLimit,
  );
}

function pickAction(trigger) {
  const pool =
    trigger === "double-click" ? manifest.gifActions : manifest.actions;
  const weight = (assetId) => {
    if (trigger !== "single-click") return 1;
    return assets[assetId].kind === "static" ? 2 : 1;
  };
  return pickWithRecent(
    pool,
    state.recent,
    weight,
    Math.random,
    manifest.rules.recentLimit,
  );
}

function enterDaily() {
  stopCurrent();
  setMode("daily");
  state.dailyCycle += 1;
  stage.dataset.dailyCycle = String(state.dailyCycle);
  stage.dataset.behaviorTrigger = "";
  state.currentDaily = pickUniform(manifest.daily);
  state.currentHoverId = null;
  renderFrame(state.currentDaily.idle, 0);
  const delay = randomBetween(
    manifest.rules.dailyDelayMs.min,
    manifest.rules.dailyDelayMs.max,
  );
  state.dailyTimer.start(delay);
  if (state.manualPaused || state.fullscreenPaused) {
    state.dailyTimer.pause();
  }
}

function enterHover() {
  if (state.mode !== "daily" || !state.currentDaily) return;
  if (!captureHoverAnchor()) return;
  state.dailyTimer.pause();
  state.hoverLeaveTimer.cancel();
  setMode("hover");
  state.currentHoverId = pickUniform(state.currentDaily.hovers);
  renderFrame(state.currentHoverId, 0);
}

function leaveHover() {
  if (state.mode !== "hover" || !state.currentDaily) return;
  state.hoverLeaveTimer.cancel();
  setMode("daily");
  state.currentHoverId = null;
  hoverAnchor = null;
  renderFrame(state.currentDaily.idle, 0);
  if (!state.manualPaused && !state.fullscreenPaused) {
    state.dailyTimer.resume();
  }
}

function finishAction() {
  const pending = state.pendingClick;
  state.pendingClick = null;
  if (pending) {
    executeClickIntent(pending);
  } else {
    enterDaily();
  }
}

function startAction(assetId, trigger = "automatic") {
  if (!assetId) {
    enterDaily();
    return;
  }
  stopCurrent();
  rememberAsset(assetId);
  const asset = assets[assetId];
  stage.dataset.behaviorTrigger = trigger;
  if (asset.kind === "gif") {
    setMode("action-gif");
    const loops = chooseGifLoopCount(
      asset.loopDurationMs,
      Math.random,
      manifest.rules.gifDurationMs.min,
      manifest.rules.gifDurationMs.max,
    );
    state.gifPlayer.start(assetId, loops, finishAction);
    showActionBubble(
      asset,
      asset.loopDurationMs * loops,
      trigger === "smoke-manual",
    );
    if (state.fullscreenPaused) state.gifPlayer.pause();
  } else {
    setMode("action-static");
    renderFrame(assetId, 0);
    const duration = randomBetween(
      manifest.rules.staticDurationMs.min,
      manifest.rules.staticDurationMs.max,
    );
    state.actionTimer.start(duration);
    showActionBubble(asset, duration, trigger === "smoke-manual");
    if (state.fullscreenPaused) state.actionTimer.pause();
  }
}

function executeClickIntent(kind) {
  const assetId = pickAction(kind === "double" ? "double-click" : "single-click");
  startAction(assetId, kind);
}

function queueOrExecuteClick(kind) {
  if (state.mode === "hidden" || state.fullscreenPaused) return;
  if (state.mode === "action-gif" && state.gifPlayer.isActive()) {
    if (kind === "double" || state.pendingClick !== "double") {
      state.pendingClick = kind;
    }
    return;
  }
  executeClickIntent(kind);
}

function movementEntries() {
  return Object.entries(manifest.movement).map(([name, entry]) => ({
    name,
    ...entry,
  }));
}

function scheduleMovementFrame(movement) {
  movement.raf = requestAnimationFrame((timestamp) =>
    advanceMovement(movement, timestamp),
  );
}

async function advanceMovement(movement, timestamp) {
  if (state.movement !== movement || movement.token !== state.movement.token) return;
  movement.raf = null;
  if (state.fullscreenPaused) return;
  if (movement.lastTimestamp === null) {
    movement.lastTimestamp = timestamp;
    scheduleMovementFrame(movement);
    return;
  }
  const elapsed = Math.min(100, Math.max(0, timestamp - movement.lastTimestamp));
  movement.lastTimestamp = timestamp;
  movement.remainingMs -= elapsed;
  if (movement.remainingMs <= 0) {
    cancelMovement();
    enterDaily();
    return;
  }

  const distance = (movement.speed * elapsed) / 1000;
  const delta =
    movement.axis === "horizontal"
      ? { x: movement.direction * distance, y: 0 }
      : { x: 0, y: movement.direction * distance };
  const token = movement.token;
  const result = await window.desktopPet.moveBy(delta);
  if (
    !state.movement ||
    state.movement !== movement ||
    state.movement.token !== token
  ) {
    return;
  }
  if (movement.axis === "horizontal" && result.hitX) {
    movement.direction *= -1;
    toggleFacing();
  } else if (movement.axis === "vertical" && result.hitY) {
    movement.direction *= -1;
  }
  scheduleMovementFrame(movement);
}

function startRandomMovement(trigger = "automatic") {
  const candidates = movementEntries();
  const allowedIds = pickWithRecent(
    candidates.map((entry) => entry.asset),
    state.recent,
    () => 1,
    Math.random,
    manifest.rules.recentLimit,
  );
  const selected =
    candidates.find((entry) => entry.asset === allowedIds) ||
    pickUniform(candidates);
  if (!selected) {
    enterDaily();
    return;
  }

  stopCurrent();
  rememberAsset(selected.asset);
  setMode("movement");
  stage.dataset.behaviorTrigger = trigger;
  renderFrame(selected.asset, 0);
  const movement = {
    name: selected.name,
    assetId: selected.asset,
    speed: selected.speed,
    axis: Math.random() < 0.5 ? "horizontal" : "vertical",
    direction: Math.random() < 0.5 ? -1 : 1,
    remainingMs: randomBetween(
      manifest.rules.movementDurationMs.min,
      manifest.rules.movementDurationMs.max,
    ),
    lastTimestamp: null,
    raf: null,
    token: 1,
  };
  state.movement = movement;
  if (!state.fullscreenPaused) {
    scheduleMovementFrame(movement);
  }
}

function automaticTrigger() {
  if (state.manualPaused || state.fullscreenPaused || state.mode !== "daily") {
    return;
  }
  if (Math.random() < manifest.rules.automaticActionProbability) {
    startAction(pickAction("automatic"), "automatic");
  } else {
    startRandomMovement("automatic");
  }
}

function pauseForFullscreen() {
  if (state.fullscreenPaused) return;
  state.fullscreenPaused = true;
  cancelPointerInteraction();
  state.dailyTimer.pause();
  state.actionTimer.pause();
  state.hoverLeaveTimer.pause();
  state.bubbleTimer.pause();
  state.gifPlayer.pause();
  if (state.movement?.raf !== null) {
    cancelAnimationFrame(state.movement.raf);
    state.movement.raf = null;
  }
  reportPointerRegion(false);
}

function resumeFromFullscreen() {
  if (!state.fullscreenPaused) return;
  state.fullscreenPaused = false;
  if (state.mode === "daily" && !state.manualPaused) {
    state.dailyTimer.resume();
  } else if (state.mode === "action-static") {
    state.actionTimer.resume();
  } else if (state.mode === "action-gif") {
    state.gifPlayer.resume();
  } else if (state.mode === "movement" && state.movement) {
    state.movement.lastTimestamp = null;
    scheduleMovementFrame(state.movement);
  }
  if (state.mode === "hover") {
    state.hoverLeaveTimer.resume();
  }
  if (speechBubble.classList.contains("visible")) {
    state.bubbleTimer.resume();
  }
}

function setManualPaused(value) {
  state.manualPaused = Boolean(value);
  if (state.mode !== "daily" && state.mode !== "hover") return;
  if (state.manualPaused) {
    state.dailyTimer.pause();
  } else if (!state.fullscreenPaused && state.mode === "daily") {
    state.dailyTimer.resume();
  }
}

function setUserScale(value) {
  const scale = Number(value);
  if (!manifest.rules.scaleOptions.includes(scale)) return;
  state.userScale = scale;
  stage.dataset.scale = String(scale);
  updateGeometry();
}

function hideRuntime() {
  cancelPointerInteraction();
  stopCurrent({ clearPending: true });
  setMode("hidden");
  state.currentDaily = null;
  state.currentHoverId = null;
  reportPointerRegion(false);
}

function callBack(payload) {
  stopCurrent({ clearPending: true });
  state.recent = [];
  state.facing = 1;
  state.manualPaused = Boolean(payload.paused);
  state.clickThrough = Boolean(payload.clickThrough);
  state.userScale = Number(payload.scale) || 1;
  petImage.style.setProperty("--facing", "1");
  enterDaily();
}

function handleCommand(payload) {
  const { command } = payload;
  switch (command) {
    case "random-action":
      stopCurrent({ clearPending: true });
      startAction(pickAction("menu"), "menu");
      break;
    case "random-movement":
      stopCurrent({ clearPending: true });
      startRandomMovement("menu");
      break;
    case "set-paused":
      setManualPaused(payload.value);
      break;
    case "set-click-through":
      state.clickThrough = Boolean(payload.value);
      if (state.clickThrough) cancelPointerInteraction();
      if (state.clickThrough && state.mode === "hover") leaveHover();
      reportPointerRegion(false);
      break;
    case "set-scale":
      setUserScale(payload.value);
      break;
    case "user-hide":
      hideRuntime();
      break;
    case "call-back":
      callBack(payload);
      break;
    case "fullscreen-pause":
      pauseForFullscreen();
      break;
    case "fullscreen-resume":
      resumeFromFullscreen();
      break;
    default:
      break;
  }
}

function updatePointerPosition(clientX, clientY) {
  if (!state || state.mode === "hidden" || state.clickThrough) {
    reportPointerRegion(false);
    return;
  }
  if (pointerState) {
    reportPointerRegion(true);
    return;
  }
  const tolerance =
    state.mode === "daily" || state.mode === "hover"
      ? manifest.rules.hoverTolerance
      : 0;
  const overPet =
    hitTest(clientX, clientY, tolerance) ||
    (state.mode === "hover" &&
      hitTestHoverAnchor(clientX, clientY, tolerance));
  reportPointerRegion(overPet);

  if (state.mode === "daily" && overPet) {
    enterHover();
  } else if (state.mode === "hover") {
    if (overPet) {
      state.hoverLeaveTimer.cancel();
    } else if (!state.hoverLeaveTimer.isActive()) {
      state.hoverLeaveTimer.start(manifest.rules.hoverLeaveDelayMs);
      if (state.fullscreenPaused) state.hoverLeaveTimer.pause();
    }
  }
}

async function pollPointerPosition() {
  if (
    pointerPollInFlight ||
    !state ||
    (state.mode !== "daily" && state.mode !== "hover") ||
    state.clickThrough ||
    state.fullscreenPaused
  ) {
    return;
  }
  pointerPollInFlight = true;
  try {
    const point = await window.desktopPet.getPointerPosition();
    if (!point) return;
    lastPointerPosition = {
      x: Number(point.clientX),
      y: Number(point.clientY),
    };
    updatePointerPosition(lastPointerPosition.x, lastPointerPosition.y);
    pointerPollWarningShown = false;
  } catch (error) {
    if (!pointerPollWarningShown) {
      pointerPollWarningShown = true;
      console.warn("无法读取系统光标位置：", error);
    }
  } finally {
    pointerPollInFlight = false;
  }
}

function schedulePointerPoll() {
  if (pointerPollStopped) return;
  clearTimeout(pointerPollTimer);
  const interactive =
    state &&
    (state.mode === "daily" || state.mode === "hover") &&
    !state.clickThrough &&
    !state.fullscreenPaused;
  pointerPollTimer = setTimeout(async () => {
    await pollPointerPosition();
    schedulePointerPoll();
  }, interactive ? POINTER_POLL_INTERVAL_MS : 400);
}

window.addEventListener("mousemove", (event) => {
  lastPointerPosition = { x: event.clientX, y: event.clientY };
  updatePointerPosition(event.clientX, event.clientY);
});
window.addEventListener("mouseleave", () => {
  if (!pointerState) reportPointerRegion(false);
  if (state?.mode === "hover" && !state.hoverLeaveTimer.isActive()) {
    state.hoverLeaveTimer.start(manifest.rules.hoverLeaveDelayMs);
    if (state.fullscreenPaused) state.hoverLeaveTimer.pause();
  }
});

stage.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || state.clickThrough || !hitTest(event.clientX, event.clientY, 0)) {
    return;
  }
  pointerState = {
    id: event.pointerId,
    startX: event.screenX,
    startY: event.screenY,
    moved: false,
  };
  stage.setPointerCapture(event.pointerId);
  window.desktopPet.dragStart({
    screenX: event.screenX,
    screenY: event.screenY,
  });
});

stage.addEventListener("pointermove", async (event) => {
  if (!pointerState || pointerState.id !== event.pointerId) return;
  const distance = Math.hypot(
    event.screenX - pointerState.startX,
    event.screenY - pointerState.startY,
  );
  if (distance > DRAG_THRESHOLD && !pointerState.moved) {
    pointerState.moved = true;
    beginDragVisual();
    window.desktopPet.dragStart({
      screenX: event.screenX,
      screenY: event.screenY,
    });
  }
  if (!pointerState.moved) return;
  const result = await window.desktopPet.dragMove({
    screenX: event.screenX,
    screenY: event.screenY,
  });
  if (
    !pointerState ||
    pointerState.id !== event.pointerId ||
    !pointerState.moved
  ) {
    return;
  }
  if (result?.flipHorizontal) toggleFacing();
});

function cancelPointerInteraction() {
  if (!pointerState) {
    endDragVisual();
    window.desktopPet.dragEnd();
    return;
  }
  const pointerId = pointerState.id;
  pointerState = null;
  if (stage.hasPointerCapture(pointerId)) {
    stage.releasePointerCapture(pointerId);
  }
  endDragVisual();
  window.desktopPet.dragEnd();
}

function finishPointer(event) {
  if (!pointerState || pointerState.id !== event.pointerId) return;
  const moved = pointerState.moved;
  if (moved) {
    suppressClickUntil = Date.now() + 400;
  }
  pointerState = null;
  if (stage.hasPointerCapture(event.pointerId)) {
    stage.releasePointerCapture(event.pointerId);
  }
  endDragVisual();
  window.desktopPet.dragEnd();
  if (lastPointerPosition) {
    queueMicrotask(() =>
      updatePointerPosition(lastPointerPosition.x, lastPointerPosition.y),
    );
  }
}

stage.addEventListener("pointerup", finishPointer);
stage.addEventListener("pointercancel", finishPointer);
stage.addEventListener("lostpointercapture", (event) => {
  if (pointerState?.id === event.pointerId) cancelPointerInteraction();
});

stage.addEventListener("click", () => {
  if (Date.now() < suppressClickUntil) return;
  clearTimeout(clickTimer);
  clickTimer = setTimeout(
    () => queueOrExecuteClick("single"),
    DOUBLE_CLICK_DELAY_MS,
  );
});

stage.addEventListener("dblclick", () => {
  if (Date.now() < suppressClickUntil) return;
  clearTimeout(clickTimer);
  clickTimer = null;
  queueOrExecuteClick("double");
});

window.addEventListener("contextmenu", (event) => {
  if (state.clickThrough || !hitTest(event.clientX, event.clientY, 0)) return;
  event.preventDefault();
  window.desktopPet.openMenu();
});

async function initialize() {
  const bootstrap = await window.desktopPet.getBootstrap();
  manifest = bootstrap.manifest;
  assets = manifest.assets;
  windowSize = bootstrap.window;
  state = {
    mode: "starting",
    currentAssetId: null,
    currentFrameIndex: 0,
    currentDaily: null,
    currentHoverId: null,
    facing: 1,
    recent: [],
    pendingClick: null,
    manualPaused: Boolean(bootstrap.runtime.paused),
    clickThrough: Boolean(bootstrap.runtime.clickThrough),
    userScale: Number(bootstrap.runtime.scale) || 1,
    fullscreenPaused: false,
    movement: null,
    dragSnapshot: null,
    dailyCycle: 0,
    dailyTimer: null,
    actionTimer: null,
    hoverLeaveTimer: null,
    bubbleTimer: null,
    gifPlayer: new GifPlayer(),
  };
  state.dailyTimer = new PausableTimer(automaticTrigger);
  state.actionTimer = new PausableTimer(finishAction);
  state.hoverLeaveTimer = new PausableTimer(leaveHover);
  state.bubbleTimer = new PausableTimer(hideBubble);
  window.desktopPet.onCommand(handleCommand);
  stage.dataset.scale = String(state.userScale);
  setFacing(1);
  enterDaily();
  showOpeningBubble();
  schedulePointerPoll();
}

window.addEventListener("beforeunload", () => {
  pointerPollStopped = true;
  clearTimeout(pointerPollTimer);
  clearTimeout(bubbleShapeReleaseTimer);
});

initialize().catch((error) => {
  console.error("糖猫桌宠初始化失败：", error);
});
