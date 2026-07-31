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
assert.equal(new Set(OPENING_DIALOGUE).size, 4);
for (const message of OPENING_DIALOGUE) {
  assert.ok(message.length >= 12 && message.length <= 24);
}

const latestV2Themes = [
  "擦干眼泪",
  "揣手",
  "趴下起来",
  "寄了",
  "凌乱1",
  "凌乱2",
  "趴5",
  "穷",
  "照相",
];
for (const theme of latestV2Themes) {
  assert.equal(
    ACTION_DIALOGUE[theme]?.length,
    4,
    `第二版补充主题应有四条气泡文案：${theme}`,
  );
}
assert.equal(ACTION_DIALOGUE.呆住, undefined, "更名后的呆住主题不应继续保留");
assert.equal(ACTION_DIALOGUE.抬腿, undefined, "移动专用素材不应保留动作气泡");

const v3Dialogue = {
  舞萌猫: [
    "要开始了哟！",
    "不要大力拍打或滑动哦！",
    "Let's go!!!",
    "今天也要冲个鸟加！",
  ],
  舞萌猫2: [
    "不可以打我哟！",
    "这颗绝赞我接住啦！",
    "转圈拍键，忙不过来啦！",
    "新纪录！大神降临！",
  ],
  倒立: [
    "世界怎么倒过来了？",
    "换个角度看看你！",
    "倒着也要卖个萌～",
    "我在练习猫猫倒立！",
  ],
  飞猫: [
    "芜湖，起飞！",
    "糖猫航班出发啦！",
    "今天的风很适合飞行～",
    "看我飞过来！",
  ],
  看不懂2: [
    "我再眯眼看看……",
    "看懂了吗？反正我没有。",
    "这题是不是超纲了？",
    "让我假装已经明白。",
  ],
};
for (const [theme, messages] of Object.entries(v3Dialogue)) {
  assert.deepEqual(ACTION_DIALOGUE[theme], messages);
}

for (const [name, messages] of Object.entries(ACTION_DIALOGUE)) {
  assert.equal(messages.length, 4, `主题应有四条气泡文案：${name}`);
  assert.equal(
    new Set(messages).size,
    4,
    `主题的四条气泡文案不能相同：${name}`,
  );
  for (const message of messages) {
    assert.equal(typeof message, "string");
    assert.ok(message.trim().length > 0);
    assert.ok(message.length >= 2 && message.length <= 24);
  }
}

for (const actionId of manifest.actions) {
  const asset = manifest.assets[actionId];
  const normalizedName = normalizeAssetName(asset.name);
  assert.ok(
    ACTION_DIALOGUE[normalizedName],
    `普通动作缺少专属气泡文案：${asset.name}`,
  );
  const messages = messagesForAsset(asset.name);
  assert.equal(messages, ACTION_DIALOGUE[normalizedName]);
}

console.log("dialogue.test.js 通过");
