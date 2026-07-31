const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const generatedRoot = path.join(projectRoot, "assets", "generated");
const manifestPath = path.join(generatedRoot, "manifest.json");
const mainSource = fs.readFileSync(path.join(projectRoot, "src", "main.js"), "utf8");
const overrides = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "scripts", "asset-overrides.json"), "utf8"),
);

assert.ok(fs.existsSync(manifestPath), "缺少生成素材清单，请先运行 npm run prepare:assets");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function assetBySource(source) {
  return Object.values(manifest.assets).find((asset) =>
    asset.sources.includes(source),
  );
}

for (const source of Object.keys(overrides.scaleMultipliers)) {
  assert.ok(
    fs.existsSync(path.join(projectRoot, ...source.split("/"))),
    `缩放 override 指向不存在的素材：${source}`,
  );
}

assert.equal(manifest.schemaVersion, 3);
assert.equal(manifest.daily.length, 5);
assert.equal(manifest.actions.length, 133);
assert.equal(manifest.staticActions.length, 113);
assert.equal(manifest.gifActions.length, 20);
assert.deepEqual(Object.keys(manifest.movement), ["迈步", "跳跳", "跑"]);
assert.deepEqual(manifest.statistics, {
  collectionFiles: 157,
  dailyFiles: 19,
  dailyPairs: 5,
  actions: 133,
  staticActions: 113,
  gifActions: 20,
  movementBehaviors: 3,
});
assert.deepEqual(manifest.rules.dailyDelayMs, { min: 20_000, max: 30_000 });
assert.deepEqual(manifest.rules.staticDurationMs, { min: 2_000, max: 4_000 });
assert.deepEqual(manifest.rules.gifDurationMs, { min: 3_000, max: 6_000 });
assert.deepEqual(manifest.rules.movementDurationMs, { min: 3_000, max: 8_000 });
assert.equal(manifest.rules.openingBubbleDurationMs, 3_500);
assert.equal(manifest.rules.baseDisplayScale, 0.8);

const movementAssets = {
  walk: assetBySource("assets/local/糖猫合集/迈步.png"),
  leg: assetBySource("assets/local/糖猫合集/抬腿.png"),
  jumpGif: assetBySource("assets/local/糖猫合集/动图/跳跳.gif"),
  run: assetBySource("assets/local/糖猫合集/跑.png"),
  run2: assetBySource("assets/local/糖猫合集/跑2.png"),
};
assert.ok(Object.values(movementAssets).every(Boolean));
const movementAxes = ["horizontal", "vertical"];
assert.deepEqual(manifest.movement["迈步"], {
  speed: 50,
  sourceFacing: "right",
  axes: movementAxes,
  animation: {
    type: "sequence",
    frames: [
      { asset: movementAssets.walk.id, durationMs: 250 },
      { asset: movementAssets.leg.id, durationMs: 250 },
    ],
  },
});
assert.deepEqual(manifest.movement["跳跳"], {
  speed: 80,
  sourceFacing: "right",
  axes: movementAxes,
  animation: {
    type: "gif",
    asset: movementAssets.jumpGif.id,
  },
});
assert.deepEqual(manifest.movement["跑"], {
  speed: 120,
  sourceFacing: "left",
  axes: movementAxes,
  animation: {
    type: "sequence",
    frames: [
      { asset: movementAssets.run.id, durationMs: 130 },
      { asset: movementAssets.run2.id, durationMs: 130 },
    ],
  },
});

const throwAsset = assetBySource("assets/local/糖猫合集/飞猫.png");
const landingAssets = [
  "彩虹吐.png",
  "翻倒.png",
  "尴尬.png",
  "趴2.png",
  "趴3.png",
  "吐.png",
].map((filename) => assetBySource(`assets/local/糖猫合集/${filename}`));
const swatAssets = ["伸手.png", "打招呼.png"].map((filename) =>
  assetBySource(`assets/local/糖猫合集/${filename}`),
);
const confusedAsset = assetBySource("assets/local/糖猫合集/疑惑.png");
assert.ok(
  throwAsset &&
    landingAssets.every(Boolean) &&
    swatAssets.every(Boolean) &&
    confusedAsset,
);
assert.deepEqual(manifest.throwBehavior, {
  asset: throwAsset.id,
  landingActions: landingAssets.map((asset) => asset.id),
});
assert.deepEqual(manifest.playBehavior, {
  swatAssets: swatAssets.map((asset) => asset.id),
  confusedAsset: confusedAsset.id,
});
for (const asset of [
  throwAsset,
  ...landingAssets,
  ...swatAssets,
  confusedAsset,
]) {
  assert.ok(
    manifest.actions.includes(asset.id),
    `特殊行为素材也应保留在普通动作池：${asset.name}`,
  );
}

assert.equal(manifest.assets[manifest.dragAsset]?.kind, "static");
assert.ok(manifest.actions.includes(manifest.dragAsset));
assert.ok(
  manifest.assets[manifest.dragAsset].sources.includes(
    "assets/local/糖猫合集/倒立.png",
  ),
  "拖拽素材应来自糖猫合集/倒立.png",
);
for (const asset of Object.values(manifest.assets)) {
  if (
    asset.sources.some((source) =>
      source.startsWith("assets/local/日常与悬停/"),
    )
  ) {
    assert.ok(
      !manifest.actions.includes(asset.id),
      `专用目录素材不得进入普通动作池：${asset.name}`,
    );
  }
}

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
  if (entry.animation.type === "sequence") {
    entry.animation.frames.forEach((frame) => excluded.add(frame.asset));
  } else {
    excluded.add(entry.animation.asset);
  }
}
for (const actionId of manifest.actions) {
  assert.ok(!excluded.has(actionId), `普通动作池包含排除素材：${actionId}`);
}

const referenced = new Set(manifest.actions);
for (const pair of manifest.daily) {
  referenced.add(pair.idle);
  pair.hovers.forEach((assetId) => referenced.add(assetId));
}
referenced.add(manifest.dragAsset);
for (const entry of Object.values(manifest.movement)) {
  if (entry.animation.type === "sequence") {
    entry.animation.frames.forEach((frame) => referenced.add(frame.asset));
  } else {
    referenced.add(entry.animation.asset);
  }
}
referenced.add(manifest.throwBehavior.asset);
manifest.throwBehavior.landingActions.forEach((assetId) =>
  referenced.add(assetId),
);
manifest.playBehavior.swatAssets.forEach((assetId) => referenced.add(assetId));
referenced.add(manifest.playBehavior.confusedAsset);
assert.deepEqual(
  [...referenced].sort(),
  Object.keys(manifest.assets).sort(),
  "每个运行时素材都应由角色或普通动作池引用",
);

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

function representativeVisibleSize(asset) {
  const bounds = asset.frames[asset.representativeFrame].bounds;
  return {
    width: bounds.width * asset.displayScale,
    height: bounds.height * asset.displayScale,
  };
}

const requiredV3OrdinaryActions = [
  "倒立.png",
  "飞猫.png",
  "跳跳.png",
  "舞萌猫2.png",
  "看不懂2.png",
];
for (const filename of requiredV3OrdinaryActions) {
  const source = `assets/local/糖猫合集/${filename}`;
  const asset = assetBySource(source);
  assert.ok(asset, `未导入第三版素材：${source}`);
  assert.ok(
    manifest.actions.includes(asset.id),
    `第三版素材未进入普通动作池：${source}`,
  );
}

const newlyAddedActions = [
  ["assets/local/糖猫合集/nb.png", "static"],
  ["assets/local/糖猫合集/qu.png", "static"],
  ["assets/local/糖猫合集/呐喊.png", "static"],
  ["assets/local/糖猫合集/舞萌猫.png", "static"],
  ["assets/local/糖猫合集/鸟.png", "static"],
  ["assets/local/糖猫合集/动图/兴奋品尝.gif", "gif"],
  ["assets/local/糖猫合集/动图/大口吃.gif", "gif"],
  ["assets/local/糖猫合集/动图/抛手.gif", "gif"],
  ["assets/local/糖猫合集/动图/睡觉与起床.gif", "gif"],
  ["assets/local/糖猫合集/动图/蛆爬行.gif", "gif"],
];
for (const [source, kind] of newlyAddedActions) {
  const asset = assetBySource(source);
  assert.ok(asset, `未导入新增素材：${source}`);
  assert.equal(asset.kind, kind, `新增素材类型错误：${source}`);
  assert.ok(
    manifest.actions.includes(asset.id),
    `新增素材未进入普通动作池：${source}`,
  );
}

const latestV2Actions = [
  ["assets/local/糖猫合集/擦干眼泪.png", "static"],
  ["assets/local/糖猫合集/擦眼泪.png", "static"],
  ["assets/local/糖猫合集/揣手.png", "static"],
  ["assets/local/糖猫合集/寄了.png", "static"],
  ["assets/local/糖猫合集/凌乱1.png", "static"],
  ["assets/local/糖猫合集/凌乱2.png", "static"],
  ["assets/local/糖猫合集/趴5.png", "static"],
  ["assets/local/糖猫合集/穷.png", "static"],
  ["assets/local/糖猫合集/照相.png", "static"],
  ["assets/local/糖猫合集/动图/趴下起来.gif", "gif"],
];
for (const [source, kind] of latestV2Actions) {
  const asset = assetBySource(source);
  assert.ok(asset, `未导入第二版补充素材：${source}`);
  assert.equal(asset.kind, kind, `第二版补充素材类型错误：${source}`);
  assert.ok(
    manifest.actions.includes(asset.id),
    `第二版补充素材未进入普通动作池：${source}`,
  );
}
assert.equal(
  assetBySource("assets/local/糖猫合集/呆住.png"),
  undefined,
  "呆住.png 已原样更名为穷.png，不应保留旧来源",
);

const renamedSittingSources = [
  "assets/local/糖猫合集/坐1.png",
  "assets/local/糖猫合集/坐2.png",
  "assets/local/糖猫合集/坐3.png",
  "assets/local/糖猫合集/坐4.png",
];
for (const source of renamedSittingSources) {
  const asset = assetBySource(source);
  assert.ok(asset, `未识别改名后的坐姿素材：${source}`);
  assert.ok(
    asset.sources.some((candidate) =>
      candidate.startsWith("assets/local/日常与悬停/"),
    ),
    `改名后的坐姿素材应复用专用素材内容：${source}`,
  );
  assert.ok(
    !manifest.actions.includes(asset.id),
    `改名后的坐姿专用素材不得进入普通动作池：${source}`,
  );
}

const maimaiCat = assetBySource("assets/local/糖猫合集/舞萌猫.png");
const bird = assetBySource("assets/local/糖猫合集/鸟.png");
const goose = assetBySource("assets/local/糖猫合集/鹅.png");
assert.ok(maimaiCat && bird && goose);
assert.ok(
  maimaiCat.displaySize.width <= 165 && maimaiCat.displaySize.height <= 165,
  "舞萌猫裁减空白后不应保留过大的运行画布",
);
assert.ok(
  bird.displaySize.height >= 185 && bird.displaySize.height <= 195,
  "鸟素材应适当放大，避免棚架和长喙使主体显得过小",
);
assert.ok(
  goose.displaySize.height >= 185 && goose.displaySize.height <= 195,
  "鹅素材应适当放大，避免细长身体使猫头显得过小",
);

const swallowingCats = [
  assetBySource("assets/local/糖猫合集/吞1.png"),
  assetBySource("assets/local/糖猫合集/吞2.png"),
];
assert.ok(swallowingCats.every(Boolean));
for (const asset of swallowingCats) {
  const bounds = asset.frames[asset.representativeFrame].bounds;
  const visibleHeight = bounds.height * asset.displayScale;
  assert.ok(
    visibleHeight >= 135 && visibleHeight <= 140,
    `${asset.name} 应稍微缩小并保持组内大小一致`,
  );
}

const jumpingCats = [
  assetBySource("assets/local/糖猫合集/跳跳.png"),
  assetBySource("assets/local/糖猫合集/动图/跳跳.gif"),
];
assert.ok(jumpingCats.every(Boolean));
for (const asset of jumpingCats) {
  const bounds = asset.frames[asset.representativeFrame].bounds;
  const visibleHeight = bounds.height * asset.displayScale;
  assert.ok(
    visibleHeight >= 165 && visibleHeight <= 170,
    `${asset.name} 的静态图与 GIF 应同步稍微放大`,
  );
}

const crawlingCat = assetBySource(
  "assets/local/糖猫合集/动图/蛆爬行.gif",
);
assert.ok(crawlingCat);
const crawlingBounds =
  crawlingCat.frames[crawlingCat.representativeFrame].bounds;
const crawlingHeight = crawlingBounds.height * crawlingCat.displayScale;
assert.ok(
  crawlingHeight >= 120 && crawlingHeight <= 125,
  "蛆爬行.gif 应进一步缩小，减少横向画面的占用",
);

const enlargedSlenderAssets = [
  ["assets/local/糖猫合集/喂.png", 185, 195],
  ["assets/local/糖猫合集/惊.png", 170, 180],
  ["assets/local/糖猫合集/偷听.png", 165, 175],
  ["assets/local/糖猫合集/彩虹吐.png", 170, 180],
  ["assets/local/糖猫合集/灵魂.png", 180, 185],
  ["assets/local/糖猫合集/单脚站.png", 165, 170],
  ["assets/local/糖猫合集/动图/吐.gif", 170, 180],
];
for (const [source, minimumHeight, maximumHeight] of enlargedSlenderAssets) {
  const asset = assetBySource(source);
  assert.ok(asset, `未找到细长构图尺寸复核素材：${source}`);
  const { height } = representativeVisibleSize(asset);
  assert.ok(
    height >= minimumHeight && height <= maximumHeight,
    `${asset.name} 应补偿长尾、长杆或特效占高造成的主体偏小`,
  );
}

const reducedWideAssets = [
  ["assets/local/糖猫合集/买买买.png", 255, 265, 128, 135],
  ["assets/local/糖猫合集/收废品.png", 255, 265, 128, 135],
  ["assets/local/糖猫合集/爱你.png", 238, 247, 134, 140],
  ["assets/local/糖猫合集/骑鳄鱼.png", 280, 292, 168, 174],
];
for (const [
  source,
  minimumWidth,
  maximumWidth,
  minimumHeight,
  maximumHeight,
] of reducedWideAssets) {
  const asset = assetBySource(source);
  assert.ok(asset, `未找到横向构图尺寸复核素材：${source}`);
  const { width, height } = representativeVisibleSize(asset);
  assert.ok(
    width >= minimumWidth &&
      width <= maximumWidth &&
      height >= minimumHeight &&
      height <= maximumHeight,
    `${asset.name} 应温和缩小，避免实体画面明显大于普通动作`,
  );
}

const proneFive = assetBySource("assets/local/糖猫合集/趴5.png");
const lieDownAndRise = assetBySource(
  "assets/local/糖猫合集/动图/趴下起来.gif",
);
assert.ok(proneFive && lieDownAndRise);
const proneFiveHeight =
  proneFive.frames[proneFive.representativeFrame].bounds.height *
  proneFive.displayScale;
assert.ok(
  proneFiveHeight >= 120 && proneFiveHeight <= 130,
  "趴5.png 应与既有趴姿组大小接近",
);
for (const frame of lieDownAndRise.frames) {
  const frameHeight = frame.bounds.height * lieDownAndRise.displayScale;
  assert.ok(
    frameHeight >= 110 && frameHeight <= 130,
    "趴下起来.gif 的每一帧都应与既有趴姿组大小接近",
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

const bedtimeIdle = assetBySource(
  "assets/local/日常与悬停/7_晚安.png",
);
const bedtimeHovers = [
  assetBySource("assets/local/日常与悬停/8_起床.png"),
  assetBySource("assets/local/日常与悬停/8_睡不着.png"),
];
assert.ok(bedtimeIdle && bedtimeHovers.every(Boolean));
function representativeVisibleArea(asset) {
  const bounds = asset.frames[asset.representativeFrame].bounds;
  return bounds.width * bounds.height * asset.displayScale ** 2;
}
const largestBedtimeHoverArea = Math.max(
  ...bedtimeHovers.map(representativeVisibleArea),
);
assert.ok(
  representativeVisibleArea(bedtimeIdle) <= largestBedtimeHoverArea * 1.08,
  "7_晚安.png 应略微缩小，与对应悬停图的视觉面积接近",
);

console.log("manifest.test.js 通过");
