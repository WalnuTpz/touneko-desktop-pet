const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const asar = require("@electron/asar");
const {
  FuseV1Options,
  getCurrentFuseWire,
} = require("@electron/fuses");

const projectRoot = path.join(__dirname, "..");
const releaseRoot = path.join(projectRoot, "release");
const unpackedRoot = path.join(releaseRoot, "win-unpacked");
const resourcesRoot = path.join(unpackedRoot, "resources");
const asarPath = path.join(resourcesRoot, "app.asar");
const reportPath = path.join(projectRoot, "build", "secure-runtime-report.json");
const fullscreenPath = path.join(resourcesRoot, "fullscreen-monitor.ps1");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
);
const productName = packageJson.build.productName;
const executablePath = path.join(unpackedRoot, `${productName}.exe`);
const PACK_MAGIC = Buffer.from("TMRES01\0", "ascii");
const FUSE_DISABLED = "0".charCodeAt(0);
const FUSE_ENABLED = "1".charCodeAt(0);
const requirePortable = process.argv.includes("--require-portable");

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function verifyAsarInventory() {
  assert(fs.existsSync(asarPath), `缺少目录版 ASAR：${asarPath}`);
  const inventory = asar
    .listPackage(asarPath)
    .map((entry) => entry.replace(/\\/g, "/").replace(/^\/+/, ""))
    .sort();
  const expected = [
    "assets",
    "assets/runtime.tpack",
    "package.json",
    "src",
    "src/main.js",
    "src/preload.js",
  ].sort();
  assert(
    JSON.stringify(inventory) === JSON.stringify(expected),
    `正式包文件清单超出白名单：${JSON.stringify(inventory)}`,
  );

  assert(fs.existsSync(reportPath), "缺少本次安全构建报告");
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  for (const relativePath of [
    "src/main.js",
    "src/preload.js",
    "assets/runtime.tpack",
  ]) {
    const packaged = asar.extractFile(asarPath, relativePath);
    assert(
      sha256Buffer(packaged) === report.sha256?.[relativePath],
      `ASAR 文件与本次安全构建不一致：${relativePath}`,
    );
  }
  const packagedMetadata = JSON.parse(
    asar.extractFile(asarPath, "package.json").toString("utf8"),
  );
  for (const field of ["name", "version", "main"]) {
    assert(
      packagedMetadata[field] === packageJson[field],
      `包内 package.json 的 ${field} 与项目不一致`,
    );
  }

  const pack = asar.extractFile(asarPath, "assets/runtime.tpack");
  assert(
    pack.subarray(0, PACK_MAGIC.length).equals(PACK_MAGIC),
    "加密资源包格式标识无效",
  );
  const forbidden = [
    ["PNG 文件头", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["GIF 文件头", Buffer.from("GIF89a", "ascii")],
    ["明文 manifest", Buffer.from("manifest.json", "utf8")],
    ["本地素材路径", Buffer.from("assets/local", "utf8")],
    ["原始 GIF 名称", Buffer.from("source.gif", "utf8")],
  ];
  for (const [label, needle] of forbidden) {
    assert(pack.indexOf(needle) < 0, `加密资源包中发现${label}`);
  }
}

function verifyResourcesInventory() {
  assert(fs.existsSync(resourcesRoot), `缺少资源目录：${resourcesRoot}`);
  const entries = fs.readdirSync(resourcesRoot, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  const allowed = new Set([
    "app.asar",
    "elevate.exe",
    "fullscreen-monitor.ps1",
  ]);
  for (const entry of entries) {
    assert(allowed.has(entry.name), `resources 中出现额外项目：${entry.name}`);
    assert(entry.isFile(), `resources 中不应包含目录：${entry.name}`);
  }
  assert(names.includes("app.asar"), "resources 缺少 app.asar");
  assert(
    names.includes("fullscreen-monitor.ps1"),
    "resources 缺少全屏监测脚本",
  );
}

function verifyFullscreenHelper() {
  const source = path.join(projectRoot, "scripts", "fullscreen-monitor.ps1");
  assert(fs.existsSync(fullscreenPath), "正式包缺少全屏监测脚本");
  assert(
    sha256File(source) === sha256File(fullscreenPath),
    "正式包全屏监测脚本与受信源文件不一致",
  );
}

async function verifyFuses() {
  assert(fs.existsSync(executablePath), `缺少目录版程序：${executablePath}`);
  const wire = await getCurrentFuseWire(executablePath);
  const expected = new Map([
    [FuseV1Options.RunAsNode, FUSE_DISABLED],
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FUSE_DISABLED],
    [FuseV1Options.EnableNodeCliInspectArguments, FUSE_DISABLED],
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FUSE_ENABLED],
    [FuseV1Options.OnlyLoadAppFromAsar, FUSE_ENABLED],
    [FuseV1Options.GrantFileProtocolExtraPrivileges, FUSE_DISABLED],
  ]);
  for (const [fuse, state] of expected) {
    assert(wire[fuse] === state, `Electron Fuse ${fuse} 状态不符合预期`);
  }
}

function writePortableHashIfPresent() {
  const filename = `${productName}-${packageJson.version}.exe`;
  const portablePath = path.join(releaseRoot, filename);
  if (!fs.existsSync(portablePath)) {
    assert(!requirePortable, `缺少最终便携版：${portablePath}`);
    return null;
  }
  const portableIsCurrent =
    fs.statSync(portablePath).mtimeMs >= fs.statSync(asarPath).mtimeMs;
  assert(
    !requirePortable || portableIsCurrent,
    "最终便携版早于本次目录构建，拒绝作为当前成品",
  );
  if (!portableIsCurrent) return null;
  const hash = sha256File(portablePath);
  const hashPath = `${portablePath}.sha256.txt`;
  fs.writeFileSync(hashPath, `${hash}  ${filename}\n`, "utf8");
  return { filename, hash, hashPath };
}

async function main() {
  verifyAsarInventory();
  verifyResourcesInventory();
  verifyFullscreenHelper();
  await verifyFuses();
  const portable = writePortableHashIfPresent();
  console.log("加固包检查通过：ASAR 白名单、资源加密与 Electron Fuses 均有效");
  if (portable) {
    console.log(`便携版 SHA-256：${portable.hash}`);
    console.log(`校验文件：${portable.hashPath}`);
  }
}

main().catch((error) => {
  console.error("加固包检查失败：", error);
  process.exitCode = 1;
});
