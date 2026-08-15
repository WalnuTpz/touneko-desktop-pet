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

console.log("manifest.test.js 通过");
