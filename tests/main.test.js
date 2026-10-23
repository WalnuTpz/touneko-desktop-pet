const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function createMain({ mixedDpi = true } = {}) {
  const commands = [];
  const handlers = new Map();
  // A 200% primary display next to a 100% secondary display. Physical x=1920
  // is still on primary, whereas DIP x=1920 belongs to secondary.
  const displays = [
    { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
    { id: 2, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } },
  ];
  const electron = {
    app: { commandLine: { hasSwitch: () => false }, requestSingleInstanceLock: () => false, quit() {}, on() {} },
    protocol: { registerSchemesAsPrivileged() {} },
    Menu: { buildFromTemplate: (items) => items },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), on: (name, handler) => handlers.set(name, handler) },
    screen: {
      getAllDisplays: () => displays,
      getPrimaryDisplay: () => displays[0],
      getDisplayNearestPoint: ({ x }) => displays[x < 1920 ? 0 : 1],
      screenToDipPoint: ({ x, y }) => !mixedDpi ? { x, y } : x < 3840 ? { x: x / 2, y: y / 2 } : { x: 1920 + x - 3840, y },
    },
  };
  const context = vm.createContext({
    require: (name) => name === "electron" ? electron : name.startsWith("./") ? require(path.join(__dirname, "../src", name)) : require(name),
    __dirname: path.join(__dirname, "../src"), console, Buffer, URL, Response,
    process: { platform: "win32", pid: 999 }, setTimeout, clearTimeout,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8"), context);
  const run = (code) => vm.runInContext(code, context);
  context.sentCommands = commands;
  run(`petWindow = { webContents: { send: (...args) => sentCommands.push(args) },
    hide() {}, isDestroyed: () => false, setIgnoreMouseEvents() {}, showInactive() {} };
    runtime.currentDisplayId = 1;`);
  function sample(ids) {
    const fullscreenWindows = ids.map((id) => ({ processId: 123,
      left: id === 1 ? 0 : mixedDpi ? 3840 : 1920,
      right: id === 1 ? (mixedDpi ? 3840 : 1920) : mixedDpi ? 5760 : 3840,
      top: 0, bottom: mixedDpi ? 2160 : 1080 }));
    context.line = JSON.stringify({ fullscreenWindows, doubleClickDelayMs: 500 });
    run("parseFullscreenLine(line)");
  }
  return { run, sample, commands, handlers };
}

test("fullscreen monitor physical coordinates map to the correct DIP display", () => {
  const m = createMain();
  for (let i = 0; i < 3; i += 1) m.sample([1]);
  assert.equal(m.run("runtime.fullscreenHidden"), true);
});

test("another monitor's changes cannot reset the current monitor's debounce", () => {
  const m = createMain({ mixedDpi: false });
  m.sample([1]); m.sample([1, 2]); m.sample([1]);
  assert.equal(m.run("runtime.fullscreenHidden"), true);
});

test("leaving fullscreen takes two samples even while another display stays fullscreen", () => {
  const m = createMain({ mixedDpi: false });
  m.run("runtime.currentDisplayId = 2");
  for (let i = 0; i < 3; i += 1) m.sample([1, 2]);
  assert.equal(m.run("runtime.fullscreenHidden"), true);
  m.sample([1]); m.sample([1]);
  assert.equal(m.run("runtime.fullscreenHidden"), false);
});

test("bootstrap waits for the Windows double-click setting", async () => {
  const m = createMain();
  m.run("registerIpc()");
  let delivered = false;
  const pending = Promise.resolve(m.handlers.get("pet:get-bootstrap")()).then((value) => { delivered = true; return value; });
  await Promise.resolve();
  assert.equal(delivered, false);
  m.sample([]);
  const bootstrap = await pending;
  assert.equal(bootstrap.doubleClickDelayMs, 500);
});
