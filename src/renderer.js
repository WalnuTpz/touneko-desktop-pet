const stage = document.querySelector("#pet-stage");
const petImage = document.querySelector("#pet-image");
const speechBubble = document.querySelector("#speech-bubble");

const ASSET_ROOT = new URL("../糖猫合集/", window.location.href);
const DEFAULT_ACTION = { file: "站.png", duration: 0 };

const ACTIONS = [
  { file: "动图/得意.gif", duration: 3200, words: ["今天也很得意！", "看我干嘛～"] },
  { file: "动图/敬礼.gif", duration: 2600, words: ["收到！", "保证完成任务！"] },
  { file: "动图/跳跳.gif", duration: 2600, words: ["芜湖！", "跳一下～"] },
  { file: "动图/戴耳机.gif", duration: 4300, words: ["正在听歌♪", "这首好听！"] },
  { file: "动图/智慧.gif", duration: 3600, words: ["让我想想……", "智慧的眼神。"] },
  { file: "动图/看不懂.gif", duration: 3000, words: ["看不懂喵。", "这是什么？"] },
  { file: "动图/哇.gif", duration: 2500, words: ["哇！", "真的假的？"] },
  { file: "动图/吐.gif", duration: 3300, words: ["呕——", "不可以吃这个！"] },
  { file: "坐.png", duration: 4200, words: ["坐一会儿。"] },
  { file: "趴1.png", duration: 4200, words: ["歇会儿～"] },
  { file: "看书.png", duration: 4500, words: ["学习时间。"] },
  { file: "睡.png", duration: 4800, words: ["呼……", "晚安喵。"] },
];

const PET_ACTIONS = [
  { file: "动图/伸手.gif", duration: 3000, words: ["再摸一下！", "贴贴～"] },
  { file: "舒服.png", duration: 3000, words: ["好舒服呀。"] },
  { file: "爱你.png", duration: 3000, words: ["爱你喵！"] },
];

let currentActionTimer = null;
let randomActionTimer = null;
let bubbleTimer = null;
let walkTimer = null;
let autoWander = true;
let walking = false;
let facing = -1;
let pointerState = null;
let suppressClickUntil = 0;
let clickTimer = null;

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomBetween(min, max) {
  return Math.round(min + Math.random() * (max - min));
}

function assetUrl(relativePath) {
  const url = new URL(relativePath, ASSET_ROOT);
  url.searchParams.set("play", String(Date.now()));
  return url.href;
}

function showBubble(message, duration = 1900) {
  if (!message) return;
  clearTimeout(bubbleTimer);
  speechBubble.textContent = message;
  speechBubble.classList.add("visible");
  bubbleTimer = setTimeout(() => speechBubble.classList.remove("visible"), duration);
}

function setFacing(direction) {
  facing = direction >= 0 ? 1 : -1;
  petImage.style.setProperty("--facing", String(facing));
}

function showAction(action, returnToIdle = true) {
  stopWalking();
  clearTimeout(currentActionTimer);
  petImage.src = assetUrl(action.file);

  if (action.words?.length) {
    showBubble(randomItem(action.words), Math.min(action.duration || 2000, 2200));
  }

  if (returnToIdle && action.duration) {
    currentActionTimer = setTimeout(showIdle, action.duration);
  }
}

function showIdle() {
  clearTimeout(currentActionTimer);
  petImage.src = assetUrl(DEFAULT_ACTION.file);
  scheduleRandomAction();
}

function scheduleRandomAction() {
  clearTimeout(randomActionTimer);
  randomActionTimer = setTimeout(() => {
    if (autoWander && Math.random() < 0.28) {
      startWalking(randomBetween(2200, 4800));
    } else {
      showAction(randomItem(ACTIONS));
    }
  }, randomBetween(6500, 12500));
}

function stopWalking() {
  if (walkTimer) clearInterval(walkTimer);
  walkTimer = null;
  walking = false;
}

function startWalking(duration = 4200) {
  if (walking) return;
  clearTimeout(currentActionTimer);
  clearTimeout(randomActionTimer);
  walking = true;
  setFacing(Math.random() < 0.5 ? -1 : 1);
  petImage.src = assetUrl("跑.png");

  const startedAt = Date.now();
  let moving = false;
  walkTimer = setInterval(async () => {
    if (moving) return;
    if (Date.now() - startedAt >= duration) {
      stopWalking();
      showIdle();
      return;
    }

    moving = true;
    try {
      const result = await window.desktopPet.moveBy({ x: facing * 6, y: 0 });
      if (!result.movedX) setFacing(-facing);
    } finally {
      moving = false;
    }
  }, 48);
}

function playRandomAction() {
  showAction(randomItem(ACTIONS));
}

function playPetReaction() {
  showAction(randomItem(PET_ACTIONS));
}

stage.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  pointerState = {
    id: event.pointerId,
    startX: event.screenX,
    startY: event.screenY,
    moved: false,
  };
  stage.setPointerCapture(event.pointerId);
  stage.classList.add("dragging");
  window.desktopPet.dragStart({ screenX: event.screenX, screenY: event.screenY });
});

stage.addEventListener("pointermove", (event) => {
  if (!pointerState || pointerState.id !== event.pointerId) return;
  const distance = Math.hypot(
    event.screenX - pointerState.startX,
    event.screenY - pointerState.startY,
  );
  if (distance > 4) pointerState.moved = true;
  if (pointerState.moved) {
    window.desktopPet.dragMove({ screenX: event.screenX, screenY: event.screenY });
  }
});

function finishPointer(event) {
  if (!pointerState || pointerState.id !== event.pointerId) return;
  if (pointerState.moved) suppressClickUntil = Date.now() + 350;
  pointerState = null;
  stage.classList.remove("dragging");
  if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  window.desktopPet.dragEnd();
}

stage.addEventListener("pointerup", finishPointer);
stage.addEventListener("pointercancel", finishPointer);

stage.addEventListener("click", () => {
  if (Date.now() < suppressClickUntil) return;
  clearTimeout(clickTimer);
  clickTimer = setTimeout(playPetReaction, 230);
});

stage.addEventListener("dblclick", () => {
  if (Date.now() < suppressClickUntil) return;
  clearTimeout(clickTimer);
  showAction({
    file: "动图/跳跳.gif",
    duration: 3000,
    words: ["嘿嘿！", "你又戳我～"],
  });
});

window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  window.desktopPet.openMenu();
});

window.desktopPet.onCommand(({ command, value }) => {
  switch (command) {
    case "pet":
      playPetReaction();
      break;
    case "random-action":
      playRandomAction();
      break;
    case "walk":
      startWalking(5200);
      break;
    case "set-auto-wander":
      autoWander = Boolean(value);
      scheduleRandomAction();
      break;
    default:
      break;
  }
});

window.desktopPet.getSettings().then((savedSettings) => {
  autoWander = savedSettings.autoWander !== false;
  setFacing(-1);
  showIdle();
});
