const assert = require("node:assert/strict");
const {
  candidatesOutsideRecent,
  chooseGifLoopCount,
  pickWeighted,
  pickWithRecent,
  pushRecent,
  randomInteger,
} = require("../src/core");

function sequenceRandom(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
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

assert.equal(chooseGifLoopCount(5000, () => 0), 1);
assert.equal(chooseGifLoopCount(3000, () => 0), 1);
assert.equal(chooseGifLoopCount(1000, () => 0), 2);
assert.equal(chooseGifLoopCount(1000, () => 0.999), 4);
assert.equal(chooseGifLoopCount(540, sequenceRandom([0.5])), 6);

console.log("core.test.js 通过");
