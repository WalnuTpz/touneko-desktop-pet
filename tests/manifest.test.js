const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const assetsRoot = path.join(projectRoot, "assets");
const generatedRoot = path.join(assetsRoot, "generated");
const manifestPath = path.join(generatedRoot, "manifest.json");
const catalogPath = path.join(assetsRoot, "catalog.json");
const mainSource = fs.readFileSync(path.join(projectRoot, "src", "main.js"), "utf8");

assert.ok(fs.existsSync(manifestPath), "缺少生成素材清单，请先运行 npm run prepare:assets");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

function asset(assetId) {
  const value = manifest.assets[assetId];
  assert.ok(value, `清单缺少素材：${assetId}`);
  return value;
}

function fileHash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function representativeVisibleSize(value) {
  const bounds = value.frames[value.representativeFrame].bounds;
  return {
    width: bounds.width * value.displayScale,
    height: bounds.height * value.displayScale,
  };
}

function representativeVisibleArea(value) {
  const { width, height } = representativeVisibleSize(value);
  return width * height;
}

assert.equal(catalog.schemaVersion, 4);
assert.equal(manifest.schemaVersion, 4);
assert.deepEqual(manifest.daily, catalog.daily);
assert.deepEqual(manifest.actions, catalog.actions);
assert.deepEqual(manifest.movement, catalog.movement);
assert.deepEqual(manifest.throwBehavior, catalog.throwBehavior);
assert.deepEqual(manifest.playBehavior, catalog.playBehavior);
assert.equal(manifest.dragAsset, catalog.dragAsset);
assert.equal(manifest.iconAsset, catalog.iconAsset);
assert.deepEqual(manifest.statistics, {
  sourceFiles: 157,
  staticFiles: 136,
  animatedFiles: 21,
  dailyPairs: 5,
  actions: 133,
  staticActions: 113,
  gifActions: 20,
  movementBehaviors: 3,
});

const catalogIds = [...catalog.staticAssets, ...catalog.animatedAssets];
assert.equal(new Set(catalogIds).size, 157);
assert.deepEqual(Object.keys(manifest.assets), catalogIds);
assert.equal(new Set(Object.values(manifest.assets).map((value) => value.contentHash)).size, 157);
for (const assetId of catalog.staticAssets) {
  const value = asset(assetId);
  const source = path.join(assetsRoot, "local", "static", `${assetId}.png`);
  assert.equal(value.id, assetId);
  assert.equal(value.kind, "static");
  assert.equal(value.source, `assets/local/static/${assetId}.png`);
  assert.ok(fs.existsSync(source), `缺少本地静态素材：${assetId}`);
  assert.equal(value.contentHash, fileHash(source));
}
for (const assetId of catalog.animatedAssets) {
  const value = asset(assetId);
  const source = path.join(assetsRoot, "local", "animated", `${assetId}.gif`);
  assert.equal(value.id, assetId);
  assert.equal(value.kind, "gif");
  assert.equal(value.source, `assets/local/animated/${assetId}.gif`);
  assert.ok(fs.existsSync(source), `缺少本地动图素材：${assetId}`);
  assert.equal(value.contentHash, fileHash(source));
}
for (const assetId of Object.keys(catalog.scaleMultipliers)) {
  assert.ok(manifest.assets[assetId], `缩放倍率引用了不存在的素材：${assetId}`);
}

assert.deepEqual(manifest.rules.dailyDelayMs, { min: 20_000, max: 30_000 });
assert.deepEqual(manifest.rules.staticDurationMs, { min: 2_000, max: 4_000 });
assert.deepEqual(manifest.rules.gifDurationMs, { min: 3_000, max: 6_000 });
assert.deepEqual(manifest.rules.movementDurationMs, { min: 3_000, max: 8_000 });
assert.equal(manifest.rules.openingBubbleDurationMs, 3_500);
assert.equal(manifest.rules.baseDisplayScale, 0.8);

assert.deepEqual(Object.keys(manifest.movement), ["walk", "jump", "run"]);
assert.equal(manifest.movement.walk.speed, 50);
assert.equal(manifest.movement.jump.speed, 80);
assert.equal(manifest.movement.run.speed, 120);
assert.ok(
  manifest.movement.walk.speed < manifest.movement.jump.speed &&
    manifest.movement.jump.speed < manifest.movement.run.speed,
  "移动速度应满足 walk < jump < run",
);

const runSize = representativeVisibleSize(asset("run-1"));
const run2Size = representativeVisibleSize(asset("run-2"));
assert.ok(
  run2Size.width > runSize.width && run2Size.width <= runSize.width * 1.1,
  "run-2 缩小后只应比 run-1 略宽，以保留跑动姿势的张力",
);
assert.ok(
  run2Size.height >= runSize.height * 0.75 && run2Size.height < runSize.height,
  "run-2 应明显收小，但不能与 run-1 失去连续性",
);

for (const assetId of [
  manifest.throwBehavior.asset,
  ...manifest.throwBehavior.landingActions,
  ...manifest.playBehavior.swatAssets,
  manifest.playBehavior.confusedAsset,
  manifest.dragAsset,
]) {
  assert.ok(manifest.actions.includes(assetId), `特殊行为素材也应属于普通动作：${assetId}`);
}
assert.equal(manifest.playBehavior.greetingAsset, "greeting");
assert.ok(manifest.playBehavior.swatAssets.includes("greeting"));
assert.equal(asset(manifest.dragAsset).kind, "static");

assert.deepEqual(
  manifest.staticActions,
  manifest.actions.filter((assetId) => asset(assetId).kind === "static"),
);
assert.deepEqual(
  manifest.gifActions,
  manifest.actions.filter((assetId) => asset(assetId).kind === "gif"),
);
for (const actionId of manifest.actions) {
  assert.equal(typeof asset(actionId).dialogueId, "string");
}

for (const pair of manifest.daily) {
  assert.equal(asset(pair.idle).kind, "static");
  assert.ok(pair.hovers.length >= 1, `日常状态没有悬停图：${pair.id}`);
  for (const hoverId of pair.hovers) assert.equal(asset(hoverId).kind, "static");
}

const referenced = new Set(manifest.actions);
for (const pair of manifest.daily) {
  referenced.add(pair.idle);
  pair.hovers.forEach((assetId) => referenced.add(assetId));
}
for (const entry of Object.values(manifest.movement)) {
  if (entry.animation.type === "sequence") {
    entry.animation.frames.forEach((frame) => referenced.add(frame.asset));
  } else {
    referenced.add(entry.animation.asset);
  }
}
assert.deepEqual(
  [...referenced].sort(),
  Object.keys(manifest.assets).sort(),
  "每份素材都应至少承担一种运行时角色",
);

const windowWidth = Number(mainSource.match(/const WINDOW_WIDTH = (\d+);/)?.[1]);
const windowHeight = Number(mainSource.match(/const WINDOW_HEIGHT = (\d+);/)?.[1]);
assert.ok(windowWidth > 0 && windowHeight > 0);
for (const value of Object.values(manifest.assets)) {
  assert.ok(value.displayScale > 0);
  assert.ok(value.frames.length >= 1);
  for (const frame of value.frames) {
    const framePath = path.join(generatedRoot, ...frame.file.split("/"));
    assert.ok(fs.existsSync(framePath), `生成素材不存在：${frame.file}`);
    assert.ok(frame.bounds.width > 0 && frame.bounds.height > 0);
    assert.ok(frame.bounds.x >= 0 && frame.bounds.y >= 0);
    assert.ok(frame.bounds.x + frame.bounds.width <= value.canvas.width);
    assert.ok(frame.bounds.y + frame.bounds.height <= value.canvas.height);
  }
  if (value.kind === "gif") {
    assert.equal(
      value.loopDurationMs,
      value.frames.reduce((sum, frame) => sum + frame.durationMs, 0),
    );
  }
  assert.ok(
    value.displaySize.width * 1.5 <= windowWidth,
    `150% 宽度超出承载窗口：${value.id}`,
  );
  assert.ok(
    value.displaySize.height * 1.5 <= windowHeight,
    `150% 高度超出承载窗口：${value.id}`,
  );
}

for (const representation of manifest.icons.trayRepresentations) {
  const iconPath = path.join(generatedRoot, ...representation.file.split("/"));
  const data = fs.readFileSync(iconPath);
  assert.equal(data.toString("ascii", 1, 4), "PNG");
  assert.equal(data.readUInt32BE(16) / representation.scaleFactor, 16);
  assert.equal(data.readUInt32BE(20) / representation.scaleFactor, 16);
}

for (const [assetId, minimumHeight, maximumHeight] of [
  ["bird", 185, 195],
  ["goose", 185, 195],
  ["calling", 185, 195],
  ["startled", 170, 180],
  ["eavesdrop", 165, 175],
  ["rainbow-vomit", 170, 180],
  ["soul", 180, 185],
  ["one-leg-stand", 165, 170],
  ["vomit-animated", 170, 180],
]) {
  const { height } = representativeVisibleSize(asset(assetId));
  assert.ok(
    height >= minimumHeight && height <= maximumHeight,
    `${assetId} 的主体高度不符合视觉规格`,
  );
}
assert.ok(
  asset("maimai-1").displaySize.width <= 165 &&
    asset("maimai-1").displaySize.height <= 165,
  "maimai-1 裁减空白后不应保留过大的运行画布",
);

for (const assetId of ["swallow-1", "swallow-2"]) {
  const { height } = representativeVisibleSize(asset(assetId));
  assert.ok(height >= 135 && height <= 140, `${assetId} 应稍微缩小并保持组内一致`);
}

const ordinaryJumpHeight = representativeVisibleSize(asset("jump")).height;
const movementJumpHeight = representativeVisibleSize(asset("movement-jump")).height;
assert.ok(ordinaryJumpHeight >= 172 && ordinaryJumpHeight <= 178);
assert.ok(movementJumpHeight >= 165 && movementJumpHeight <= 170);
assert.ok(
  ordinaryJumpHeight > movementJumpHeight * 1.03 &&
    ordinaryJumpHeight < movementJumpHeight * 1.08,
  "普通动作 jump 应只比移动 jump 温和放大",
);

const crawlHeight = representativeVisibleSize(asset("crawl")).height;
assert.ok(crawlHeight >= 120 && crawlHeight <= 125, "crawl 应减少横向画面占用");

for (const [assetId, minWidth, maxWidth, minHeight, maxHeight] of [
  ["shopping", 255, 265, 128, 135],
  ["recycling", 255, 265, 128, 135],
  ["love", 225, 235, 125, 133],
  ["ride-crocodile", 280, 292, 168, 174],
]) {
  const { width, height } = representativeVisibleSize(asset(assetId));
  assert.ok(
    width >= minWidth && width <= maxWidth && height >= minHeight && height <= maxHeight,
    `${assetId} 的横向构图尺寸不符合视觉规格`,
  );
}

for (const assetId of [
  "messy-1",
  "messy-2",
  "observe-lying",
  "touch-bird-egg-1",
  "touch-bird-egg-2",
  "give-up",
]) {
  const { height } = representativeVisibleSize(asset(assetId));
  assert.ok(height >= 140 && height <= 147, `${assetId} 应比常规主体稍小`);
}

const proneFiveHeight = representativeVisibleSize(asset("prone-5")).height;
assert.ok(proneFiveHeight >= 120 && proneFiveHeight <= 130);
for (const frame of asset("prone-rise").frames) {
  const frameHeight = frame.bounds.height * asset("prone-rise").displayScale;
  assert.ok(frameHeight >= 110 && frameHeight <= 130);
}

const working = manifest.daily.find((pair) => pair.id === "working");
const sleeping = manifest.daily.find((pair) => pair.id === "sleeping");
assert.ok(working && sleeping);
assert.ok(
  Math.abs(asset("work-2").displayScale - asset("work-3").displayScale) /
    asset("work-2").displayScale <
    0.05,
  "带高处问号的工作悬停图应按猫主体匹配日常图",
);
const largestBedtimeHoverArea = Math.max(
  representativeVisibleArea(asset("wake-up")),
  representativeVisibleArea(asset("sleepless")),
);
assert.ok(
  representativeVisibleArea(asset("goodnight")) <= largestBedtimeHoverArea * 1.08,
  "goodnight 应与对应悬停图的视觉面积接近",
);

console.log("manifest.test.js 通过");
