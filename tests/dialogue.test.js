const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  ACTION_DIALOGUE,
  dialogueForAsset,
  normalizeAssetName,
} = require("../src/dialogue");

const projectRoot = path.join(__dirname, "..");
const manifest = JSON.parse(
  fs.readFileSync(
    path.join(projectRoot, "assets", "generated", "manifest.json"),
    "utf8",
  ),
);

assert.equal(normalizeAssetName("4_工作3"), "工作3");
assert.equal(dialogueForAsset("爱你", () => 0), "最喜欢你啦！");
assert.equal(dialogueForAsset("爱你", () => 0.999), "给你比个心～");
assert.equal(dialogueForAsset("新增动作", () => 0), "看我的小表演～");

for (const actionId of manifest.actions) {
  const asset = manifest.assets[actionId];
  const normalizedName = normalizeAssetName(asset.name);
  assert.ok(
    ACTION_DIALOGUE[normalizedName],
    `普通动作缺少专属气泡文案：${asset.name}`,
  );
  const message = dialogueForAsset(asset.name, () => 0);
  assert.ok(message.length >= 2 && message.length <= 24);
}

console.log("dialogue.test.js 通过");
