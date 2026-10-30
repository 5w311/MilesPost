import { describe, it, expect } from "vitest";
import { fromWall, toWall, offsetMs, tzTag } from "../lib/logic.js";

const ZONES = ["America/New_York", "America/Chicago", "America/Denver",
  "America/Los_Angeles", "America/Phoenix", "Pacific/Honolulu"];

describe("fromWall / toWall round-trip", () => {
  // A wall time, put onto an instant and read back, must be unchanged.
  const walls = ["2026-01-15T09:30", "2026-07-15T09:30", "2026-06-15T00:00", "2026-12-31T23:45"];
  for (const tz of ZONES) {
    for (const w of walls) {
      it(`${w} @ ${tz} survives the round-trip`, () => {
        expect(toWall(fromWall(w, tz), tz)).toBe(w);
      });
    }
  }
});

describe("fromWall resolves the correct UTC instant, honoring DST", () => {
  it("winter EST is UTC-5", () => {
    // 2026-01-15 12:00 New York (EST) == 17:00 UTC
    expect(fromWall("2026-01-15T12:00", "America/New_York").getUTCHours()).toBe(17);
  });
  it("summer EDT is UTC-4", () => {
    // 2026-07-15 12:00 New York (EDT) == 16:00 UTC
    expect(fromWall("2026-07-15T12:00", "America/New_York").getUTCHours()).toBe(16);
  });
  it("Arizona stays UTC-7 year round (no DST)", () => {
    expect(fromWall("2026-01-15T12:00", "America/Phoenix").getUTCHours()).toBe(19);
    expect(fromWall("2026-07-15T12:00", "America/Phoenix").getUTCHours()).toBe(19);
  });
});

describe("fromWall input handling", () => {
  it("returns null for empty or unparseable input", () => {
    expect(fromWall("", "America/New_York")).toBeNull();
    expect(fromWall(null, "America/New_York")).toBeNull();
    expect(fromWall("not-a-date", "America/New_York")).toBeNull();
  });
  it("accepts both 'YYYY-MM-DDTHH:MM' and '...:SS' forms", () => {
    const a = fromWall("2026-06-15T08:00", "America/New_York");
    const b = fromWall("2026-06-15T08:00:00", "America/New_York");
    expect(a.getTime()).toBe(b.getTime());
  });
});

describe("offsetMs", () => {
  it("reports the zone offset for a given instant", () => {
    const jan = new Date("2026-01-15T12:00:00Z");
    // New York in January is UTC-5 -> offset is -5h in ms
    expect(offsetMs(jan, "America/New_York")).toBe(-5 * 3600e3);
    const jul = new Date("2026-07-15T12:00:00Z");
    expect(offsetMs(jul, "America/New_York")).toBe(-4 * 3600e3);
  });
});

describe("tzTag labels a time with the abbreviation in effect AT that time", () => {
  // Fall-back 2026: Sun Nov 1, 02:00 EDT -> 01:00 EST. A label taken from "now" put EDT on
  // a Monday arrival seen on a Friday — the digits right, the zone wrong.
  const NY = "America/New_York";
  it("before the change it's EDT, after it EST — whenever you look", () => {
    expect(tzTag(NY, new Date("2026-10-31T16:00:00Z"))).toBe("EDT");
    expect(tzTag(NY, new Date("2026-11-02T14:00:00Z"))).toBe("EST");
  });
  it("the repeated hour carries both labels, one per pass", () => {
    expect(tzTag(NY, new Date("2026-11-01T05:30:00Z"))).toBe("EDT");   // first 01:30
    expect(tzTag(NY, new Date("2026-11-01T06:30:00Z"))).toBe("EST");   // second 01:30
  });
  it("Arizona never changes", () => {
    expect(tzTag("America/Phoenix", new Date("2026-11-02T14:00:00Z"))).toBe("MST");
  });
});
