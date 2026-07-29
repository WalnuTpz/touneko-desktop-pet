const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  ACTION_DIALOGUE,
  OPENING_DIALOGUE,
  bubbleMessageForAction,
  dialogueForAsset,
  messagesForAsset,
  normalizeAssetName,
  openingDialogueForLaunch,
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
assert.equal(dialogueForAsset("爱你", () => 0.25), "给你比个心～");
assert.equal(dialogueForAsset("爱你", () => 0.5), "今天也分你一颗心！");
assert.equal(dialogueForAsset("爱你", () => 0.75), "最最喜欢你啦～");
assert.equal(dialogueForAsset("新增动作", () => 0), "看我的小表演～");
assert.equal(
  dialogueForAsset("新增动作", () => 0.75),
  "再送你一个新表情。",
);
assert.equal(
  bubbleMessageForAction("爱你", () => 0),
  "最喜欢你啦！",
);
assert.equal(
  bubbleMessageForAction("爱你", () => 0.25),
  "给你比个心～",
);
assert.equal(
  bubbleMessageForAction("爱你", () => 0.5),
  "今天也分你一颗心！",
);
assert.equal(
  bubbleMessageForAction("爱你", () => 0.75),
  "最最喜欢你啦～",
);
assert.equal(openingDialogueForLaunch(() => 0), OPENING_DIALOGUE[0]);
assert.equal(openingDialogueForLaunch(() => 0.25), OPENING_DIALOGUE[1]);
assert.equal(openingDialogueForLaunch(() => 0.5), OPENING_DIALOGUE[2]);
assert.equal(openingDialogueForLaunch(() => 0.75), OPENING_DIALOGUE[3]);
assert.equal(OPENING_DIALOGUE.length, 4);
for (const message of OPENING_DIALOGUE) {
  assert.ok(message.length >= 12 && message.length <= 24);
}

for (const actionId of manifest.actions) {
  const asset = manifest.assets[actionId];
  const normalizedName = normalizeAssetName(asset.name);
  assert.ok(
    ACTION_DIALOGUE[normalizedName],
    `普通动作缺少专属气泡文案：${asset.name}`,
  );
  const messages = messagesForAsset(asset.name);
  assert.equal(messages.length, 4, `动作应有四条气泡文案：${asset.name}`);
  assert.equal(
    new Set(messages).size,
    4,
    `动作的四条气泡文案不能相同：${asset.name}`,
  );
  for (const message of messages) {
    assert.equal(typeof message, "string");
    assert.ok(message.trim().length > 0);
    assert.ok(message.length >= 2 && message.length <= 24);
  }
}

console.log("dialogue.test.js 通过");
