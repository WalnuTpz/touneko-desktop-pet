const fs = require("node:fs");
const path = require("node:path");

const {
  OPENING_DIALOGUE,
  messagesForAction,
} = require("../src/dialogue");

const THEME_DISPLAY_NAMES = Object.freeze({
  "sign-qu": "sign-qu／qu／蛆",
});
const KIND_ORDER = Object.freeze(["静态", "GIF"]);

const projectRoot = path.join(__dirname, "..");
const manifestPath = path.join(
  projectRoot,
  "assets",
  "generated",
  "manifest.json",
);
const outputPath = path.join(projectRoot, "build", "气泡文案.md");

if (!fs.existsSync(manifestPath)) {
  throw new Error("缺少生成素材清单，请先运行 npm run prepare:assets");
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const themes = new Map();
for (const assetId of manifest.actions) {
  const asset = manifest.assets[assetId];
  if (!themes.has(asset.dialogueId)) themes.set(asset.dialogueId, new Set());
  themes.get(asset.dialogueId).add(asset.kind === "gif" ? "GIF" : "静态");
}

const sortedThemes = [...themes.entries()].sort(([left], [right]) =>
  left.localeCompare(right, "en"),
);
const lines = [
  "# 糖猫桌宠气泡文案",
  "",
  "本地预览由 `src/dialogue.js` 与生成 manifest 导出，按当前动作主题列出文案。",
  "",
  "## 启动开场白",
  "",
  `共 ${OPENING_DIALOGUE.length} 条：`,
  "",
  ...OPENING_DIALOGUE.map((message, index) => `${index + 1}. ${message}`),
  "",
  "## 普通动作气泡",
  "",
  `共 ${manifest.actions.length} 个素材、${sortedThemes.length} 个文案主题，每个主题 4 条：`,
  "",
];

for (const [name, kinds] of sortedThemes) {
  const displayName = THEME_DISPLAY_NAMES[name] || name;
  const sortedKinds = [...kinds].sort(
    (left, right) => KIND_ORDER.indexOf(left) - KIND_ORDER.indexOf(right),
  );
  const messages = messagesForAction(name)
    .map((message, index) => `${"①②③④"[index]} ${message}`)
    .join("　");
  lines.push(
    `- **${displayName}（${sortedKinds.join("、")}）**：${messages}`,
  );
}
lines.push("");

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, lines.join("\n"), "utf8");
console.log(`已生成气泡文案预览：${outputPath}`);
