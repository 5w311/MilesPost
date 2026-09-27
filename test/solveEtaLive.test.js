import { describe, it, expect } from "vitest";
import { solveEtaLive, overlayStops, runSchedule, fuelStopMiles, rangeForTick,
         plannableMiles, backupMiles, fullRange, milesPerTick, TICKS,
         liveFresh, LIVE_MAX_AGE_MS, fromWall, STOP_DEFAULTS } from "../lib/logic.js";

const NY = "America/New_York";
const swap = { times: ["06:00", "18:00"], tz: NY };
const P = STOP_DEFAULTS;                       // fuel every 900 mi max -> 150 a tick, 1200 full
const startMs = fromWall("2026-06-15T08:00", NY).getTime();
const MI = 1609.344;

describe("the tank — range off the truck, floors off the driver", () => {
  it("a full tank plans exactly the miles between fuel stops, like FuelPost's F — 900", () => {
    expect(P.fuelMax).toBe(900);
    expect(plannableMiles(TICKS, P)).toBe(900);
    expect(milesPerTick(P)).toBe(150);          // 900 over the six eighths above the floor
    expect(fullRange(P)).toBe(1200);            // the physical tank, reserve included
    expect(TICKS).toBe(8);
  });
  it("the whole scale moves with the setting", () => {
    const p600 = { ...P, fuelMax: 600 };
    expect(plannableMiles(TICKS, p600)).toBe(600);
    expect(milesPerTick(p600)).toBe(100);
    expect(rangeForTick(1, p600)).toEqual({ miles: 0, backup: false });   // bottom reads 0
    expect(fuelStopMiles(1500, 8, p600)).toEqual([600, 1200]);            // never more than 600 apart
  });
  it("a plan may not touch the bottom quarter", () => {
    expect(plannableMiles(8, P)).toBe(900);     // F: six plannable eighths
    expect(plannableMiles(6, P)).toBe(600);
    expect(plannableMiles(2, P)).toBe(0);       // at the floor, nothing ordinary left
  });
  it("nothing ever touches the last eighth", () => {
    expect(backupMiles(2, P)).toBe(150);        // the backup band, above the limp eighth
    expect(backupMiles(1, P)).toBe(0);          // limp only — not even the backup
  });
  it("dips into the backup only at or under the floor, and says so", () => {
    expect(rangeForTick(6, P)).toEqual({ miles: 600, backup: false });
    expect(rangeForTick(2, P)).toEqual({ miles: 150, backup: true });
    expect(rangeForTick(1, P)).toEqual({ miles: 0, backup: false });
  });
});

describe("fuelStopMiles — where the stops land on the odometer", () => {
  it("a full tank clears a run inside its plannable range with no stop at all", () => {
    expect(fuelStopMiles(688, 8, P)).toEqual([]);      // 688 < 900
  });
  it("the first stop is however far what's aboard can carry the plan", () => {
    expect(fuelStopMiles(688, 6, P)).toEqual([600]);   // 3/4 tank
    expect(fuelStopMiles(688, 4, P)).toEqual([300]);   // 1/2 tank
  });
  it("every stop after the first is a full tank's plannable range — you leave full", () => {
    expect(fuelStopMiles(2000, 8, P)).toEqual([900, 1800]);
  });
  it("nothing plannable means fuel before you roll, at mile 0", () => {
    expect(fuelStopMiles(688, 1, P)[0]).toBe(0);
  });
  it("this is what the old interval model got wrong: half a tank moves the first stop", () => {
    // "fuel every 650" always put the first stop at 650, whatever was in the tank.
    expect(fuelStopMiles(688, 8, P)).toEqual([]);
    expect(fuelStopMiles(688, 4, P)).toEqual([300]);
  });
  it("guards: no run, or no usable range configured, plans nothing rather than looping", () => {
    expect(fuelStopMiles(0, 8, P)).toEqual([]);
    expect(fuelStopMiles(688, 8, { ...P, fuelMax: 0 })).toEqual([]);
    expect(fuelStopMiles(688, 8, { ...P, fuelMax: undefined })).toEqual([]);
  });
});

describe("solveEtaLive — the tank feeds the overlay", () => {
  const run = tick => solveEtaLive({ driveSeconds: 6*3600, meters: 688*MI, p: P, swap, startMs, tick });
  it("a fuller tank can mean fewer stops and an earlier arrival", () => {
    const full = run(8), threeQ = run(6);
    expect(full.fuelStops).toBe(0);
    expect(threeQ.fuelStops).toBe(1);
    expect(full.liveEta.getTime()).toBeLessThan(threeQ.liveEta.getTime());
  });
  it("carries the tank reading through, so the UI can flag a backup dip", () => {
    expect(run(6).tank).toEqual({ miles: 600, backup: false });
    expect(run(2).tank).toEqual({ miles: 150, backup: true });
  });
  it("stopped time counts the fuel stops the tank actually produced", () => {
    const r = run(6);
    const mins = r.swaps.length*P.swapMin + r.fuelStops*P.fuelMin + r.dots.length*r.dotMin;
    expect(r.stopH).toBeCloseTo(mins/60, 10);
  });
});

describe("runSchedule — one ordered list, two different clocks", () => {
  const r = solveEtaLive({ driveSeconds: 11.783*3600, meters: 688*MI, p: P, swap, startMs, tick: 6 });
  it("returns every stop the run takes, and nothing else", () => {
    expect(r.schedule.length).toBe(r.swaps.length + r.dots.length + r.fuelStops);
  });
  it("is in time order", () => {
    const t = r.schedule.map(s => s.atMs);
    expect([...t].sort((a,b)=>a-b)).toEqual(t);
  });
  it("puts a mile marker on every stop, inside the run", () => {
    r.schedule.forEach(s => {
      expect(s.mile).toBeGreaterThanOrEqual(0);
      expect(s.mile).toBeLessThanOrEqual(r.miles + 1);
    });
  });
  it("miles never wind backwards, even when stops land close together", () => {
    const m = r.schedule.map(s => s.mile);
    expect([...m].sort((a,b)=>a-b)).toEqual(m);
  });
  it("puts the fuel stop at the odometer position the tank model chose", () => {
    const fuel = r.schedule.find(s => s.kind === "fuel");
    expect(fuel.mile).toBeCloseTo(r.fuelAt[0], 6);
  });
  it("every stop lands inside the run, never past the arrival", () => {
    r.schedule.forEach(s => {
      expect(s.atMs).toBeGreaterThanOrEqual(startMs);
      expect(s.atMs).toBeLessThanOrEqual(r.liveEta.getTime());
    });
  });
  it("an empty run schedules nothing rather than dividing by zero", () => {
    const core = overlayStops({ driveH: 0, miles: 0, p: P, swap, startMs, fuelAt: [] });
    expect(runSchedule({ core, miles: 0, p: P, startMs })).toEqual([]);
  });
});

describe("liveFresh — when to trust a cached quote", () => {
  const t0 = 1_000_000_000_000;
  it("fresh right up to the max age", () => expect(liveFresh(t0, t0 + LIVE_MAX_AGE_MS)).toBe(true));
  it("stale one ms past it", () => expect(liveFresh(t0, t0 + LIVE_MAX_AGE_MS + 1)).toBe(false));
  it("never fetched is not fresh", () => expect(liveFresh(null, t0)).toBe(false));
  it("a clock that jumped backwards is not fresh", () => expect(liveFresh(t0, t0 - 1000)).toBe(false));
});
