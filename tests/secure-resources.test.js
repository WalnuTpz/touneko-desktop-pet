const assert = require("node:assert/strict");

const {
  createEncryptedPack,
  normalizeResourcePath,
  openEncryptedPack,
} = require("../src/secure-resources");

const key = Buffer.alloc(32, 0x2a);
const entries = new Map([
  ["app/index.html", Buffer.from("<h1>糖猫</h1>", "utf8")],
  ["app/assets/cat.png", Buffer.from([0x89, 0x50, 0x4e, 0x47])],
]);
const pack = createEncryptedPack(entries, key, { iv: Buffer.alloc(12, 0x18) });
const store = openEncryptedPack(pack, key);

assert.deepEqual(store.list(), ["app/assets/cat.png", "app/index.html"]);
assert.equal(store.read("app/index.html").toString("utf8"), "<h1>糖猫</h1>");
assert.deepEqual(
  [...store.read("app/assets/cat.png")],
  [0x89, 0x50, 0x4e, 0x47],
);
assert.equal(normalizeResourcePath("\\app\\index.html"), "app/index.html");
assert.throws(() => normalizeResourcePath("../secret"), /非法资源路径/);
assert.throws(
  () =>
    createEncryptedPack(
      [
        ["/app/index.html", Buffer.from("a")],
        ["app/index.html", Buffer.from("b")],
      ],
      key,
    ),
  /资源路径重复/,
);
assert.throws(
  () => createEncryptedPack({ "app/empty": Buffer.alloc(0) }, key),
  /资源内容为空/,
);
assert.throws(
  () => openEncryptedPack(pack, Buffer.alloc(32, 0x2b)),
  /authenticate|认证|Unsupported state/i,
);

const tampered = Buffer.from(pack);
tampered[tampered.length - 1] ^= 0x01;
assert.throws(
  () => openEncryptedPack(tampered, key),
  /authenticate|认证|Unsupported state/i,
);

console.log("secure-resources.test.js 通过");
