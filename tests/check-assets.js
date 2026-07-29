const fs = require("node:fs");
const path = require("node:path");

const rendererPath = path.join(__dirname, "..", "src", "renderer.js");
const assetRoot = path.join(
  __dirname,
  "..",
  "assets",
  "local",
  "糖猫合集",
);
const source = fs.readFileSync(rendererPath, "utf8");
const references = [
  ...new Set([...source.matchAll(/"([^"]+\.(?:png|gif))"/g)].map((match) => match[1])),
];
const missing = references.filter(
  (reference) => !fs.existsSync(path.join(assetRoot, ...reference.split("/"))),
);

console.log(`检查了 ${references.length} 个素材引用。`);
if (missing.length) {
  console.error(`缺少素材：${missing.join("、")}`);
  process.exitCode = 1;
} else {
  console.log("所有素材引用均存在。");
}
