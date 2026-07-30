const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const esbuild = require("esbuild");
const JavaScriptObfuscator = require("javascript-obfuscator");

const {
  createEncryptedPack,
  openEncryptedPack,
} = require("../src/secure-resources");

const projectRoot = path.join(__dirname, "..");
const generatedRoot = path.join(projectRoot, "assets", "generated");
const manifestPath = path.join(generatedRoot, "manifest.json");
const runtimeRoot = path.join(projectRoot, "build", "secure-runtime");
const runtimeSourceRoot = path.join(runtimeRoot, "src");
const runtimeAssetRoot = path.join(runtimeRoot, "assets");
const runtimeScriptRoot = path.join(runtimeRoot, "scripts");
const reportPath = path.join(projectRoot, "build", "secure-runtime-report.json");

function assertBuildPath(targetPath) {
  const resolved = path.resolve(targetPath);
  const buildRoot = `${path.resolve(projectRoot, "build")}${path.sep}`;
  if (!resolved.startsWith(buildRoot)) {
    throw new Error(`拒绝操作构建目录之外的路径：${resolved}`);
  }
  return resolved;
}

function resetRuntimeDirectory() {
  const resolved = assertBuildPath(runtimeRoot);
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(runtimeSourceRoot, { recursive: true });
  fs.mkdirSync(runtimeAssetRoot, { recursive: true });
  fs.mkdirSync(runtimeScriptRoot, { recursive: true });
}

function readManifest() {
  if (!fs.existsSync(manifestPath)) {
    throw new Error("缺少生成素材清单，请先运行 npm run prepare:assets");
  }
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function validateRuntimeManifest(manifest) {
  if (
    !manifest ||
    !manifest.assets ||
    typeof manifest.assets !== "object" ||
    !Array.isArray(manifest.actions) ||
    !Array.isArray(manifest.staticActions) ||
    !Array.isArray(manifest.gifActions)
  ) {
    throw new Error("生成素材清单缺少运行时字段");
  }
  const assets = manifest.assets;
  const referenced = new Set();
  const requireAsset = (assetId, expectedKind, context) => {
    const asset = assets[assetId];
    if (!asset) throw new Error(`${context} 引用了不存在的素材：${assetId}`);
    if (expectedKind && asset.kind !== expectedKind) {
      throw new Error(`${context} 的素材类型应为 ${expectedKind}：${assetId}`);
    }
    if (!Array.isArray(asset.frames) || asset.frames.length === 0) {
      throw new Error(`${context} 缺少运行帧：${assetId}`);
    }
    referenced.add(assetId);
    return asset;
  };
  const assertUnique = (items, context) => {
    if (new Set(items).size !== items.length) {
      throw new Error(`${context} 中存在重复素材`);
    }
  };

  assertUnique(manifest.actions, "普通动作池");
  assertUnique(manifest.staticActions, "静态动作池");
  assertUnique(manifest.gifActions, "GIF 动作池");
  for (const assetId of manifest.actions) requireAsset(assetId, null, "普通动作池");
  for (const assetId of manifest.staticActions) {
    requireAsset(assetId, "static", "静态动作池");
  }
  for (const assetId of manifest.gifActions) {
    requireAsset(assetId, "gif", "GIF 动作池");
  }
  const expectedStatic = manifest.actions.filter(
    (assetId) => assets[assetId]?.kind === "static",
  );
  const expectedGif = manifest.actions.filter(
    (assetId) => assets[assetId]?.kind === "gif",
  );
  if (
    JSON.stringify([...manifest.staticActions].sort()) !==
      JSON.stringify(expectedStatic.sort()) ||
    JSON.stringify([...manifest.gifActions].sort()) !==
      JSON.stringify(expectedGif.sort())
  ) {
    throw new Error("静态/GIF 动作池没有正确划分普通动作");
  }

  if (!Array.isArray(manifest.daily) || manifest.daily.length === 0) {
    throw new Error("日常状态清单为空");
  }
  for (const daily of manifest.daily) {
    requireAsset(daily.idle, "static", `日常状态 ${daily.id}`);
    if (!Array.isArray(daily.hovers) || daily.hovers.length === 0) {
      throw new Error(`日常状态缺少悬停素材：${daily.id}`);
    }
    assertUnique(daily.hovers, `日常状态 ${daily.id} 的悬停池`);
    for (const hoverId of daily.hovers) {
      requireAsset(hoverId, "static", `日常状态 ${daily.id} 的悬停池`);
    }
  }
  requireAsset(manifest.dragAsset, "static", "拖拽素材");
  for (const [name, movement] of Object.entries(manifest.movement || {})) {
    requireAsset(movement.asset, "static", `移动素材 ${name}`);
    if (!Number.isFinite(movement.speed) || movement.speed <= 0) {
      throw new Error(`移动素材速度无效：${name}`);
    }
  }
  if (Object.keys(manifest.movement || {}).length !== 4) {
    throw new Error("移动素材必须恰好包含四种");
  }

  for (const [assetId, asset] of Object.entries(assets)) {
    if (asset.id !== assetId) {
      throw new Error(`素材 ID 与索引键不一致：${assetId}`);
    }
    if (!referenced.has(assetId)) {
      throw new Error(`运行清单包含未归类素材：${assetId}`);
    }
  }
  if (
    !manifest.icons ||
    !Array.isArray(manifest.icons.trayRepresentations) ||
    manifest.icons.trayRepresentations.length !== 4
  ) {
    throw new Error("托盘图标必须包含四档表示");
  }
}

function createRuntimeManifest(sourceManifest) {
  const manifest = structuredClone(sourceManifest);
  delete manifest.generatedAt;
  delete manifest.statistics;
  delete manifest.iconAsset;
  delete manifest.icons.sizes;
  delete manifest.icons.appSource;
  for (const asset of Object.values(manifest.assets)) {
    delete asset.sources;
    delete asset.contentHash;
    delete asset.displaySize;
    delete asset.representativeFrame;
    delete asset.file;
    delete asset.frameCount;
    delete asset.sourceLoop;
  }
  return manifest;
}

function secureIndexHtml() {
  const source = fs.readFileSync(
    path.join(projectRoot, "src", "index.html"),
    "utf8",
  );
  const withSecureCsp = source.replace(
    "default-src 'self' file:; img-src 'self' file: data:; style-src 'self'; script-src 'self'",
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'",
  );
  const withSingleBundle = withSecureCsp.replace(
    /\s*<script src="\.\/core\.js"><\/script>\s*<script src="\.\/dialogue\.js"><\/script>\s*<script src="\.\/renderer\.js"><\/script>/,
    '\n    <script src="./renderer.js"></script>',
  );
  if (
    withSingleBundle === source ||
    withSingleBundle.includes("./core.js") ||
    withSingleBundle.includes("./dialogue.js") ||
    withSingleBundle.includes(" file:")
  ) {
    throw new Error("无法生成收紧 CSP 的正式版页面");
  }
  return withSingleBundle;
}

async function bundleJavaScript({
  contents,
  outfile,
  platform,
  sourcefile,
  target,
}) {
  await esbuild.build({
    bundle: true,
    external: platform === "node" ? ["electron"] : [],
    format: platform === "node" ? "cjs" : "iife",
    legalComments: "none",
    minify: true,
    outfile,
    platform,
    sourcemap: false,
    stdin: {
      contents,
      resolveDir: projectRoot,
      sourcefile,
    },
    target,
  });
}

function obfuscateFile(filePath, target) {
  const source = fs.readFileSync(filePath, "utf8");
  const result = JavaScriptObfuscator.obfuscate(source, {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
    identifierNamesGenerator: "hexadecimal",
    log: false,
    numbersToExpressions: false,
    renameGlobals: false,
    renameProperties: false,
    selfDefending: false,
    simplify: true,
    splitStrings: false,
    stringArray: true,
    stringArrayCallsTransform: false,
    stringArrayEncoding: ["base64"],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayThreshold: 0.7,
    target,
    transformObjectKeys: false,
    unicodeEscapeSequence: false,
  });
  fs.writeFileSync(filePath, result.getObfuscatedCode(), "utf8");
}

function collectAssetResources(manifest) {
  const paths = new Set();
  for (const asset of Object.values(manifest.assets)) {
    for (const frame of asset.frames) paths.add(frame.file);
  }
  for (const representation of manifest.icons.trayRepresentations) {
    paths.add(representation.file);
  }

  const resources = new Map();
  resources.set(
    "app/assets/manifest.json",
    Buffer.from(JSON.stringify(manifest), "utf8"),
  );
  const generatedRealRoot = fs.realpathSync(generatedRoot);
  for (const relativePath of [...paths].sort((left, right) =>
    left.localeCompare(right, "en"),
  )) {
    const allowedPath =
      /^files\/static\/[a-f0-9]{20}\.png$/.test(relativePath) ||
      /^files\/animated\/[a-f0-9]{20}\/frame-\d{3}\.png$/.test(
        relativePath,
      ) ||
      /^icons\/tangmao-(16|20|24|32)\.png$/.test(relativePath);
    if (!allowedPath) {
      throw new Error(`正式资源路径不在 PNG 白名单中：${relativePath}`);
    }
    const sourcePath = path.resolve(generatedRoot, ...relativePath.split("/"));
    const generatedPrefix = `${path.resolve(generatedRoot)}${path.sep}`;
    if (!sourcePath.startsWith(generatedPrefix) || !fs.existsSync(sourcePath)) {
      throw new Error(`素材引用不存在或越界：${relativePath}`);
    }
    if (fs.lstatSync(sourcePath).isSymbolicLink()) {
      throw new Error(`素材引用不允许使用符号链接：${relativePath}`);
    }
    const realSourcePath = fs.realpathSync(sourcePath);
    const realRelative = path.relative(generatedRealRoot, realSourcePath);
    if (
      !realRelative ||
      realRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(realRelative)
    ) {
      throw new Error(`素材真实路径越界：${relativePath}`);
    }
    const data = fs.readFileSync(realSourcePath);
    const pngSignature = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    if (
      data.length <= pngSignature.length ||
      !data.subarray(0, pngSignature.length).equals(pngSignature)
    ) {
      throw new Error(`正式资源不是有效的 PNG 文件：${relativePath}`);
    }
    resources.set(
      `app/assets/${relativePath.replace(/\\/g, "/")}`,
      data,
    );
  }
  return resources;
}

function verifyEncryptedPack(pack, key, resources) {
  const store = openEncryptedPack(pack, key);
  const expectedPaths = [...resources.keys()].sort();
  const actualPaths = store.list().sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error("加密资源包往返校验的条目清单不一致");
  }
  for (const [resourcePath, expected] of resources) {
    if (!store.read(resourcePath).equals(expected)) {
      throw new Error(`加密资源包往返校验失败：${resourcePath}`);
    }
  }
}

function sha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

async function main() {
  resetRuntimeDirectory();
  const sourceManifest = readManifest();
  validateRuntimeManifest(sourceManifest);
  const runtimeManifest = createRuntimeManifest(sourceManifest);
  const resourceKey = crypto.randomBytes(32);
  const fullscreenSource = path.join(
    projectRoot,
    "scripts",
    "fullscreen-monitor.ps1",
  );
  const fullscreenTarget = path.join(
    runtimeScriptRoot,
    "fullscreen-monitor.ps1",
  );
  fs.copyFileSync(fullscreenSource, fullscreenTarget);
  const fullscreenHash = sha256(fullscreenSource);

  const mainEntry = [
    `globalThis[Symbol.for("tangmao.resource-key")] = Buffer.from("${resourceKey.toString("base64")}", "base64");`,
    `globalThis[Symbol.for("tangmao.fullscreen-monitor-hash")] = "${fullscreenHash}";`,
    'require("./src/main.js");',
  ].join("\n");
  const rendererEntry = [
    'require("./src/core.js");',
    'require("./src/dialogue.js");',
    'require("./src/renderer.js");',
  ].join("\n");

  const mainOutput = path.join(runtimeSourceRoot, "main.js");
  const preloadOutput = path.join(runtimeSourceRoot, "preload.js");
  const rendererOutput = path.join(runtimeSourceRoot, "renderer.js");
  await bundleJavaScript({
    contents: mainEntry,
    outfile: mainOutput,
    platform: "node",
    sourcefile: "secure-main-entry.js",
    target: "node22",
  });
  await bundleJavaScript({
    contents: 'require("./src/preload.js");',
    outfile: preloadOutput,
    platform: "node",
    sourcefile: "secure-preload-entry.js",
    target: "node22",
  });
  await bundleJavaScript({
    contents: rendererEntry,
    outfile: rendererOutput,
    platform: "browser",
    sourcefile: "secure-renderer-entry.js",
    target: "chrome136",
  });

  obfuscateFile(mainOutput, "node");
  obfuscateFile(preloadOutput, "node");
  obfuscateFile(rendererOutput, "browser");

  const resources = collectAssetResources(runtimeManifest);
  resources.set("app/index.html", Buffer.from(secureIndexHtml(), "utf8"));
  resources.set(
    "app/styles.css",
    fs.readFileSync(path.join(projectRoot, "src", "styles.css")),
  );
  resources.set("app/renderer.js", fs.readFileSync(rendererOutput));
  fs.rmSync(rendererOutput, { force: true });

  const pack = createEncryptedPack(resources, resourceKey);
  verifyEncryptedPack(pack, resourceKey, resources);
  const packPath = path.join(runtimeAssetRoot, "runtime.tpack");
  fs.writeFileSync(packPath, pack);
  resourceKey.fill(0);

  const plaintextBytes = [...resources.values()].reduce(
    (total, data) => total + data.length,
    0,
  );
  const report = {
    generatedAt: new Date().toISOString(),
    resourceCount: resources.size,
    plaintextBytes,
    encryptedBytes: pack.length,
    packagedFiles: [
      "src/main.js",
      "src/preload.js",
      "assets/runtime.tpack",
      "scripts/fullscreen-monitor.ps1",
    ],
    excludedRawGifCount: Object.values(sourceManifest.assets).filter(
      (asset) => asset.kind === "gif",
    ).length,
    sha256: {
      "src/main.js": sha256(mainOutput),
      "src/preload.js": sha256(preloadOutput),
      "assets/runtime.tpack": sha256(packPath),
    },
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    `安全运行目录已生成：${resources.size} 个加密资源，${(
      pack.length /
      1024 /
      1024
    ).toFixed(2)} MB`,
  );
}

main().catch((error) => {
  console.error("安全运行目录生成失败：", error);
  process.exitCode = 1;
});
