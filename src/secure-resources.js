const crypto = require("node:crypto");

const PACK_MAGIC = Buffer.from("TMRES01\0", "ascii");
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = PACK_MAGIC.length + IV_BYTES + TAG_BYTES;

function normalizeResourcePath(value) {
  const normalized = String(value ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  const segments = normalized.split("/");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.includes(":") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`非法资源路径：${value}`);
  }
  return segments.join("/");
}

function normalizeKey(value) {
  const key = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (key.length !== KEY_BYTES) {
    throw new Error(`资源密钥必须为 ${KEY_BYTES} 字节`);
  }
  return key;
}

function entryPairs(entries) {
  if (entries instanceof Map) return [...entries.entries()];
  if (Array.isArray(entries)) return entries;
  if (entries && typeof entries === "object") return Object.entries(entries);
  throw new TypeError("资源条目必须是 Map、数组或普通对象");
}

function createEncryptedPack(entries, keyValue, options = {}) {
  const key = normalizeKey(keyValue);
  const iv = options.iv ? Buffer.from(options.iv) : crypto.randomBytes(IV_BYTES);
  if (iv.length !== IV_BYTES) {
    throw new Error(`资源包 IV 必须为 ${IV_BYTES} 字节`);
  }

  const normalized = new Map();
  for (const [rawPath, rawData] of entryPairs(entries)) {
    const resourcePath = normalizeResourcePath(rawPath);
    if (normalized.has(resourcePath)) {
      throw new Error(`资源路径重复：${resourcePath}`);
    }
    const data = Buffer.from(rawData);
    if (data.length === 0) {
      throw new Error(`资源内容为空：${resourcePath}`);
    }
    normalized.set(resourcePath, data);
  }

  const index = Object.create(null);
  const payloadParts = [];
  let offset = 0;
  for (const [resourcePath, data] of [...normalized.entries()].sort(
    ([left], [right]) => left.localeCompare(right, "en"),
  )) {
    index[resourcePath] = [offset, data.length];
    payloadParts.push(data);
    offset += data.length;
  }

  const indexBuffer = Buffer.from(JSON.stringify(index), "utf8");
  const indexLength = Buffer.allocUnsafe(4);
  indexLength.writeUInt32BE(indexBuffer.length);
  const plaintext = Buffer.concat([indexLength, indexBuffer, ...payloadParts]);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(PACK_MAGIC);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([PACK_MAGIC, iv, tag, encrypted]);
}

function openEncryptedPack(packValue, keyValue) {
  const key = normalizeKey(keyValue);
  const pack = Buffer.from(packValue);
  if (pack.length <= HEADER_BYTES) {
    throw new Error("加密资源包不完整");
  }
  const magic = pack.subarray(0, PACK_MAGIC.length);
  if (
    magic.length !== PACK_MAGIC.length ||
    !crypto.timingSafeEqual(magic, PACK_MAGIC)
  ) {
    throw new Error("加密资源包格式不受支持");
  }

  const ivStart = PACK_MAGIC.length;
  const tagStart = ivStart + IV_BYTES;
  const encryptedStart = tagStart + TAG_BYTES;
  const iv = pack.subarray(ivStart, tagStart);
  const tag = pack.subarray(tagStart, encryptedStart);
  const encrypted = pack.subarray(encryptedStart);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(PACK_MAGIC);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  if (plaintext.length < 4) {
    throw new Error("资源包索引缺失");
  }

  const indexLength = plaintext.readUInt32BE(0);
  const payloadStart = 4 + indexLength;
  if (indexLength <= 0 || payloadStart > plaintext.length) {
    throw new Error("资源包索引长度无效");
  }

  let rawIndex;
  try {
    rawIndex = JSON.parse(plaintext.subarray(4, payloadStart).toString("utf8"));
  } catch (error) {
    throw new Error(`资源包索引损坏：${error.message}`);
  }
  if (!rawIndex || Array.isArray(rawIndex) || typeof rawIndex !== "object") {
    throw new Error("资源包索引格式无效");
  }

  const index = new Map();
  for (const [rawPath, value] of Object.entries(rawIndex)) {
    const resourcePath = normalizeResourcePath(rawPath);
    if (index.has(resourcePath)) {
      throw new Error(`资源索引路径重复：${resourcePath}`);
    }
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      !value.every(Number.isSafeInteger)
    ) {
      throw new Error(`资源索引条目无效：${resourcePath}`);
    }
    const [offset, length] = value;
    if (
      offset < 0 ||
      length <= 0 ||
      payloadStart + offset + length > plaintext.length
    ) {
      throw new Error(`资源索引越界：${resourcePath}`);
    }
    index.set(resourcePath, { offset, length });
  }
  const intervals = [...index.entries()].sort(
    ([, left], [, right]) => left.offset - right.offset,
  );
  let cursor = 0;
  for (const [resourcePath, entry] of intervals) {
    if (entry.offset !== cursor) {
      throw new Error(`资源索引存在重叠或空洞：${resourcePath}`);
    }
    cursor += entry.length;
  }
  if (payloadStart + cursor !== plaintext.length) {
    throw new Error("资源索引未覆盖完整载荷");
  }

  return Object.freeze({
    has(resourcePath) {
      return index.has(normalizeResourcePath(resourcePath));
    },
    list() {
      return [...index.keys()];
    },
    read(resourcePath) {
      const normalizedPath = normalizeResourcePath(resourcePath);
      const entry = index.get(normalizedPath);
      if (!entry) throw new Error(`资源不存在：${normalizedPath}`);
      const start = payloadStart + entry.offset;
      return Buffer.from(plaintext.subarray(start, start + entry.length));
    },
  });
}

module.exports = {
  IV_BYTES,
  KEY_BYTES,
  PACK_MAGIC,
  createEncryptedPack,
  normalizeResourcePath,
  openEncryptedPack,
};
