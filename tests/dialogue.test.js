const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  ACTION_DIALOGUE,
  OPENING_DIALOGUE,
  bubbleMessageForAction,
  dialogueForAction,
  messagesForAction,
  openingDialogueForLaunch,
} = require("../src/dialogue");

const projectRoot = path.join(__dirname, "..");
const manifest = JSON.parse(
  fs.readFileSync(
    path.join(projectRoot, "assets", "generated", "manifest.json"),
    "utf8",
  ),
);

assert.equal(dialogueForAction("love", () => 0), "最喜欢你啦！");
assert.equal(dialogueForAction("love", () => 0.25), "给你比个心～");
assert.equal(dialogueForAction("love", () => 0.5), "今天也分你一颗心！");
assert.equal(dialogueForAction("love", () => 0.75), "最最喜欢你啦～");
assert.throws(() => dialogueForAction("missing-action"), /缺少气泡文案/);
assert.equal(bubbleMessageForAction("love", () => 0.5), "今天也分你一颗心！");

assert.equal(openingDialogueForLaunch(() => 0), OPENING_DIALOGUE[0]);
assert.equal(openingDialogueForLaunch(() => 0.25), OPENING_DIALOGUE[1]);
assert.equal(openingDialogueForLaunch(() => 0.5), OPENING_DIALOGUE[2]);
assert.equal(openingDialogueForLaunch(() => 0.75), OPENING_DIALOGUE[3]);
assert.equal(OPENING_DIALOGUE.length, 4);
assert.equal(new Set(OPENING_DIALOGUE).size, 4);
for (const message of OPENING_DIALOGUE) {
  assert.ok(message.length >= 12 && message.length <= 24);
}

const representativeDialogue = {
  "maimai-1": [
    "要开始了哟！",
    "不要大力拍打或滑动哦！",
    "Let's go!!!",
    "今天也要冲个鸟加！",
  ],
  "maimai-2": [
    "不可以打我哟！",
    "这颗绝赞我接住啦！",
    "转圈拍键，忙不过来啦！",
    "新纪录！大神降临！",
  ],
  handstand: [
    "世界怎么倒过来了？",
    "换个角度看看你！",
    "倒着也要卖个萌～",
    "我在练习猫猫倒立！",
  ],
  flying: [
    "芜湖，起飞！",
    "糖猫航班出发啦！",
    "今天的风很适合飞行～",
    "看我飞过来！",
  ],
  "confused-2": [
    "我再眯眼看看……",
    "看懂了吗？反正我没有。",
    "这题是不是超纲了？",
    "让我假装已经明白。",
  ],
};
for (const [dialogueId, messages] of Object.entries(representativeDialogue)) {
  assert.deepEqual(ACTION_DIALOGUE[dialogueId], messages);
}

for (const [dialogueId, messages] of Object.entries(ACTION_DIALOGUE)) {
  assert.equal(messages.length, 4, `主题应有四条气泡文案：${dialogueId}`);
  assert.equal(
    new Set(messages).size,
    4,
    `主题的四条气泡文案不能相同：${dialogueId}`,
  );
  for (const message of messages) {
    assert.equal(typeof message, "string");
    assert.ok(message.trim().length > 0);
    assert.ok(message.length >= 2 && message.length <= 24);
  }
}

const referencedDialogueIds = new Set();
for (const actionId of manifest.actions) {
  const asset = manifest.assets[actionId];
  assert.equal(typeof asset.dialogueId, "string", `动作缺少文案 ID：${actionId}`);
  assert.equal(
    messagesForAction(asset.dialogueId),
    ACTION_DIALOGUE[asset.dialogueId],
  );
  referencedDialogueIds.add(asset.dialogueId);
}
assert.deepEqual(
  [...referencedDialogueIds].sort(),
  Object.keys(ACTION_DIALOGUE).sort(),
  "文案主题应与普通动作使用的主题完全一致",
);

console.log("dialogue.test.js 通过");
