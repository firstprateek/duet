/**
 * Hybrid logical clock. A stamp reads "2026-09-23T18:04:11.201Z-0003-jack-mbp":
 * wall time, a counter for events in the same millisecond, and the device id.
 * Stamps compare as plain strings, and the device id breaks ties.
 */
export type Hlc = string;

const MAX_COUNTER = 9999;

export interface HlcParts {
  ms: number;
  counter: number;
  deviceId: string;
}

export function formatHlc(parts: HlcParts): Hlc {
  return `${new Date(parts.ms).toISOString()}-${String(parts.counter).padStart(4, "0")}-${parts.deviceId}`;
}

export function parseHlc(stamp: Hlc): HlcParts {
  const iso = stamp.slice(0, 24);
  const counter = Number(stamp.slice(25, 29));
  const deviceId = stamp.slice(30);
  const ms = Date.parse(iso);
  if (Number.isNaN(ms) || Number.isNaN(counter) || stamp[24] !== "-" || stamp[29] !== "-") {
    throw new Error(`Not a clock stamp: ${stamp}`);
  }
  return { ms, counter, deviceId };
}

export function compareHlc(a: Hlc, b: Hlc): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class HybridClock {
  readonly deviceId: string;
  private readonly now: () => number;
  private lastMs = 0;
  private counter = 0;

  constructor(deviceId: string, now: () => number = () => Date.now()) {
    if (!/^[A-Za-z0-9_.-]+$/.test(deviceId))
      throw new Error("Device ids use letters, digits, . _ -");
    this.deviceId = deviceId;
    this.now = now;
  }

  /** A new stamp for a local change, always later than anything seen so far. */
  tick(): Hlc {
    const wall = this.now();
    if (wall > this.lastMs) {
      this.lastMs = wall;
      this.counter = 0;
    } else {
      this.bump();
    }
    return formatHlc({ ms: this.lastMs, counter: this.counter, deviceId: this.deviceId });
  }

  /** Moves the clock past a stamp from another device. */
  receive(stamp: Hlc): void {
    const remote = parseHlc(stamp);
    const wall = this.now();
    const top = Math.max(wall, this.lastMs, remote.ms);
    if (top === this.lastMs && top === remote.ms) {
      this.counter = Math.max(this.counter, remote.counter);
      this.bump();
    } else if (top === this.lastMs) {
      this.bump();
    } else if (top === remote.ms) {
      this.lastMs = top;
      this.counter = remote.counter;
      this.bump();
    } else {
      this.lastMs = top;
      this.counter = 0;
    }
  }

  private bump(): void {
    this.counter += 1;
    if (this.counter > MAX_COUNTER) {
      this.lastMs += 1;
      this.counter = 0;
    }
  }
}
