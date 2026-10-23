const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "assets/generated/manifest.json")));

// Only the browser/IPC boundary is replaced; run the complete production renderer.
async function createRenderer() {
  let now = 0;
  let nextTimer = 0;
  const timers = new Map();
  const events = new Map();
  let pixelAlpha = 255;
  let commandHandler;
  let pointerPosition = async () => ({ clientX: -1000, clientY: -1000, screenX: -1000, screenY: -1000 });
  function element(name) {
    const classes = new Set();
    const listeners = new Map();
    return {
      dataset: {}, style: { setProperty() {} }, textContent: "", offsetWidth: 120, offsetHeight: 40,
      complete: true, naturalWidth: 100, width: 100, height: 100,
      classList: {
        add: (...values) => values.forEach((value) => classes.add(value)),
        remove: (...values) => values.forEach((value) => classes.delete(value)),
        contains: (value) => classes.has(value),
      },
      addEventListener: (type, fn) => listeners.set(type, fn),
      emit: (type, event = {}) => listeners.get(type)?.(event),
      setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {},
      getContext: () => ({ clearRect() {}, drawImage() {}, getImageData: () => ({ data: [0, 0, 0, pixelAlpha] }) }),
      decode: async () => {},
      get src() { return this.source || ""; },
      set src(value) {
        this.source = value;
        if (name === "image") queueMicrotask(() => listeners.get("load")?.());
      },
    };
  }
  const stage = element("stage");
  const image = element("image");
  const bubble = element("bubble");
  const context = vm.createContext({
    console, URL, queueMicrotask,
    performance: { now: () => now },
    setTimeout: (callback, delay) => {
      const id = ++nextTimer;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: () => ++nextTimer, cancelAnimationFrame() {},
    Image: function () { return element("preload"); },
    document: {
      querySelector: (selector) => ({ "#pet-stage": stage, "#pet-image": image, "#speech-bubble": bubble })[selector],
      createElement: () => element("canvas"),
    },
    window: {
      location: { href: "file:///pet/src/index.html" },
      addEventListener: (type, fn) => events.set(type, fn),
      desktopPet: {
        getBootstrap: async () => ({ manifest, window: { width: 960, height: 900 }, doubleClickDelayMs: 500,
          runtime: { personality: "default", environmentAwareness: true, scale: 1 }, environment: {}, smokeTest: true }),
        onCommand: (fn) => { commandHandler = fn; }, reportReady() {},
        reportFailure: (error) => { throw new Error(error); }, reportPlaying() {},
        updateLayout() {}, setPointerRegion() {}, dragStart() {}, dragEnd() {},
        getPointerPosition: () => pointerPosition(),
        moveBy: async () => ({ hitX: 0, hitY: 0 }), dragMove: async () => ({ flipHorizontal: false }),
        openMenu() {},
      },
    },
  });
  vm.runInContext("Math.random = () => 0.5", context);
  for (const file of ["core.js", "dialogue.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, "src", file), "utf8"), context);
  }
  context.window.PetCore = context.PetCore;
  context.window.PetDialogue = context.PetDialogue;
  vm.runInContext(fs.readFileSync(path.join(root, "src/renderer.js"), "utf8"), context);
  const flush = () => new Promise(setImmediate);
  await flush();
  const run = (code) => vm.runInContext(code, context);
  async function advance(ms) {
    const until = now + ms;
    while (true) {
      const due = [...timers].filter(([, value]) => value.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at;
      timers.delete(due[0]);
      due[1].callback();
      await flush();
    }
    now = until;
    await flush();
  }
  return { run, advance, stage, flush,
    pixelAlpha: (alpha) => { pixelAlpha = alpha; },
    command: (payload) => commandHandler(payload),
    pointer: (fn) => { pointerPosition = fn; },
  };
}

test("environment weighting uses the semantic daily IDs", async () => {
  const r = await createRenderer();
  r.run('Math.random = () => 0.3; state.environment = { night: true };');
  assert.equal(r.run("pickDaily().id"), "obedient");
  // The midpoint selects sleeping with weight 3, but obedient with uniform weights.
  r.run("Math.random = () => 0.5;");
  assert.equal(r.run("pickDaily().id"), "sleeping");
  r.run('state.environment = { workBias: true, night: true };');
  assert.equal(r.run("pickDaily().id"), "working");
  r.command({ command: "set-environment-awareness", value: false });
  assert.equal(r.run("pickDaily().id"), "obedient");
});

test("a click during landing cannot leak into the following daily state", async () => {
  const r = await createRenderer();
  r.run("startThrow({ x: 1000, y: 0, speed: 1000 }); finishThrow(state.movement); state.actionTimer.start(100);");
  const point = r.run("petCenter()");
  r.stage.emit("click", { clientX: point.x, clientY: point.y });
  await r.advance(600);
  assert.equal(r.run("state.mode"), "daily");
});

test("click-through cancels a pending single click", async () => {
  const r = await createRenderer();
  r.run("scheduleSingleClick();");
  r.command({ command: "set-click-through", value: true });
  await r.advance(600);
  assert.equal(r.run("state.mode"), "daily");
});

test("transparent space cannot start a click action", async () => {
  const r = await createRenderer();
  const point = r.run("petCenter()");
  // A transparent pixel inside the rectangular native window shape still receives clicks.
  r.pixelAlpha(0);
  r.stage.emit("click", { clientX: point.x, clientY: point.y });
  await r.advance(600);
  assert.equal(r.run("state.mode"), "daily");
});

test("a late pointer response cannot change the fullscreen-paused state", async () => {
  const r = await createRenderer();
  let reply;
  r.pointer(() => new Promise((resolve) => { reply = resolve; }));
  const polling = r.run("pollPointerPosition()");
  r.command({ command: "fullscreen-pause" });
  const point = r.run("petCenter()");
  reply({ clientX: point.x, clientY: point.y, screenX: point.x, screenY: point.y });
  await polling;
  assert.equal(r.run("state.mode"), "daily");
});

test("system double-click interval prevents an early single-click action", async () => {
  const r = await createRenderer();
  r.run("scheduleSingleClick();");
  await r.advance(400);
  assert.equal(r.run("state.mode"), "daily");
  r.run('cancelDelayedSingleClick(); handleClickIntent("double");');
  await r.flush();
  assert.equal(r.run("state.mode"), "action-gif");
  assert.equal(r.run("state.recent.length"), 1);
});


test("holding the second mouse press cannot let the first click fire", async () => {
  const r = await createRenderer();
  r.run("scheduleSingleClick();");
  await r.advance(400);
  r.stage.emit("mousedown", { button: 0, detail: 2 });
  await r.advance(400);
  assert.equal(r.run("state.mode"), "daily");
});
