import { describe, it, expect } from "vitest";
import { decodeFlexPolyline, pointAlong, sliceAlong } from "../lib/logic.js";

/* An encoder, here in the test only. The app never encodes — but round-tripping is what
   actually proves the decoder, rather than trusting a pasted expectation: every piece of
   the format (the 5-bit groups, the continuation bit, the zig-zag sign, the precision
   scale, the two-varint header) has to be read exactly the way it was written, or the
   numbers come back somewhere else on earth. */
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
const putVarint = (n, out) => {
  let v = n;
  while(v > 0x1f){ out.push(CHARS[(v & 0x1f) | 0x20]); v = Math.floor(v / 32); }
  out.push(CHARS[v]);
};
const putSigned = (n, out) => putVarint(n < 0 ? -n * 2 - 1 : n * 2, out);
function encode(points, precision = 5){
  const out = [];
  putVarint(1, out);                       // version
  putVarint(precision, out);               // precision, no third dimension
  const f = Math.pow(10, precision);
  let lat = 0, lng = 0;
  for(const [a, b] of points){
    const la = Math.round(a * f), ln = Math.round(b * f);
    putSigned(la - lat, out); putSigned(ln - lng, out);
    lat = la; lng = ln;
  }
  return out.join("");
}

describe("decodeFlexPolyline", () => {
  it("reads HERE's own published example", () => {
    const pts = decodeFlexPolyline("BFoz5xJ67i1B1B7PzIhaxL7Y");
    expect(pts.length).toBe(4);
    // Frankfurt, where HERE's examples live — a decoder that drops the sign or the
    // precision lands in the ocean or in Asia, so the coarse check is the useful one.
    for(const [lat, lon] of pts){
      expect(lat).toBeGreaterThan(50.09); expect(lat).toBeLessThan(50.11);
      expect(lon).toBeGreaterThan(8.68);  expect(lon).toBeLessThan(8.70);
    }
    expect(pts[0]).toEqual([50.10228, 8.69821]);
    // The line runs south-west, point by point.
    for(let i = 1; i < pts.length; i++){
      expect(pts[i][0]).toBeLessThan(pts[i-1][0]);
      expect(pts[i][1]).toBeLessThan(pts[i-1][1]);
    }
  });

  it("round-trips a real lane, both signs, both hemispheres of the grid", () => {
    const lane = [[29.187, -82.140], [30.438, -84.281], [30.695, -88.040],
                  [30.451, -91.154], [29.760, -95.370], [27.506, -99.507]];
    expect(decodeFlexPolyline(encode(lane))).toEqual(lane);
    const crossing = [[-1.5, -0.5], [0, 0], [1.25, 0.75]];
    expect(decodeFlexPolyline(encode(crossing))).toEqual(crossing);
  });

  it("honours the precision in the header rather than assuming five places", () => {
    const pts = [[12.3456789, -98.7654321]];
    expect(decodeFlexPolyline(encode(pts, 7))).toEqual([[12.3456789, -98.7654321]]);
    expect(decodeFlexPolyline(encode(pts, 5))).toEqual([[12.34568, -98.76543]]);
  });

  it("survives a value big enough to overflow a 32-bit shift", () => {
    // 7 decimal places on a high longitude needs more than 31 bits of varint.
    const pts = [[89.9999999, -179.9999999]];
    expect(decodeFlexPolyline(encode(pts, 7))).toEqual(pts);
  });

  it("gives nothing back rather than nonsense for junk, empty or a version it can't read", () => {
    expect(decodeFlexPolyline("")).toEqual([]);
    expect(decodeFlexPolyline(null)).toEqual([]);
    expect(decodeFlexPolyline(undefined)).toEqual([]);
    expect(decodeFlexPolyline("!!!!")).toEqual([]);
    expect(decodeFlexPolyline("CFoz5xJ67i1B")).toEqual([]);   // version 2
  });

  it("stops cleanly on a truncated pair instead of inventing a coordinate", () => {
    const full = encode([[10, 20], [11, 21]]);
    const cut = full.slice(0, full.length - 1);
    const pts = decodeFlexPolyline(cut);
    expect(pts[0]).toEqual([10, 20]);
    expect(pts.length).toBeLessThanOrEqual(2);
  });
});

describe("pointAlong", () => {
  const line = [[0, 0], [0, 10], [0, 30]];      // 10 units, then 20, due east
  it("lands on the ends at 0 and 1", () => {
    expect(pointAlong(line, 0)).toEqual({ lat:0, lon:0 });
    expect(pointAlong(line, 1)).toEqual({ lat:0, lon:30 });
  });
  it("measures along the line, not between the ends", () => {
    // a third of the way by length is 10 units in: the end of the first leg
    expect(pointAlong(line, 1/3).lon).toBeCloseTo(10, 6);
    expect(pointAlong(line, 2/3).lon).toBeCloseTo(20, 6);
  });
  it("clamps rather than walking off either end", () => {
    expect(pointAlong(line, -5)).toEqual({ lat:0, lon:0 });
    expect(pointAlong(line, 9)).toEqual({ lat:0, lon:30 });
  });
  it("handles the degenerate lines a failed route can hand it", () => {
    expect(pointAlong([], 0.5)).toBe(null);
    expect(pointAlong(null, 0.5)).toBe(null);
    expect(pointAlong([[4, 5]], 0.5)).toEqual({ lat:4, lon:5 });
    expect(pointAlong([[4, 5], [4, 5]], 0.5)).toEqual({ lat:4, lon:5 });
  });
});

describe("sliceAlong — the piece of a line between two stops", () => {
  const line = [[0, 0], [0, 10], [0, 30]];      // 10 units then 20, due east

  it("cuts at the fractions, not at the nearest vertex", () => {
    // 0.1 -> 3 units in; 0.5 -> 15 units in, which is 5 past the middle vertex
    expect(sliceAlong(line, 0.1, 0.5)).toEqual([[0, 3], [0, 10], [0, 15]]);
  });
  it("keeps every vertex strictly between the two cuts, and only those", () => {
    expect(sliceAlong(line, 0, 1)).toEqual([[0, 0], [0, 10], [0, 30]]);
    expect(sliceAlong(line, 0.4, 0.6)).toEqual([[0, 12], [0, 18]]);   // no vertex inside
  });
  it("never repeats a point when a cut lands exactly on a vertex", () => {
    const s = sliceAlong(line, 0, 1/3);
    expect(s).toEqual([[0, 0], [0, 10]]);
  });
  it("the legs of a run join end to end, covering the whole line", () => {
    const cuts = [0, 0.25, 0.8, 1];
    const legs = cuts.slice(1).map((f, i) => sliceAlong(line, cuts[i], f));
    for(let i = 1; i < legs.length; i++)
      expect(legs[i][0]).toEqual(legs[i-1][legs[i-1].length-1]);
    expect(legs[0][0]).toEqual([0, 0]);
    expect(legs[legs.length-1].at(-1)).toEqual([0, 30]);
  });
  it("clamps and orders its arguments rather than returning something backwards", () => {
    expect(sliceAlong(line, -1, 2)).toEqual([[0, 0], [0, 10], [0, 30]]);
    expect(sliceAlong(line, 0.8, 0.2).length).toBeGreaterThan(0);   // to < from: empty leg, not reversed
  });
  it("handles the degenerate lines a failed route hands it", () => {
    expect(sliceAlong([], 0, 1)).toEqual([]);
    expect(sliceAlong([[4, 5]], 0, 1)).toEqual([[4, 5]]);
    expect(sliceAlong([[4, 5], [4, 5]], 0, 1)).toEqual([[4, 5]]);
  });
});
