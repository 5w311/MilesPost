import { describe, it, expect } from "vitest";
import { formatPlaceSuggestions } from "../lib/logic.js";

describe("formatPlaceSuggestions", () => {
  it("keeps only locality (city) results, dropping businesses/categories/regions", () => {
    const items = [
      { resultType: "locality", address: { city: "Laredo", stateCode: "TX" } },
      { resultType: "place", address: { city: "Laredo", stateCode: "TX", label: "Joe's Diner" } },
      { resultType: "administrativeArea", address: { stateCode: "TX" } },
      { resultType: "street", address: { city: "Laredo", stateCode: "TX" } },
    ];
    expect(formatPlaceSuggestions(items)).toEqual(["Laredo, TX"]);
  });

  it("formats as 'City, ST' with an uppercased state code", () => {
    const items = [{ resultType: "locality", address: { city: "Nashville", stateCode: "tn" } }];
    expect(formatPlaceSuggestions(items)).toEqual(["Nashville, TN"]);
  });

  it("drops locality items missing city or stateCode", () => {
    const items = [
      { resultType: "locality", address: { stateCode: "TX" } },          // no city
      { resultType: "locality", address: { city: "Laredo" } },           // no stateCode
      { resultType: "locality", address: {} },                           // neither
      { resultType: "locality", address: { city: "El Paso", stateCode: "TX" } },
    ];
    expect(formatPlaceSuggestions(items)).toEqual(["El Paso, TX"]);
  });

  it("dedupes identical 'City, ST' results, keeping the first occurrence", () => {
    const items = [
      { resultType: "locality", address: { city: "Austin", stateCode: "TX" } },
      { resultType: "locality", address: { city: "Austin", stateCode: "TX" } },
      { resultType: "locality", address: { city: "Austin", stateCode: "tx" } },  // same after uppercasing
    ];
    expect(formatPlaceSuggestions(items)).toEqual(["Austin, TX"]);
  });

  it("handles missing/empty/malformed input without throwing", () => {
    expect(formatPlaceSuggestions(undefined)).toEqual([]);
    expect(formatPlaceSuggestions(null)).toEqual([]);
    expect(formatPlaceSuggestions([])).toEqual([]);
    expect(formatPlaceSuggestions([null, undefined, {}])).toEqual([]);
  });

  it("preserves result order for distinct cities", () => {
    const items = [
      { resultType: "locality", address: { city: "Dallas", stateCode: "TX" } },
      { resultType: "locality", address: { city: "Fort Worth", stateCode: "TX" } },
    ];
    expect(formatPlaceSuggestions(items)).toEqual(["Dallas, TX", "Fort Worth, TX"]);
  });

  it("falls back to parsing address.label when city/stateCode fields are absent " +
     "(this account's plan returns only a flat label, not structured fields)", () => {
    // The exact real-world shape reported: resultType is "locality" (so the type
    // filter is right), but address has only { label } — no city, no stateCode.
    const items = [{
      title: "Chattanooga, TN, United States",
      id: "here:cm:namedplace:21020565",
      resultType: "locality",
      localityType: "city",
      address: { label: "Chattanooga, TN, United States" },
    }];
    expect(formatPlaceSuggestions(items)).toEqual(["Chattanooga, TN"]);
  });

  it("falls back to title when address.label is also missing", () => {
    const items = [{ resultType: "locality", title: "Nashville, TN, United States", address: {} }];
    expect(formatPlaceSuggestions(items)).toEqual(["Nashville, TN"]);
  });

  it("prefers structured city/stateCode over the label when both are present", () => {
    const items = [{
      resultType: "locality",
      address: { city: "El Paso", stateCode: "TX", label: "Something Else, ZZ, Nowhere" },
    }];
    expect(formatPlaceSuggestions(items)).toEqual(["El Paso, TX"]);
  });

  it("drops a parsed result if the label's second segment isn't a 2-letter code", () => {
    const items = [{ resultType: "locality", address: { label: "Paris, Ile-de-France, France" } }];
    expect(formatPlaceSuggestions(items)).toEqual([]);
  });

  it("dedupes across structured and label-parsed results that resolve the same", () => {
    const items = [
      { resultType: "locality", address: { city: "Austin", stateCode: "TX" } },
      { resultType: "locality", address: { label: "Austin, TX, United States" } },
    ];
    expect(formatPlaceSuggestions(items)).toEqual(["Austin, TX"]);
  });

  it("parses labels whose state segment carries a ZIP code", () => {
    // localityType "postalCode" results label like "City, ST 12345, United States"
    const items = [
      { resultType: "locality", address: { label: "Chattanooga, TN 37402, United States" } },
      { resultType: "locality", address: { label: "Laredo, TX 78040-1234, United States" } },
    ];
    expect(formatPlaceSuggestions(items)).toEqual(["Chattanooga, TN", "Laredo, TX"]);
  });

  it("still rejects a second segment that is neither 'ST' nor 'ST zip'", () => {
    const items = [
      { resultType: "locality", address: { label: "Springfield, Greene County, MO, United States" } },
    ];
    expect(formatPlaceSuggestions(items)).toEqual([]);
  });

  it("caps output at 5 distinct cities by default (caller requests 20 from HERE)", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      resultType: "locality",
      address: { city: "City" + i, stateCode: "TX" },
    }));
    expect(formatPlaceSuggestions(items)).toEqual([
      "City0, TX", "City1, TX", "City2, TX", "City3, TX", "City4, TX",
    ]);
  });

  it("counts only kept cities toward the cap — dupes and non-cities don't use slots", () => {
    const items = [
      { resultType: "street", address: { city: "Nope", stateCode: "TX" } },
      { resultType: "locality", address: { city: "Austin", stateCode: "TX" } },
      { resultType: "locality", address: { city: "Austin", stateCode: "TX" } },  // dupe
      { resultType: "place", address: { label: "Some Biz" } },
      { resultType: "locality", address: { city: "Dallas", stateCode: "TX" } },
      { resultType: "locality", address: { city: "Houston", stateCode: "TX" } },
      { resultType: "locality", address: { city: "El Paso", stateCode: "TX" } },
      { resultType: "locality", address: { city: "Laredo", stateCode: "TX" } },
      { resultType: "locality", address: { city: "Waco", stateCode: "TX" } },    // 6th distinct — cut
    ];
    expect(formatPlaceSuggestions(items)).toEqual([
      "Austin, TX", "Dallas, TX", "Houston, TX", "El Paso, TX", "Laredo, TX",
    ]);
  });

  it("honors an explicit max override", () => {
    const items = [
      { resultType: "locality", address: { city: "Dallas", stateCode: "TX" } },
      { resultType: "locality", address: { city: "Fort Worth", stateCode: "TX" } },
      { resultType: "locality", address: { city: "Arlington", stateCode: "TX" } },
    ];
    expect(formatPlaceSuggestions(items, 2)).toEqual(["Dallas, TX", "Fort Worth, TX"]);
  });
});
