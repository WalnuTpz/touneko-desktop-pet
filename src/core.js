(function attachPetCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.PetCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createPetCore() {
  function randomBetween(min, max, random = Math.random) {
    return min + random() * (max - min);
  }

  function randomInteger(min, max, random = Math.random) {
    const lower = Math.ceil(min);
    const upper = Math.floor(max);
    if (upper < lower) {
      throw new RangeError("随机整数区间无效");
    }
    return lower + Math.floor(random() * (upper - lower + 1));
  }

  function pickUniform(items, random = Math.random) {
    if (!Array.isArray(items) || items.length === 0) {
      return null;
    }
    return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
  }

  function pickWeighted(items, getWeight, random = Math.random) {
    if (!Array.isArray(items) || items.length === 0) {
      return null;
    }
    const weighted = items
      .map((item) => ({
        item,
        weight: Math.max(0, Number(getWeight(item)) || 0),
      }))
      .filter((entry) => entry.weight > 0);
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    if (total <= 0) {
      return null;
    }
    let cursor = random() * total;
    for (const entry of weighted) {
      cursor -= entry.weight;
      if (cursor < 0) {
        return entry.item;
      }
    }
    return weighted[weighted.length - 1].item;
  }

  function candidatesOutsideRecent(pool, recent, recentLimit = 5) {
    const source = [...new Set(pool)];
    const history = recent.slice(-Math.max(0, recentLimit));
    for (let releaseCount = 0; releaseCount <= history.length; releaseCount += 1) {
      const banned = new Set(history.slice(releaseCount));
      const candidates = source.filter((item) => !banned.has(item));
      if (candidates.length > 0) {
        return candidates;
      }
    }
    return source;
  }

  function pickWithRecent(
    pool,
    recent,
    getWeight = () => 1,
    random = Math.random,
    recentLimit = 5,
  ) {
    const candidates = candidatesOutsideRecent(pool, recent, recentLimit);
    return pickWeighted(candidates, getWeight, random);
  }

  function pushRecent(recent, assetId, recentLimit = 5) {
    if (!assetId) return recent.slice(-recentLimit);
    const next = [...recent, assetId];
    return next.slice(-Math.max(0, recentLimit));
  }

  function chooseGifLoopCount(loopDurationMs, random = Math.random) {
    const duration = Number(loopDurationMs);
    if (!Number.isFinite(duration) || duration <= 0) {
      return 1;
    }
    if (duration > 4000) {
      return 1;
    }
    const minimum = Math.max(1, Math.ceil(2000 / duration));
    const maximum = Math.max(1, Math.floor(4000 / duration));
    if (minimum <= maximum) {
      return randomInteger(minimum, maximum, random);
    }
    return 1;
  }

  class PausableTimer {
    constructor(callback, now = () => performance.now()) {
      this.callback = callback;
      this.now = now;
      this.timeout = null;
      this.startedAt = 0;
      this.remainingMs = 0;
      this.running = false;
      this.paused = false;
    }

    start(durationMs) {
      this.cancel();
      this.remainingMs = Math.max(0, Number(durationMs) || 0);
      this.paused = false;
      this.#arm();
    }

    #arm() {
      this.running = true;
      this.startedAt = this.now();
      this.timeout = setTimeout(() => {
        this.timeout = null;
        this.running = false;
        this.remainingMs = 0;
        this.callback();
      }, this.remainingMs);
    }

    pause() {
      if (!this.running) return;
      clearTimeout(this.timeout);
      this.timeout = null;
      this.remainingMs = Math.max(0, this.remainingMs - (this.now() - this.startedAt));
      this.running = false;
      this.paused = true;
    }

    resume() {
      if (!this.paused || this.running) return;
      this.paused = false;
      this.#arm();
    }

    cancel() {
      if (this.timeout !== null) {
        clearTimeout(this.timeout);
      }
      this.timeout = null;
      this.running = false;
      this.paused = false;
      this.remainingMs = 0;
    }

    remaining() {
      if (!this.running) return this.remainingMs;
      return Math.max(0, this.remainingMs - (this.now() - this.startedAt));
    }

    isActive() {
      return this.running || this.paused;
    }
  }

  return {
    PausableTimer,
    candidatesOutsideRecent,
    chooseGifLoopCount,
    pickUniform,
    pickWeighted,
    pickWithRecent,
    pushRecent,
    randomBetween,
    randomInteger,
  };
});
