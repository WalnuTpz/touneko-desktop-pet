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
const outputPath = path.join(projectRoot, "docs", "气泡文案.md");

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
  "本文列出当前开场白与普通动作气泡，按动作主题组织。同一主题可以供多份素材使用。内容由 `src/dialogue.js` 与生成素材清单共同生成。",
  "",
  "完整启动时等概率选择一条开场白，显示约 3.5 秒。每次自动普通动作、单击、双击或右键随机动作，从对应主题的四条文案中等概率选择一条；气泡跟随动作显示并在结束前淡出。全屏隐藏暂停气泡计时，恢复后继续。",
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
lines.push(
  "",
  "## 更新文案",
  "",
  "在 `src/dialogue.js` 修改文字；素材共用主题时，在 `assets/catalog.json` 的 `dialogueAliases` 维护映射。安装项目依赖并准备本地素材后，在项目根目录运行：",
  "",
  "```powershell",
  "npm run prepare:assets",
  "node tests/dialogue.test.js",
  "npm run docs:dialogue",
  "```",
  "",
  "文档排版由 `scripts/render_dialogue_doc.js` 生成。",
  "",
);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, lines.join("\n"), "utf8");
console.log(`已生成气泡文案文档：${outputPath}`);
