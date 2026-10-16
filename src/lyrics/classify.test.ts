import { describe, it, expect } from "vitest";
import { exactReason, rejectedBy, searchReason, type LrclibEntry } from "./classify";

const synced = "[00:01.00]line";

describe("rejectedBy", () => {
  const good: LrclibEntry = { trackName: "Song", syncedLyrics: synced, duration: 200 };

  it("accepts a synced, same-title, same-duration candidate", () => {
    expect(rejectedBy(good, "song", 200)).toBeNull();
  });

  it("rejects a missing trackName as title", () => {
    expect(rejectedBy({ ...good, trackName: undefined }, "song", 200)).toBe("title");
  });

  it("rejects a candidate without synced lyrics", () => {
    expect(rejectedBy({ ...good, syncedLyrics: null, plainLyrics: "x" }, "song", 200)).toBe(
      "no_synced",
    );
  });

  it("checks synced before duration", () => {
    expect(rejectedBy({ ...good, syncedLyrics: null, duration: 999 }, "song", 200)).toBe(
      "no_synced",
    );
  });

  it("accepts a 2s duration gap and rejects 3s", () => {
    expect(rejectedBy({ ...good, duration: 202 }, "song", 200)).toBeNull();
    expect(rejectedBy({ ...good, duration: 197 }, "song", 200)).toBe("duration");
  });

  it("treats a missing duration as 0", () => {
    expect(rejectedBy({ ...good, duration: undefined }, "song", 200)).toBe("duration");
    expect(rejectedBy({ ...good, duration: undefined }, "song", 2)).toBeNull();
  });

  it("checks duration before title", () => {
    expect(rejectedBy({ ...good, trackName: "Other", duration: 999 }, "song", 200)).toBe(
      "duration",
    );
  });

  it("rejects a title mismatch", () => {
    expect(rejectedBy({ ...good, trackName: "Other" }, "song", 200)).toBe("title");
  });

  it("compares normalized titles", () => {
    expect(rejectedBy({ ...good, trackName: "Song (feat. X)" }, "song", 200)).toBeNull();
  });
});

describe("exactReason", () => {
  it("prefers instrumental over synced, matching evaluate()", () => {
    expect(exactReason({ instrumental: true, syncedLyrics: synced })).toBe("exact_instrumental");
  });

  it("classifies synced", () => {
    expect(exactReason({ syncedLyrics: synced, plainLyrics: "x" })).toBe("exact_synced");
  });

  it("classifies plain only", () => {
    expect(exactReason({ syncedLyrics: null, plainLyrics: "x" })).toBe("exact_plain_only");
  });

  it("classifies empty", () => {
    expect(exactReason({ syncedLyrics: null, plainLyrics: null })).toBe("exact_empty");
  });
});

describe("searchReason", () => {
  it("is search_empty with no results", () => {
    expect(searchReason([])).toBe("search_empty");
  });

  it("is gate_rejected when every candidate is rejected", () => {
    expect(searchReason(["title", "duration", "no_synced"])).toBe("gate_rejected");
  });

  it("is search_matched when any candidate passes", () => {
    expect(searchReason(["title", null])).toBe("search_matched");
  });
});
