(function attachPetCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.PetCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createPetCore() {
  const THROW_MAX_SPEED = 3000;

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

  function chooseGifLoopCount(
    loopDurationMs,
    random = Math.random,
    minimumDurationMs = 3000,
    maximumDurationMs = 6000,
  ) {
    const duration = Number(loopDurationMs);
    if (!Number.isFinite(duration) || duration <= 0) {
      return 1;
    }
    const minimumDuration = Math.max(0, Number(minimumDurationMs) || 0);
    const maximumDuration = Math.max(
      minimumDuration,
      Number(maximumDurationMs) || minimumDuration,
    );
    if (duration > maximumDuration) {
      return 1;
    }
    const minimum = Math.max(1, Math.ceil(minimumDuration / duration));
    const maximum = Math.max(1, Math.floor(maximumDuration / duration));
    if (minimum <= maximum) {
      return randomInteger(minimum, maximum, random);
    }
    return 1;
  }

  function validCycleCounts(
    cycleDurationMs,
    minimumDurationMs = 3000,
    maximumDurationMs = 8000,
  ) {
    const cycleDuration = Number(cycleDurationMs);
    if (!Number.isFinite(cycleDuration) || cycleDuration <= 0) {
      throw new RangeError("cycleDurationMs must be a positive finite number");
    }
    const minimum = Math.max(1, Math.ceil(Number(minimumDurationMs) / cycleDuration));
    const maximum = Math.floor(Number(maximumDurationMs) / cycleDuration);
    const counts = [];
    for (let count = minimum; count <= maximum; count += 1) {
      counts.push(count);
    }
    return counts;
  }

  function estimateReleaseVelocity(
    samples,
    windowMs = 120,
    maxSpeed = THROW_MAX_SPEED,
  ) {
    const validSamples = samples.filter(
      (sample) =>
        sample &&
        Number.isFinite(sample.x) &&
        Number.isFinite(sample.y) &&
        Number.isFinite(sample.time),
    );
    if (validSamples.length < 2) {
      return { x: 0, y: 0, speed: 0 };
    }

    const last = validSamples[validSamples.length - 1];
    const cutoffTime = last.time - windowMs;
    let first = last;
    for (let index = validSamples.length - 2; index >= 0; index -= 1) {
      if (validSamples[index].time < cutoffTime) break;
      first = validSamples[index];
    }

    const elapsedMs = last.time - first.time;
    if (elapsedMs <= 0) {
      return { x: 0, y: 0, speed: 0 };
    }

    let x = ((last.x - first.x) * 1000) / elapsedMs;
    let y = ((last.y - first.y) * 1000) / elapsedMs;
    let speed = Math.hypot(x, y);
    const speedLimit = Math.max(0, maxSpeed);
    if (speed > speedLimit) {
      const scale = speedLimit / speed;
      x *= scale;
      y *= scale;
      speed = speedLimit;
    }
    return { x, y, speed };
  }

  function decelerateVelocity({ x, y }, decelerationPxPerSecond2, deltaMs) {
    const speed = Math.hypot(x, y);
    const nextSpeed = Math.max(
      0,
      speed - (decelerationPxPerSecond2 * deltaMs) / 1000,
    );
    if (speed === 0 || nextSpeed === 0) {
      return { x: 0, y: 0, speed: 0 };
    }
    const scale = nextSpeed / speed;
    return {
      x: x * scale,
      y: y * scale,
      speed: nextSpeed,
    };
  }

  function reflectVelocity({ x, y }, hitX, hitY, retention = 0.7) {
    const reflectedX = hitX ? -x * retention : x;
    const reflectedY = hitY ? -y * retention : y;
    return {
      x: reflectedX,
      y: reflectedY,
      speed: Math.hypot(reflectedX, reflectedY),
    };
  }

  function shortestAngleDelta(from, to) {
    const fullTurn = Math.PI * 2;
    let delta = (to - from) % fullTurn;
    if (delta > Math.PI) delta -= fullTurn;
    if (delta < -Math.PI) delta += fullTurn;
    return delta;
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

  class StableValueTracker {
    constructor(initialValue = null) {
      this.acceptedValue = initialValue;
      this.candidateValue = initialValue;
      this.candidateCount = 0;
    }

    sample(value, requiredSamples = 2) {
      const required = Math.max(1, Math.floor(Number(requiredSamples) || 1));
      if (Object.is(value, this.candidateValue)) {
        this.candidateCount += 1;
      } else {
        this.candidateValue = value;
        this.candidateCount = 1;
      }
      const changed =
        this.candidateCount >= required &&
        !Object.is(this.acceptedValue, this.candidateValue);
      if (changed) {
        this.acceptedValue = this.candidateValue;
      }
      return {
        changed,
        value: this.acceptedValue,
        candidate: this.candidateValue,
        count: this.candidateCount,
      };
    }

    reset(value = null) {
      this.acceptedValue = value;
      this.candidateValue = value;
      this.candidateCount = 0;
    }

    current() {
      return this.acceptedValue;
    }
  }

  return {
    PausableTimer,
    StableValueTracker,
    THROW_MAX_SPEED,
    candidatesOutsideRecent,
    chooseGifLoopCount,
    decelerateVelocity,
    estimateReleaseVelocity,
    pickUniform,
    pickWeighted,
    pickWithRecent,
    pushRecent,
    randomBetween,
    randomInteger,
    reflectVelocity,
    shortestAngleDelta,
    validCycleCounts,
  };
});
