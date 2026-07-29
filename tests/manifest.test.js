const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const generatedRoot = path.join(projectRoot, "assets", "generated");
const manifestPath = path.join(generatedRoot, "manifest.json");

assert.ok(fs.existsSync(manifestPath), "缺少生成素材清单，请先运行 npm run prepare:assets");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

assert.equal(manifest.schemaVersion, 2);
assert.equal(manifest.daily.length, 5);
assert.equal(manifest.actions.length, 114);
assert.equal(manifest.staticActions.length, 99);
assert.equal(manifest.gifActions.length, 15);
assert.deepEqual(Object.keys(manifest.movement).sort(), ["迈步", "跑", "跳", "飞猫"].sort());

for (const pair of manifest.daily) {
  assert.ok(manifest.assets[pair.idle], `日常素材不存在：${pair.idle}`);
  assert.ok(pair.hovers.length >= 1, `日常状态没有悬停图：${pair.id}`);
  for (const hoverId of pair.hovers) {
    assert.ok(manifest.assets[hoverId], `悬停素材不存在：${hoverId}`);
  }
}

const excluded = new Set();
for (const pair of manifest.daily) {
  excluded.add(pair.idle);
  pair.hovers.forEach((id) => excluded.add(id));
}
for (const entry of Object.values(manifest.movement)) {
  excluded.add(entry.asset);
}
for (const actionId of manifest.actions) {
  assert.ok(!excluded.has(actionId), `普通动作池包含排除素材：${actionId}`);
}

for (const asset of Object.values(manifest.assets)) {
  assert.ok(asset.displayScale > 0);
  assert.ok(asset.frames.length >= 1);
  for (const frame of asset.frames) {
    const framePath = path.join(generatedRoot, ...frame.file.split("/"));
    assert.ok(fs.existsSync(framePath), `生成素材不存在：${frame.file}`);
    assert.ok(frame.bounds.width > 0 && frame.bounds.height > 0);
  }
  if (asset.kind === "gif") {
    assert.ok(asset.loopDurationMs > 0);
    assert.equal(
      asset.loopDurationMs,
      asset.frames.reduce((sum, frame) => sum + frame.durationMs, 0),
    );
  }
}

console.log("manifest.test.js 通过");
