import { describe, it, expect } from "vitest";
import { splitStateNeedingZone, resolvePlace, SPLIT, Z } from "../lib/logic.js";

/* This exists because "Independence, KY" — a real town, correctly typed with its state —
   came back from resolvePlace() as null, indistinguishable from gibberish, and the app told
   the driver to add the state they had just typed. KY and TN are the only split states with
   no default zone, so they are the only ones where a well-formed entry can fail this way. */
describe("splitStateNeedingZone", () => {
  it("explains an unlisted town in a no-default split state", () => {
    const r = splitStateNeedingZone("Independence, KY");
    expect(r).not.toBeNull();
    expect(r.st).toBe("KY");
    expect(r.state).toBe("Kentucky");
    expect(r.place).toBe("Independence, KY");
    expect(r.zones).toEqual(expect.arrayContaining([Z.E, Z.C]));
  });

  it("offers only the zones that state actually spans", () => {
    for (const st of ["KY", "TN"]) {
      const r = splitStateNeedingZone(`Nowheresville ${st}`);
      expect(r.zones).toHaveLength(2);
      expect(new Set(r.zones)).toEqual(new Set([Z.E, Z.C]));
    }
  });

  it("stays silent for anything resolvePlace() can already place", () => {
    // Listed cities in the same states.
    expect(splitStateNeedingZone("Louisville KY")).toBeNull();
    expect(splitStateNeedingZone("Nashville TN")).toBeNull();
    // Split states that DO have a default to fall back on.
    expect(splitStateNeedingZone("Waco TX")).toBeNull();
    expect(splitStateNeedingZone("Anytown FL")).toBeNull();
    // Single-zone states.
    expect(splitStateNeedingZone("Columbus OH")).toBeNull();
    expect(splitStateNeedingZone("Laredo, TX")).toBeNull();
  });

  it("stays silent when no state can be found at all", () => {
    expect(splitStateNeedingZone("Zzyzx Nowhere")).toBeNull();
    expect(splitStateNeedingZone("")).toBeNull();
    expect(splitStateNeedingZone("Blah ZZ")).toBeNull();
  });

  it("is exactly the set of nulls the no-default states produce", () => {
    // Anything it answers for must be something resolvePlace() refused, and vice versa for
    // the two no-default states — the two functions must not disagree about a parse.
    for (const st of Object.keys(SPLIT)) {
      const q = `Someplaceville ${st}`;
      const placed = resolvePlace(q);
      const needs = splitStateNeedingZone(q);
      if (SPLIT[st].def) { expect(placed).not.toBeNull(); expect(needs).toBeNull(); }
      else { expect(placed).toBeNull(); expect(needs).not.toBeNull(); }
    }
  });

  it("handles a bare state name too", () => {
    const r = splitStateNeedingZone("Kentucky");
    expect(r).not.toBeNull();
    expect(r.st).toBe("KY");
  });
});
