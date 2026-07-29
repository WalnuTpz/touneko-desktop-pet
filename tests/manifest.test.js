const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const generatedRoot = path.join(projectRoot, "assets", "generated");
const manifestPath = path.join(generatedRoot, "manifest.json");
const mainSource = fs.readFileSync(path.join(projectRoot, "src", "main.js"), "utf8");

assert.ok(fs.existsSync(manifestPath), "缺少生成素材清单，请先运行 npm run prepare:assets");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

assert.equal(manifest.schemaVersion, 2);
assert.equal(manifest.daily.length, 5);
assert.equal(manifest.actions.length, 112);
assert.equal(manifest.staticActions.length, 97);
assert.equal(manifest.gifActions.length, 15);
assert.deepEqual(Object.keys(manifest.movement).sort(), ["迈步", "跑", "跳", "飞猫"].sort());
assert.deepEqual(manifest.rules.dailyDelayMs, { min: 20_000, max: 30_000 });
assert.deepEqual(manifest.rules.staticDurationMs, { min: 2_000, max: 4_000 });
assert.deepEqual(manifest.rules.gifDurationMs, { min: 3_000, max: 6_000 });
assert.deepEqual(manifest.rules.movementDurationMs, { min: 3_000, max: 8_000 });
assert.equal(manifest.rules.baseDisplayScale, 0.8);

const windowWidth = Number(mainSource.match(/const WINDOW_WIDTH = (\d+);/)?.[1]);
const windowHeight = Number(mainSource.match(/const WINDOW_HEIGHT = (\d+);/)?.[1]);
assert.ok(windowWidth > 0 && windowHeight > 0);

for (const pair of manifest.daily) {
  assert.equal(manifest.assets[pair.idle]?.kind, "static");
  assert.ok(pair.hovers.length >= 1, `日常状态没有悬停图：${pair.id}`);
  for (const hoverId of pair.hovers) {
    assert.equal(manifest.assets[hoverId]?.kind, "static");
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
    assert.ok(frame.bounds.x >= 0 && frame.bounds.y >= 0);
    assert.ok(frame.bounds.x + frame.bounds.width <= asset.canvas.width);
    assert.ok(frame.bounds.y + frame.bounds.height <= asset.canvas.height);
  }
  if (asset.kind === "gif") {
    assert.ok(asset.loopDurationMs > 0);
    assert.equal(
      asset.loopDurationMs,
      asset.frames.reduce((sum, frame) => sum + frame.durationMs, 0),
    );
  }
  assert.ok(
    asset.displaySize.width * 1.5 <= windowWidth,
    `150% 宽度超出承载窗口：${asset.name}`,
  );
  assert.ok(
    asset.displaySize.height * 1.5 <= windowHeight,
    `150% 高度超出承载窗口：${asset.name}`,
  );
}

for (const representation of manifest.icons.trayRepresentations) {
  const iconPath = path.join(generatedRoot, ...representation.file.split("/"));
  const data = fs.readFileSync(iconPath);
  assert.equal(data.toString("ascii", 1, 4), "PNG");
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  assert.equal(width / representation.scaleFactor, 16);
  assert.equal(height / representation.scaleFactor, 16);
}

function assetBySource(source) {
  return Object.values(manifest.assets).find((asset) =>
    asset.sources.includes(source),
  );
}

function dailyPairById(id) {
  return manifest.daily.find((pair) => pair.id === id);
}

function pairSources(pair, field) {
  const assetIds = field === "idle" ? [pair.idle] : pair.hovers;
  return assetIds.flatMap((assetId) => manifest.assets[assetId].sources);
}

const standingPair = dailyPairById("daily-1");
const sittingPair = dailyPairById("daily-9");
assert.ok(standingPair && sittingPair);
assert.ok(
  pairSources(standingPair, "hovers").includes(
    "assets/local/日常与悬停/2_防弹衣.png",
  ),
  "第 1 组悬停素材应包含 2_防弹衣.png",
);
assert.ok(
  pairSources(sittingPair, "idle").includes(
    "assets/local/日常与悬停/9_口瓜.png",
  ),
  "第 9 组日常素材应更新为 9_口瓜.png",
);
assert.ok(
  pairSources(sittingPair, "hovers").includes(
    "assets/local/日常与悬停/10_坐.png",
  ),
  "第 9 组悬停素材应包含 10_坐.png",
);

const workIdle = assetBySource("assets/local/日常与悬停/3_工作2.png");
const workQuestion = assetBySource("assets/local/日常与悬停/4_工作3.png");
assert.ok(workIdle && workQuestion);
assert.ok(
  Math.abs(workIdle.displayScale - workQuestion.displayScale) /
    workIdle.displayScale <
    0.05,
  "带高处问号的工作悬停图应按猫主体而非总高度匹配日常图",
);

console.log("manifest.test.js 通过");
