import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  dayLabel,
  daysBetween,
  lastDayOf,
  lastMonths,
  monthName,
  relativeDay,
  weekdayLabel,
} from "../src/dates.ts";
import { compareHlc, HybridClock, parseHlc } from "../src/hlc.ts";
import { fromBase64Url, randomToken, sha256Hex, toBase64Url, uuidv7 } from "../src/ids.ts";
import { formatCompact, formatMoney, shareOf } from "../src/money.ts";

describe("money", () => {
  it("formats for people", () => {
    expect(formatMoney(631800)).toBe("$6,318");
    expect(formatMoney(242580, { cents: true })).toBe("$2,425.80");
    expect(formatMoney(-2499, { cents: true })).toBe("−$24.99");
    expect(formatMoney(86200, { signed: true })).toBe("+$862");
    expect(formatMoney(0, { signed: true })).toBe("$0");
    expect(formatMoney(-40)).toBe("$0");
    expect(formatCompact(694000)).toBe("6.9k");
    expect(formatCompact(42000)).toBe("$420");
  });

  it("shares round once, halves away from zero", () => {
    expect(shareOf(631800, 5800)).toBe(366444);
    expect(shareOf(50, 5000)).toBe(25);
    expect(shareOf(-101, 5800)).toBe(-59);
  });
});

describe("dates", () => {
  it("does calendar arithmetic without time zones", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-08-01", "2026-08-28")).toBe(27);
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(lastDayOf("2024-02")).toBe("2024-02-29");
    expect(lastMonths("2026-08", 3)).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  it("labels", () => {
    expect(monthName("2026-08")).toBe("August");
    expect(monthName("2026-08", true)).toBe("August 2026");
    expect(dayLabel("2026-08-01")).toBe("Aug 1");
    expect(weekdayLabel("2026-09-22")).toBe("Tue, Sep 22");
  });

  it("reads relative days", () => {
    // Sep 23, 2026 is a Wednesday.
    expect(relativeDay("yesterday", "2026-09-23")).toBe("2026-09-22");
    expect(relativeDay("friday", "2026-09-23")).toBe("2026-09-18");
    expect(relativeDay("wednesday", "2026-09-23")).toBe("2026-09-16");
    expect(relativeDay("someday", "2026-09-23")).toBeNull();
  });
});

describe("ids", () => {
  it("uuidv7 sorts by time and has the right version", () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a < b).toBe(true);
    expect(a[14]).toBe("7");
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("base64url round-trips", () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    expect(randomToken().length).toBeGreaterThanOrEqual(43);
  });

  it("hashes", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("hybrid logical clock", () => {
  it("ticks forward even when the wall clock stands still", () => {
    const clock = new HybridClock("jack-mbp", () => 1_790_000_000_000);
    const a = clock.tick();
    const b = clock.tick();
    expect(compareHlc(a, b)).toBe(-1);
    expect(parseHlc(b)).toEqual({ ms: 1_790_000_000_000, counter: 1, deviceId: "jack-mbp" });
  });

  it("moves past stamps from another device", () => {
    let now = 1_000;
    const clock = new HybridClock("jack", () => now);
    const remote = new HybridClock("jill", () => 5_000).tick();
    clock.receive(remote);
    now = 2_000;
    const next = clock.tick();
    expect(compareHlc(next, remote)).toBe(1);
  });

  it("breaks ties with the device id", () => {
    const a = new HybridClock("a", () => 10).tick();
    const b = new HybridClock("b", () => 10).tick();
    expect(compareHlc(a, b)).toBe(-1);
  });
});
