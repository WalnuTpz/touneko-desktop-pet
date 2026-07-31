const assert = require("node:assert/strict");
const {
  StableValueTracker,
  THROW_MAX_SPEED,
  candidatesOutsideRecent,
  chooseGifLoopCount,
  decelerateVelocity,
  estimateReleaseVelocity,
  pickWeighted,
  pickWithRecent,
  pushRecent,
  randomInteger,
  reflectVelocity,
  shortestAngleDelta,
  validCycleCounts,
} = require("../src/core");

assert.equal(THROW_MAX_SPEED, 3000);

function sequenceRandom(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function assertClose(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

assert.equal(randomInteger(2, 4, () => 0), 2);
assert.equal(randomInteger(2, 4, () => 0.999), 4);

assert.equal(
  pickWeighted(
    [
      { id: "static", kind: "static" },
      { id: "gif", kind: "gif" },
    ],
    (item) => (item.kind === "static" ? 2 : 1),
    () => 0.5,
  ).id,
  "static",
);
assert.equal(
  pickWeighted(
    [
      { id: "static", kind: "static" },
      { id: "gif", kind: "gif" },
    ],
    (item) => (item.kind === "static" ? 2 : 1),
    () => 0.9,
  ).id,
  "gif",
);

assert.deepEqual(
  candidatesOutsideRecent(["a", "b", "c", "d", "e", "f"], ["a", "b", "c", "d", "e"]),
  ["f"],
);
assert.deepEqual(
  candidatesOutsideRecent(["a", "b"], ["x", "a", "b"]),
  ["a"],
);
assert.equal(
  pickWithRecent(["a", "b", "c"], ["a", "b"], () => 1, () => 0),
  "c",
);

let recent = [];
for (const id of ["a", "b", "c", "d", "e", "f"]) {
  recent = pushRecent(recent, id);
}
assert.deepEqual(recent, ["b", "c", "d", "e", "f"]);

assert.equal(chooseGifLoopCount(7000, () => 0), 1);
assert.equal(chooseGifLoopCount(5000, () => 0), 1);
assert.equal(chooseGifLoopCount(3000, () => 0), 1);
assert.equal(chooseGifLoopCount(1000, () => 0), 3);
assert.equal(chooseGifLoopCount(1000, () => 0.999), 6);
assert.equal(chooseGifLoopCount(540, sequenceRandom([0.5])), 9);

assert.deepEqual(validCycleCounts(1000), [3, 4, 5, 6, 7, 8]);
assert.deepEqual(validCycleCounts(1500, 3000, 3000), [2]);
assert.deepEqual(validCycleCounts(5000, 3000, 4000), []);
assert.throws(() => validCycleCounts(0), RangeError);
assert.throws(() => validCycleCounts(Number.NaN), RangeError);

assert.deepEqual(
  estimateReleaseVelocity([
    { x: 0, y: 0, time: 0 },
    { x: 10, y: 10, time: 100 },
    { x: 40, y: 50, time: 200 },
  ]),
  { x: 300, y: 400, speed: 500 },
);
assert.deepEqual(
  estimateReleaseVelocity([
    { x: -100, y: -100, time: 79 },
    { x: 0, y: 0, time: 80 },
    { x: 12, y: 0, time: 200 },
  ]),
  { x: 100, y: 0, speed: 100 },
);
const cappedVelocity = estimateReleaseVelocity([
  { x: 0, y: 0, time: 0 },
  { x: 300, y: 400, time: 100 },
]);
assert.deepEqual(cappedVelocity, { x: 1800, y: 2400, speed: 3000 });
assert.deepEqual(estimateReleaseVelocity([]), { x: 0, y: 0, speed: 0 });
assert.deepEqual(
  estimateReleaseVelocity([
    { x: 0, y: 0, time: 10 },
    { x: 5, y: 5, time: 10 },
  ]),
  { x: 0, y: 0, speed: 0 },
);

const slowedVelocity = decelerateVelocity({ x: 3, y: 4 }, 2, 1000);
assertClose(slowedVelocity.x, 1.8);
assertClose(slowedVelocity.y, 2.4);
assertClose(slowedVelocity.speed, 3);
assert.deepEqual(decelerateVelocity({ x: 3, y: 4 }, 10, 1000), {
  x: 0,
  y: 0,
  speed: 0,
});

assert.deepEqual(reflectVelocity({ x: 10, y: -20 }, 1, 1, 0.5), {
  x: -5,
  y: 10,
  speed: Math.hypot(5, 10),
});
assert.deepEqual(reflectVelocity({ x: 10, y: -20 }, 1, 0, 0.5), {
  x: -5,
  y: -20,
  speed: Math.hypot(5, 20),
});

assertClose(
  shortestAngleDelta((350 * Math.PI) / 180, (10 * Math.PI) / 180),
  (20 * Math.PI) / 180,
);
assertClose(
  shortestAngleDelta((10 * Math.PI) / 180, (350 * Math.PI) / 180),
  (-20 * Math.PI) / 180,
);
assert.equal(Math.abs(shortestAngleDelta(0, Math.PI * 3)), Math.PI);

const stable = new StableValueTracker(null);
assert.deepEqual(stable.sample("display-1", 3), {
  changed: false,
  value: null,
  candidate: "display-1",
  count: 1,
});
assert.equal(stable.sample("display-1", 3).changed, false);
assert.equal(stable.sample("display-1", 3).changed, true);
assert.equal(stable.current(), "display-1");
assert.equal(stable.sample(null, 2).changed, false);
assert.equal(stable.sample("display-1", 3).changed, false);
assert.equal(stable.sample(null, 2).changed, false);
assert.equal(stable.sample(null, 2).changed, true);
assert.equal(stable.current(), null);

console.log("core.test.js 通过");
