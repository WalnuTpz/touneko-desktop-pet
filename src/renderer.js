const stage = document.querySelector("#pet-stage");
const petImage = document.querySelector("#pet-image");
const speechBubble = document.querySelector("#speech-bubble");
const {
  PausableTimer,
  THROW_MAX_SPEED,
  chooseGifLoopCount,
  decelerateVelocity,
  estimateReleaseVelocity,
  pickUniform,
  pickWeighted,
  pickWithRecent,
  pushRecent,
  randomBetween,
  reflectVelocity,
  shortestAngleDelta,
  validCycleCounts,
} = window.PetCore;
const {
  bubbleMessageForAction,
  dialogueForAction,
  openingDialogueForLaunch,
} = window.PetDialogue;

const DEVELOPMENT_GENERATED_ROOT = new URL(
  "../assets/generated/",
  window.location.href,
);
const DOUBLE_CLICK_DELAY_MS = 280;
const DRAG_THRESHOLD = 5;
const BASELINE_MARGIN = 18;
const POINTER_POLL_INTERVAL_MS = 80;
const PLAY_POINTER_POLL_INTERVAL_MS = 50;
const PET_SHAPE_PADDING = 8;
const BUBBLE_GAP = 17;
const THROW_TRIGGER_SPEED = 900;
const THROW_DECELERATION = 700;
const THROW_STOP_SPEED = 60;
const THROW_BOUNCE_RETENTION = 0.7;
const PLAY_DURATION_MS = 90_000;
const PLAY_APPROACH_START_DISTANCE = 260;
const PLAY_APPROACH_STOP_DISTANCE = 160;
const PLAY_SWAT_DISTANCE = 100;
const PLAY_SWAT_DURATION_MS = 1200;
const PLAY_SWAT_COOLDOWN_MS = 4000;
const PLAY_CIRCLE_MIN_RADIUS = 80;
const PLAY_CIRCLE_MAX_RADIUS = 260;
const PLAY_CIRCLE_WINDOW_MS = 3000;
const PLAY_CIRCLE_ANGLE = (300 * Math.PI) / 180;
const PLAY_CIRCLE_DURATION_MS = 2000;
const PLAY_CIRCLE_COOLDOWN_MS = 6000;
const PLAY_CHASE_MIN_DELAY_MS = 10_000;
const PLAY_CHASE_MAX_DELAY_MS = 16_000;
const PLAY_CHASE_MIN_DURATION_MS = 2000;
const PLAY_CHASE_MAX_DURATION_MS = 4000;
const PLAY_CHASE_STOP_DISTANCE = 80;
const POINTER_SLOW_SPEED = 180;
const PERSONALITY_PROFILES = Object.freeze({
  quiet: Object.freeze({
    dailyDelayMs: Object.freeze({ min: 35_000, max: 50_000 }),
    actionProbability: 0.85,
  }),
  default: Object.freeze({
    dailyDelayMs: Object.freeze({ min: 20_000, max: 30_000 }),
    actionProbability: 0.66,
  }),
  active: Object.freeze({
    dailyDelayMs: Object.freeze({ min: 10_000, max: 18_000 }),
    actionProbability: 0.55,
  }),
});
const SLEEP_ACTION_IDS = new Set([
  "sleep-after-meal",
  "prone-2",
  "sleep",
  "recliner",
]);
const WORK_ACTION_IDS = new Set(["iv-drip", "writing", "read-book"]);

let manifest = null;
let assets = null;
let assetBaseUrl = DEVELOPMENT_GENERATED_ROOT.href;
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
const gifFrameCache = new Map();
const staticFrameCache = new Map();

function cancelDelayedSingleClick() {
  clearTimeout(clickTimer);
  clickTimer = null;
}

function scheduleSingleClick() {
  cancelDelayedSingleClick();
  clickTimer = setTimeout(() => {
    clickTimer = null;
    handleClickIntent("single");
  }, DOUBLE_CLICK_DELAY_MS);
}

const hitCanvas = document.createElement("canvas");
const hitContext = hitCanvas.getContext("2d", { willReadFrequently: true });
const hoverAnchorCanvas = document.createElement("canvas");
const hoverAnchorContext = hoverAnchorCanvas.getContext("2d", {
  willReadFrequently: true,
});

function assetUrl(relativePath) {
  return new URL(relativePath, assetBaseUrl).href;
}

function primeGifFrames(assetId) {
  if (gifFrameCache.has(assetId)) return gifFrameCache.get(assetId).promise;
  const asset = assets?.[assetId];
  if (!asset || asset.kind !== "gif") return Promise.resolve();
  const images = asset.frames.map((frame) => {
    const image = new Image();
    image.decoding = "async";
    image.loading = "eager";
    image.src = assetUrl(frame.file);
    return image;
  });
  const promise = Promise.all(images.map((image) => image.decode()))
    .then(() => images)
    .catch((error) => {
      gifFrameCache.delete(assetId);
      throw error;
    });
  gifFrameCache.set(assetId, { images, promise });
  return promise;
}

function primeStaticFrame(assetId) {
  if (staticFrameCache.has(assetId)) {
    return staticFrameCache.get(assetId).promise;
  }
  const image = new Image();
  image.decoding = "async";
  image.loading = "eager";
  image.src = assetUrl(assets[assetId].frames[0].file);
  const promise = image.decode().catch((error) => {
    staticFrameCache.delete(assetId);
    throw error;
  });
  staticFrameCache.set(assetId, { image, promise });
  return promise;
}

function primeMovementAnimations() {
  const tasks = [];
  for (const behavior of Object.values(manifest.movement)) {
    if (behavior.animation.type === "gif") {
      tasks.push(primeGifFrames(behavior.animation.asset));
    } else {
      for (const frame of behavior.animation.frames) {
        tasks.push(primeStaticFrame(frame.asset));
      }
    }
  }
  return Promise.all(tasks);
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

function setVerticalFacing(value) {
  state.facingY = value < 0 ? -1 : 1;
  petImage.style.setProperty("--facing-y", String(state.facingY));
  updateGeometry();
}

function resetVerticalFacing() {
  if (state.facingY !== 1) setVerticalFacing(1);
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
  const sourceY =
    state.facingY > 0
      ? sourceBounds.y
      : asset.canvas.height - sourceBounds.y - sourceBounds.height;
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
      y: imageTop + sourceY * scale - padding,
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
    queueMicrotask(() => updatePointerPosition(lastPointerPosition));
  }
});

petImage.addEventListener("error", () => {
  imageLoaded = false;
  console.error("桌宠素材载入失败：", petImage.src);
  window.desktopPet.reportFailure(`桌宠素材载入失败：${petImage.src}`);
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
  let y = clientY - geometry.imageTop;
  if (state.facing < 0) {
    x = geometry.imageWidth - x;
  }
  if (state.facingY < 0) {
    y = geometry.imageHeight - y;
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
    this.pending = false;
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
    const token = this.token;
    this.pending = true;
    this.remainingMs = assets[assetId].frames[0].durationMs;
    primeGifFrames(assetId)
      .then(async () => {
        if (token !== this.token || this.assetId !== assetId) return;
        renderFrame(assetId, 0);
        await petImage.decode();
        if (token !== this.token || this.assetId !== assetId) return;
        this.pending = false;
        if (!this.paused) this.#arm(token);
      })
      .catch((error) => {
        if (token !== this.token || this.assetId !== assetId) return;
        this.stop();
        window.desktopPet.reportFailure(
          `GIF 帧预载失败：${error?.message || error}`,
        );
      });
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
    if (!this.assetId || this.paused) return;
    if (this.pending || this.timeout === null) {
      this.paused = true;
      return;
    }
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
    this.paused = false;
    if (this.pending) return;
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
    this.pending = false;
    this.onComplete = null;
    this.token += 1;
  }

  isActive() {
    return Boolean(this.assetId);
  }
}

class SequencePlayer {
  constructor() {
    this.frames = [];
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

  start(frames, targetLoops = Infinity, onComplete = null) {
    this.stop();
    this.frames = frames;
    this.frameIndex = 0;
    this.completedLoops = 0;
    this.targetLoops = Math.max(1, targetLoops);
    this.onComplete = onComplete;
    this.token += 1;
    renderFrame(frames[0].asset, 0);
    this.remainingMs = frames[0].durationMs;
    this.#arm(this.token);
  }

  #arm(token) {
    this.paused = false;
    this.startedAt = performance.now();
    this.timeout = setTimeout(() => this.#advance(token), this.remainingMs);
  }

  #advance(token) {
    if (token !== this.token || this.frames.length === 0) return;
    this.timeout = null;
    this.frameIndex += 1;
    if (this.frameIndex >= this.frames.length) {
      this.frameIndex = 0;
      this.completedLoops += 1;
      if (this.completedLoops >= this.targetLoops) {
        const callback = this.onComplete;
        this.stop();
        callback?.();
        return;
      }
    }
    const frame = this.frames[this.frameIndex];
    renderFrame(frame.asset, 0);
    this.remainingMs = frame.durationMs;
    this.#arm(token);
  }

  pause() {
    if (this.frames.length === 0 || this.paused) return;
    clearTimeout(this.timeout);
    this.timeout = null;
    this.remainingMs = Math.max(
      0,
      this.remainingMs - (performance.now() - this.startedAt),
    );
    this.paused = true;
  }

  resume() {
    if (this.frames.length === 0 || !this.paused) return;
    this.#arm(this.token);
  }

  stop() {
    clearTimeout(this.timeout);
    this.timeout = null;
    this.frames = [];
    this.frameIndex = 0;
    this.completedLoops = 0;
    this.remainingMs = 0;
    this.paused = false;
    this.onComplete = null;
    this.token += 1;
  }

  isActive() {
    return this.frames.length > 0;
  }
}

function animationCycleDuration(animation) {
  if (animation.type === "gif") {
    return assets[animation.asset].loopDurationMs;
  }
  return animation.frames.reduce(
    (total, frame) => total + frame.durationMs,
    0,
  );
}

function startMotionAnimation(animation, loops = Infinity, onComplete = null) {
  state.gifPlayer.stop();
  state.sequencePlayer.stop();
  if (animation.type === "gif") {
    state.gifPlayer.start(animation.asset, loops, onComplete);
  } else {
    state.sequencePlayer.start(animation.frames, loops, onComplete);
  }
}

function pauseMotionAnimation() {
  state.gifPlayer.pause();
  state.sequencePlayer.pause();
}

function resumeMotionAnimation() {
  state.gifPlayer.resume();
  state.sequencePlayer.resume();
}

function stopMotionAnimation() {
  state.gifPlayer.stop();
  state.sequencePlayer.stop();
}

function cancelMovement() {
  if (!state.movement) return;
  state.movement.token += 1;
  if (state.movement.raf !== null) {
    cancelAnimationFrame(state.movement.raf);
  }
  state.movement = null;
  stopMotionAnimation();
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
  state.dragContext = { fromPlay: Boolean(state.play) };
  state.dailyTimer.cancel();
  state.actionTimer.cancel();
  state.hoverLeaveTimer.cancel();
  state.bubbleTimer.cancel();
  state.gifPlayer.stop();
  state.sequencePlayer.stop();
  cancelMovement();
  state.playReactionTimer.cancel();
  state.playChaseAttemptTimer.cancel();
  restorePlaySwatFacing();
  cancelDelayedSingleClick();
  hideBubble(true);
  hoverAnchor = null;
  setMode("dragging");
  stage.classList.add("dragging");
  resetVerticalFacing();
  renderFrame(manifest.dragAsset, 0);
}

function endDragVisual() {
  stage.classList.remove("dragging");
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
    ? dialogueForAction(asset.dialogueId, () => 0)
    : bubbleMessageForAction(asset.dialogueId);
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
  state.sequencePlayer.stop();
  cancelMovement();
  hideBubble(true);
  hoverAnchor = null;
  if (clearPending) {
    cancelDelayedSingleClick();
  }
}

function rememberAsset(assetId) {
  state.recent = pushRecent(
    state.recent,
    assetId,
    manifest.rules.recentLimit,
  );
}

function environmentPreference() {
  if (!state.environmentAwareness) return null;
  if (state.environment.workBias) return "work";
  if (state.environment.night || state.environment.idle) return "sleep";
  return null;
}

function actionEnvironmentWeight(assetId) {
  const preference = environmentPreference();
  if (preference === "work" && WORK_ACTION_IDS.has(assetId)) return 3;
  if (preference === "sleep" && SLEEP_ACTION_IDS.has(assetId)) return 3;
  return 1;
}

function pickAction(trigger) {
  const pool =
    trigger === "double-click" ? manifest.gifActions : manifest.actions;
  const weight = (assetId) => {
    if (trigger === "automatic") return actionEnvironmentWeight(assetId);
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

function pickDaily() {
  const preference = environmentPreference();
  return pickWeighted(manifest.daily, (entry) => {
    if (preference === "work" && entry.id === "daily-3") return 3;
    if (preference === "sleep" && entry.id === "daily-7") return 3;
    return 1;
  });
}

function currentPersonality() {
  return PERSONALITY_PROFILES[state.personality];
}

function startDailyTimer() {
  const delayRange = currentPersonality().dailyDelayMs;
  state.dailyTimer.start(randomBetween(delayRange.min, delayRange.max));
  if (
    state.manualPaused ||
    state.fullscreenPaused ||
    state.mode === "hover"
  ) {
    state.dailyTimer.pause();
  }
}

function restorePlaySwatFacing() {
  const facing = state.play?.swatBaseFacing;
  if (!facing) return;
  state.play.swatBaseFacing = null;
  setFacing(facing);
}

function stopPlaySession(report = true) {
  if (!state.play) return;
  restorePlaySwatFacing();
  state.playTimer.cancel();
  state.playReactionTimer.cancel();
  state.playChaseAttemptTimer.cancel();
  state.play = null;
  if (report) window.desktopPet.reportPlaying(false);
}

function enterDaily() {
  stopCurrent();
  stopPlaySession();
  state.dragContext = null;
  resetVerticalFacing();
  setMode("daily");
  state.dailyCycle += 1;
  stage.dataset.dailyCycle = String(state.dailyCycle);
  stage.dataset.behaviorTrigger = "";
  state.currentDaily = pickDaily();
  state.currentHoverId = null;
  renderFrame(state.currentDaily.idle, 0);
  startDailyTimer();
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
  enterDaily();
}

function startAction(assetId, trigger = "automatic") {
  if (!assetId) {
    enterDaily();
    return;
  }
  stopCurrent();
  stopPlaySession();
  resetVerticalFacing();
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

function handleClickIntent(kind) {
  if (
    state.mode === "hidden" ||
    state.mode === "playing" ||
    state.mode.startsWith("play-") ||
    state.mode === "throwing" ||
    state.mode === "landing" ||
    state.mode === "dragging" ||
    state.fullscreenPaused
  ) {
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

function integerMovementDelta(movement, desiredX, desiredY) {
  movement.remainder.x += desiredX;
  movement.remainder.y += desiredY;
  const x = Math.trunc(movement.remainder.x);
  const y = Math.trunc(movement.remainder.y);
  movement.remainder.x -= x;
  movement.remainder.y -= y;
  return { x, y };
}

function setMovementFacing(direction, sourceFacing) {
  const sourceDirection = sourceFacing === "left" ? -1 : 1;
  setFacing(direction * sourceDirection);
}

function finishAutonomousMovement(movement) {
  if (state.movement !== movement || state.mode !== "movement") return;
  cancelMovement();
  enterDaily();
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

  if (movement.kind === "throw") {
    await advanceThrow(movement, elapsed);
    return;
  }

  if (movement.kind.startsWith("play-")) {
    await advancePlayMovement(movement, elapsed);
    return;
  }

  const distance = (movement.speed * elapsed) / 1000;
  const desired =
    movement.axis === "horizontal"
      ? { x: movement.direction * distance, y: 0 }
      : { x: 0, y: movement.direction * distance };
  const delta = integerMovementDelta(movement, desired.x, desired.y);
  if (delta.x === 0 && delta.y === 0) {
    scheduleMovementFrame(movement);
    return;
  }
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
    movement.remainder.x = 0;
    movement.direction *= -1;
    setMovementFacing(movement.direction, movement.sourceFacing);
  } else if (movement.axis === "vertical" && result.hitY) {
    movement.remainder.y = 0;
    movement.direction *= -1;
  }
  scheduleMovementFrame(movement);
}

function startRandomMovement(trigger = "automatic") {
  const candidates = movementEntries();
  const selected = pickUniform(candidates);
  if (!selected) {
    enterDaily();
    return;
  }

  stopCurrent();
  stopPlaySession();
  resetVerticalFacing();
  setMode("movement");
  stage.dataset.behaviorTrigger = trigger;
  const cycleDurationMs = animationCycleDuration(selected.animation);
  const cycleCount = pickUniform(
    validCycleCounts(
      cycleDurationMs,
      manifest.rules.movementDurationMs.min,
      manifest.rules.movementDurationMs.max,
    ),
  );
  const movement = {
    kind: "autonomous",
    name: selected.name,
    speed: selected.speed,
    sourceFacing: selected.sourceFacing,
    axis: pickUniform(selected.axes),
    direction: Math.random() < 0.5 ? -1 : 1,
    cycleCount,
    durationMs: cycleDurationMs * cycleCount,
    lastTimestamp: null,
    raf: null,
    remainder: { x: 0, y: 0 },
    token: 1,
  };
  if (movement.axis === "horizontal") {
    setMovementFacing(movement.direction, movement.sourceFacing);
  }
  state.movement = movement;
  startMotionAnimation(selected.animation, cycleCount, () =>
    finishAutonomousMovement(movement),
  );
  if (!state.fullscreenPaused) {
    scheduleMovementFrame(movement);
  } else {
    pauseMotionAnimation();
  }
}

function automaticTrigger() {
  if (state.manualPaused || state.fullscreenPaused || state.mode !== "daily") {
    return;
  }
  if (Math.random() < currentPersonality().actionProbability) {
    startAction(pickAction("automatic"), "automatic");
  } else {
    startRandomMovement("automatic");
  }
}

function setThrowFacing(velocity) {
  if (velocity.x !== 0) setFacing(velocity.x < 0 ? -1 : 1);
  if (velocity.y !== 0) setVerticalFacing(velocity.y < 0 ? 1 : -1);
}

function startThrow(velocity) {
  stopCurrent({ clearPending: true });
  stopPlaySession();
  setMode("throwing");
  stage.dataset.behaviorTrigger = "throw";
  renderFrame(manifest.throwBehavior.asset, 0);
  setThrowFacing(velocity);
  const movement = {
    kind: "throw",
    velocity: { x: velocity.x, y: velocity.y, speed: velocity.speed },
    lastTimestamp: null,
    raf: null,
    remainder: { x: 0, y: 0 },
    token: 1,
  };
  state.movement = movement;
  if (!state.fullscreenPaused) scheduleMovementFrame(movement);
}

function finishThrow(movement) {
  if (state.movement !== movement) return;
  cancelMovement();
  resetVerticalFacing();
  const assetId = pickWithRecent(
    manifest.throwBehavior.landingActions,
    state.recent,
    () => 1,
    Math.random,
    manifest.rules.recentLimit,
  );
  rememberAsset(assetId);
  setMode("landing");
  stage.dataset.behaviorTrigger = "throw-landing";
  renderFrame(assetId, 0);
  state.actionTimer.start(
    randomBetween(
      manifest.rules.staticDurationMs.min,
      manifest.rules.staticDurationMs.max,
    ),
  );
  if (state.fullscreenPaused) state.actionTimer.pause();
}

async function advanceThrow(movement, elapsedMs) {
  const distanceScale = elapsedMs / 1000;
  const token = movement.token;
  const delta = integerMovementDelta(
    movement,
    movement.velocity.x * distanceScale,
    movement.velocity.y * distanceScale,
  );
  const result =
    delta.x === 0 && delta.y === 0
      ? { hitX: 0, hitY: 0 }
      : await window.desktopPet.moveBy(delta);
  if (state.movement !== movement || movement.token !== token) return;
  if (result.hitX) movement.remainder.x = 0;
  if (result.hitY) movement.remainder.y = 0;
  const reflected = reflectVelocity(
    movement.velocity,
    result.hitX,
    result.hitY,
    THROW_BOUNCE_RETENTION,
  );
  movement.velocity = decelerateVelocity(
    reflected,
    THROW_DECELERATION,
    elapsedMs,
  );
  setThrowFacing(movement.velocity);
  if (movement.velocity.speed < THROW_STOP_SPEED) {
    finishThrow(movement);
    return;
  }
  scheduleMovementFrame(movement);
}

function petCenter() {
  const asset = currentAsset();
  const frame = currentFrame();
  const collision = geometryFor(asset, frame).collision;
  return {
    x: collision.x + collision.width / 2,
    y: collision.y + collision.height / 2,
  };
}

function schedulePlayChaseAttempt() {
  if (!state.play) return;
  state.playChaseAttemptTimer.start(
    randomBetween(
      PLAY_CHASE_MIN_DELAY_MS,
      PLAY_CHASE_MAX_DELAY_MS,
    ),
  );
}

function renderPlayIdle() {
  setMode("playing");
  resetVerticalFacing();
  if (!state.currentDaily) state.currentDaily = pickDaily();
  renderFrame(state.currentDaily.idle, 0);
}

function resumePlayIdle() {
  if (!state.play) return;
  if (state.play.expired) {
    enterDaily();
    return;
  }
  restorePlaySwatFacing();
  cancelMovement();
  state.playReactionTimer.cancel();
  renderPlayIdle();
  schedulePlayChaseAttempt();
}

function onPlayExpired() {
  if (!state.play) return;
  if (state.mode === "dragging" && state.dragContext?.fromPlay) {
    state.play.expired = true;
    return;
  }
  enterDaily();
}

function startPlay() {
  if (
    state.fullscreenPaused ||
    state.play ||
    state.mode === "hidden" ||
    state.mode === "throwing"
  ) {
    return;
  }
  stopCurrent({ clearPending: true });
  state.currentDaily = pickDaily();
  state.currentHoverId = null;
  state.play = {
    expired: false,
    cursor: null,
    lastSample: null,
    circleSamples: [],
    swatBaseFacing: null,
    cooldownUntil: {
      circle: 0,
      swat: 0,
    },
  };
  stage.dataset.behaviorTrigger = "play";
  renderPlayIdle();
  state.playTimer.start(PLAY_DURATION_MS);
  schedulePlayChaseAttempt();
  schedulePointerPoll();
  window.desktopPet.reportPlaying(true);
}

function startPlayReaction(mode, assetId, durationMs) {
  cancelMovement();
  state.playReactionTimer.cancel();
  state.playChaseAttemptTimer.cancel();
  setMode(mode);
  resetVerticalFacing();
  renderFrame(assetId, 0);
  state.playReactionTimer.start(durationMs);
}

function setPlayPointerFacing(direction) {
  const greetingSwat =
    state.mode === "play-swat" &&
    currentAsset()?.id === manifest.playBehavior.greetingAsset;
  state.play.swatBaseFacing = greetingSwat ? direction : null;
  setFacing(direction * (greetingSwat ? -1 : 1));
}

function startPlayMotion(kind, movementId, options = {}) {
  cancelMovement();
  state.playReactionTimer.cancel();
  if (kind !== "play-approach") {
    state.playChaseAttemptTimer.cancel();
  }
  const behavior = manifest.movement[movementId];
  const movement = {
    kind,
    speed: behavior.speed,
    sourceFacing: behavior.sourceFacing,
    direction: options.direction || null,
    endsAt: options.endsAt || null,
    stopDistance: options.stopDistance || null,
    lastTimestamp: null,
    raf: null,
    remainder: { x: 0, y: 0 },
    token: 1,
  };
  state.movement = movement;
  setMode(kind);
  startMotionAnimation(behavior.animation);
  if (movement.direction?.x) {
    setMovementFacing(
      movement.direction.x < 0 ? -1 : 1,
      movement.sourceFacing,
    );
  }
  scheduleMovementFrame(movement);
}

function startPlayConfused(now) {
  state.play.cooldownUntil.circle = now + PLAY_CIRCLE_COOLDOWN_MS;
  state.play.circleSamples = [];
  startPlayReaction(
    "play-confused",
    manifest.playBehavior.confusedAsset,
    PLAY_CIRCLE_DURATION_MS,
  );
}

function startPlaySwat(
  now,
  cursorDirection,
  assetId = pickUniform(manifest.playBehavior.swatAssets),
) {
  state.play.cooldownUntil.swat = now + PLAY_SWAT_COOLDOWN_MS;
  startPlayReaction("play-swat", assetId, PLAY_SWAT_DURATION_MS);
  setPlayPointerFacing(cursorDirection);
}

function tryStartPlayChase() {
  if (!state.play) return;
  if (state.mode !== "playing" && state.mode !== "play-approach") {
    schedulePlayChaseAttempt();
    return;
  }
  startPlayMotion("play-chase", "run", {
    endsAt:
      performance.now() +
      randomBetween(
        PLAY_CHASE_MIN_DURATION_MS,
        PLAY_CHASE_MAX_DURATION_MS,
      ),
    stopDistance: PLAY_CHASE_STOP_DISTANCE,
  });
}

function updateCircleSamples(now, cursor, center, distance) {
  if (
    distance < PLAY_CIRCLE_MIN_RADIUS ||
    distance > PLAY_CIRCLE_MAX_RADIUS
  ) {
    state.play.circleSamples = [];
    return false;
  }
  const angle = Math.atan2(cursor.clientY - center.y, cursor.clientX - center.x);
  const samples = state.play.circleSamples;
  samples.push({ time: now, angle });
  while (
    samples.length > 1 &&
    samples[0].time < now - PLAY_CIRCLE_WINDOW_MS
  ) {
    samples.shift();
  }
  let accumulated = 0;
  for (let index = 1; index < samples.length; index += 1) {
    accumulated += shortestAngleDelta(
      samples[index - 1].angle,
      samples[index].angle,
    );
  }
  return Math.abs(accumulated) >= PLAY_CIRCLE_ANGLE;
}

function handlePlayPointer(point) {
  if (!state.play || state.fullscreenPaused) return;
  const now = performance.now();
  const center = petCenter();
  const deltaX = point.clientX - center.x;
  const deltaY = point.clientY - center.y;
  const distance = Math.hypot(deltaX, deltaY);
  const previous = state.play.lastSample;
  const elapsedSeconds = previous
    ? Math.max(0.001, (now - previous.time) / 1000)
    : 0;
  const cursorSpeed = previous
    ? Math.hypot(
        point.screenX - previous.screenX,
        point.screenY - previous.screenY,
      ) / elapsedSeconds
    : 0;
  state.play.cursor = point;
  state.play.lastSample = {
    screenX: point.screenX,
    screenY: point.screenY,
    time: now,
  };
  if (deltaX !== 0) {
    const direction = deltaX < 0 ? -1 : 1;
    if (state.movement?.kind.startsWith("play-")) {
      setMovementFacing(direction, state.movement.sourceFacing);
    } else {
      setPlayPointerFacing(direction);
    }
  }

  if (
    state.mode === "play-swat" ||
    state.mode === "play-confused"
  ) {
    return;
  }

  const circled = updateCircleSamples(now, point, center, distance);
  if (circled && now >= state.play.cooldownUntil.circle) {
    startPlayConfused(now);
    return;
  }
  if (
    distance <= PLAY_SWAT_DISTANCE &&
    cursorSpeed <= POINTER_SLOW_SPEED &&
    now >= state.play.cooldownUntil.swat
  ) {
    startPlaySwat(now, deltaX < 0 ? -1 : 1);
    return;
  }
  if (state.mode === "play-chase") return;
  if (distance > PLAY_APPROACH_START_DISTANCE) {
    if (state.mode !== "play-approach") {
      startPlayMotion("play-approach", "walk", {
        stopDistance: PLAY_APPROACH_STOP_DISTANCE,
      });
    }
  } else if (
    state.mode === "play-approach" &&
    distance <= PLAY_APPROACH_STOP_DISTANCE
  ) {
    resumePlayIdle();
  }
}

async function advancePlayMovement(movement, elapsedMs) {
  if (!state.play) {
    cancelMovement();
    return;
  }
  const now = performance.now();
  if (movement.endsAt && now >= movement.endsAt) {
    resumePlayIdle();
    return;
  }

  let direction = movement.direction;
  if (!direction) {
    const cursor = state.play.cursor;
    if (!cursor) {
      resumePlayIdle();
      return;
    }
    const center = petCenter();
    const deltaX = cursor.clientX - center.x;
    const deltaY = cursor.clientY - center.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= movement.stopDistance) {
      resumePlayIdle();
      return;
    }
    direction = { x: deltaX / distance, y: deltaY / distance };
  }

  if (direction.x !== 0) {
    setMovementFacing(
      direction.x < 0 ? -1 : 1,
      movement.sourceFacing,
    );
  }
  const token = movement.token;
  const distance = (movement.speed * elapsedMs) / 1000;
  const delta = integerMovementDelta(
    movement,
    direction.x * distance,
    direction.y * distance,
  );
  if (delta.x !== 0 || delta.y !== 0) {
    await window.desktopPet.moveBy(delta);
  }
  if (state.movement !== movement || movement.token !== token) return;
  scheduleMovementFrame(movement);
}

function pauseForFullscreen() {
  if (state.fullscreenPaused) return;
  const resetToDaily = Boolean(state.play) || state.mode === "dragging";
  state.fullscreenPaused = true;
  cancelPointerInteraction({ settle: false });
  if (resetToDaily) enterDaily();
  state.dailyTimer.pause();
  state.actionTimer.pause();
  state.hoverLeaveTimer.pause();
  state.bubbleTimer.pause();
  state.gifPlayer.pause();
  state.sequencePlayer.pause();
  if (state.movement) {
    state.movement.token += 1;
    if (state.movement.raf !== null) {
      cancelAnimationFrame(state.movement.raf);
      state.movement.raf = null;
    }
    state.movement.lastTimestamp = null;
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
    resumeMotionAnimation();
    state.movement.lastTimestamp = null;
    scheduleMovementFrame(state.movement);
  } else if (state.mode === "throwing" && state.movement) {
    state.movement.lastTimestamp = null;
    scheduleMovementFrame(state.movement);
  } else if (state.mode === "landing") {
    state.actionTimer.resume();
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

function setPersonality(value) {
  state.personality = value;
  if (state.mode === "daily" || state.mode === "hover") startDailyTimer();
}

function setUserScale(value) {
  const scale = Number(value);
  if (!manifest.rules.scaleOptions.includes(scale)) return;
  state.userScale = scale;
  stage.dataset.scale = String(scale);
  updateGeometry();
}

function hideRuntime() {
  cancelPointerInteraction({ settle: false });
  stopCurrent({ clearPending: true });
  stopPlaySession();
  resetVerticalFacing();
  setMode("hidden");
  state.currentDaily = null;
  state.currentHoverId = null;
  reportPointerRegion(false);
}

function callBack(payload) {
  stopCurrent({ clearPending: true });
  stopPlaySession();
  state.recent = [];
  state.facing = 1;
  state.facingY = 1;
  state.manualPaused = Boolean(payload.paused);
  state.clickThrough = Boolean(payload.clickThrough);
  state.userScale = Number(payload.scale) || 1;
  petImage.style.setProperty("--facing", "1");
  petImage.style.setProperty("--facing-y", "1");
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
    case "set-playing":
      if (payload.value) {
        startPlay();
      } else if (state.play) {
        enterDaily();
      }
      break;
    case "set-paused":
      setManualPaused(payload.value);
      break;
    case "set-personality":
      setPersonality(payload.value);
      break;
    case "set-environment-awareness":
      state.environmentAwareness = Boolean(payload.value);
      break;
    case "environment-state":
      state.environment = payload.environment;
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

function installSmokeApi(enabled) {
  if (!enabled) return;
  const api = {
    petImage,
    beginDragVisual,
    captureHoverAnchor,
    currentAsset,
    currentFrame,
    drawHitCanvas,
    endDragVisual,
    enterDaily,
    finishThrow,
    geometryFor,
    hitTest,
    hitTestHoverAnchor,
    renderFrame,
    resumePlayIdle,
    setFacing,
    setMode,
    startAction,
    startPlay,
    startPlaySwat,
    startThrow,
    stopCurrent,
    queueTestSingleClick() {
      scheduleSingleClick();
    },
  };
  Object.defineProperties(api, {
    assets: { get: () => assets },
    manifest: { get: () => manifest },
    state: { get: () => state },
  });
  Object.defineProperty(window, "__TANGMAO_SMOKE__", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze(api),
  });
}

function updatePointerPosition(point) {
  if (!state || state.mode === "hidden") {
    reportPointerRegion(false);
    return;
  }
  if (pointerState) {
    reportPointerRegion(true);
    return;
  }
  if (state.mode === "throwing") {
    reportPointerRegion(false);
    return;
  }
  if (state.play) {
    const overPet =
      !state.clickThrough && hitTest(point.clientX, point.clientY, 0);
    reportPointerRegion(overPet);
    handlePlayPointer(point);
    return;
  }
  if (state.clickThrough) {
    reportPointerRegion(false);
    return;
  }
  const tolerance =
    state.mode === "daily" || state.mode === "hover"
      ? manifest.rules.hoverTolerance
      : 0;
  const overPet =
    hitTest(point.clientX, point.clientY, tolerance) ||
    (state.mode === "hover" &&
      hitTestHoverAnchor(point.clientX, point.clientY, tolerance));
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
  const tracksPlay = Boolean(state?.play);
  if (
    pointerPollInFlight ||
    !state ||
    (!tracksPlay && state.mode !== "daily" && state.mode !== "hover") ||
    (!tracksPlay && state.clickThrough) ||
    state.fullscreenPaused
  ) {
    return;
  }
  pointerPollInFlight = true;
  try {
    const point = await window.desktopPet.getPointerPosition();
    if (!point) return;
    lastPointerPosition = {
      clientX: Number(point.clientX),
      clientY: Number(point.clientY),
      screenX: Number(point.screenX),
      screenY: Number(point.screenY),
    };
    updatePointerPosition(lastPointerPosition);
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
    ((state.play && !state.fullscreenPaused) ||
      ((state.mode === "daily" || state.mode === "hover") &&
        !state.clickThrough)) &&
    !state.fullscreenPaused;
  pointerPollTimer = setTimeout(async () => {
    await pollPointerPosition();
    schedulePointerPoll();
  }, state?.play
    ? PLAY_POINTER_POLL_INTERVAL_MS
    : interactive
      ? POINTER_POLL_INTERVAL_MS
      : 400);
}

window.addEventListener("mousemove", (event) => {
  lastPointerPosition = {
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
  };
  updatePointerPosition(lastPointerPosition);
});
window.addEventListener("mouseleave", () => {
  if (!pointerState) reportPointerRegion(false);
  if (state?.mode === "hover" && !state.hoverLeaveTimer.isActive()) {
    state.hoverLeaveTimer.start(manifest.rules.hoverLeaveDelayMs);
    if (state.fullscreenPaused) state.hoverLeaveTimer.pause();
  }
});

stage.addEventListener("pointerdown", (event) => {
  if (
    event.button !== 0 ||
    state.clickThrough ||
    state.fullscreenPaused ||
    state.mode === "throwing" ||
    state.mode === "landing" ||
    !hitTest(event.clientX, event.clientY, 0)
  ) {
    return;
  }
  const now = performance.now();
  pointerState = {
    id: event.pointerId,
    startX: event.screenX,
    startY: event.screenY,
    moved: false,
    samples: [{ x: event.screenX, y: event.screenY, time: now }],
  };
  stage.setPointerCapture(event.pointerId);
  window.desktopPet.dragStart({
    screenX: event.screenX,
    screenY: event.screenY,
  });
});

stage.addEventListener("pointermove", async (event) => {
  if (!pointerState || pointerState.id !== event.pointerId) return;
  const now = performance.now();
  pointerState.samples.push({
    x: event.screenX,
    y: event.screenY,
    time: now,
  });
  pointerState.samples = pointerState.samples.filter(
    (sample) => sample.time >= now - 300,
  );
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

function settleCancelledDrag(context) {
  if (context?.fromPlay && state.play && !state.play.expired) {
    resumePlayIdle();
  } else {
    enterDaily();
  }
}

function cancelPointerInteraction({ settle = true } = {}) {
  const interaction = pointerState;
  if (!interaction) return;
  const pointerId = interaction.id;
  pointerState = null;
  if (stage.hasPointerCapture(pointerId)) {
    stage.releasePointerCapture(pointerId);
  }
  window.desktopPet.dragEnd();
  if (!interaction.moved) return;
  const context = state.dragContext;
  state.dragContext = null;
  endDragVisual();
  if (settle) settleCancelledDrag(context);
}

function finishPointer(event) {
  if (!pointerState || pointerState.id !== event.pointerId) return;
  const interaction = pointerState;
  const moved = interaction.moved;
  if (moved) {
    suppressClickUntil = Date.now() + 400;
    interaction.samples.push({
      x: event.screenX,
      y: event.screenY,
      time: performance.now(),
    });
  }
  pointerState = null;
  if (stage.hasPointerCapture(event.pointerId)) {
    stage.releasePointerCapture(event.pointerId);
  }
  window.desktopPet.dragEnd();
  if (moved) {
    const context = state.dragContext;
    state.dragContext = null;
    endDragVisual();
    const velocity = estimateReleaseVelocity(
      interaction.samples,
      120,
      THROW_MAX_SPEED,
    );
    if (velocity.speed >= THROW_TRIGGER_SPEED) {
      startThrow(velocity);
    } else if (context?.fromPlay && state.play && !state.play.expired) {
      resumePlayIdle();
    } else {
      enterDaily();
    }
  }
  if (lastPointerPosition) {
    queueMicrotask(() => updatePointerPosition(lastPointerPosition));
  }
}

stage.addEventListener("pointerup", finishPointer);
stage.addEventListener("pointercancel", () => cancelPointerInteraction());
stage.addEventListener("lostpointercapture", (event) => {
  if (pointerState?.id === event.pointerId) cancelPointerInteraction();
});

stage.addEventListener("click", () => {
  if (Date.now() < suppressClickUntil) return;
  scheduleSingleClick();
});

stage.addEventListener("dblclick", () => {
  if (Date.now() < suppressClickUntil) return;
  cancelDelayedSingleClick();
  handleClickIntent("double");
});

window.addEventListener("contextmenu", (event) => {
  if (
    state.clickThrough ||
    state.mode === "throwing" ||
    !hitTest(event.clientX, event.clientY, 0)
  ) {
    return;
  }
  event.preventDefault();
  window.desktopPet.openMenu();
});

async function initialize() {
  const bootstrap = await window.desktopPet.getBootstrap();
  manifest = bootstrap.manifest;
  assets = manifest.assets;
  assetBaseUrl =
    typeof bootstrap.assetBaseUrl === "string" && bootstrap.assetBaseUrl
      ? bootstrap.assetBaseUrl
      : DEVELOPMENT_GENERATED_ROOT.href;
  windowSize = bootstrap.window;
  await primeMovementAnimations();
  state = {
    mode: "starting",
    currentAssetId: null,
    currentFrameIndex: 0,
    currentDaily: null,
    currentHoverId: null,
    facing: 1,
    facingY: 1,
    recent: [],
    manualPaused: Boolean(bootstrap.runtime.paused),
    clickThrough: Boolean(bootstrap.runtime.clickThrough),
    userScale: Number(bootstrap.runtime.scale) || 1,
    personality: bootstrap.runtime.personality,
    environmentAwareness: Boolean(
      bootstrap.runtime.environmentAwareness,
    ),
    environment: bootstrap.environment,
    fullscreenPaused: false,
    movement: null,
    dragContext: null,
    play: null,
    dailyCycle: 0,
    dailyTimer: null,
    actionTimer: null,
    hoverLeaveTimer: null,
    bubbleTimer: null,
    playTimer: null,
    playReactionTimer: null,
    playChaseAttemptTimer: null,
    gifPlayer: new GifPlayer(),
    sequencePlayer: new SequencePlayer(),
  };
  state.dailyTimer = new PausableTimer(automaticTrigger);
  state.actionTimer = new PausableTimer(finishAction);
  state.hoverLeaveTimer = new PausableTimer(leaveHover);
  state.bubbleTimer = new PausableTimer(hideBubble);
  state.playTimer = new PausableTimer(onPlayExpired);
  state.playReactionTimer = new PausableTimer(resumePlayIdle);
  state.playChaseAttemptTimer = new PausableTimer(tryStartPlayChase);
  installSmokeApi(Boolean(bootstrap.smokeTest));
  window.desktopPet.onCommand(handleCommand);
  stage.dataset.scale = String(state.userScale);
  setFacing(1);
  setVerticalFacing(1);
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
  window.desktopPet.reportFailure(error?.stack || error?.message || error);
});
