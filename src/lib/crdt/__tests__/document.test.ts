import { describe, expect, it } from "vitest";
import { RGADocument } from "../document";
import type { CRDTOp } from "../types";

function typeString(doc: RGADocument, text: string): CRDTOp[] {
  const ops: CRDTOp[] = [];
  for (let i = 0; i < text.length; i++) ops.push(doc.localInsert(i, text[i]));
  return ops;
}

describe("RGADocument: single-site local editing", () => {
  it("typing characters in order produces the expected string", () => {
    const doc = new RGADocument("A");
    typeString(doc, "hello");
    expect(doc.getText()).toBe("hello");
  });

  it("inserting in the middle shifts the rest right", () => {
    const doc = new RGADocument("A");
    typeString(doc, "helo");
    doc.localInsert(3, "l"); // "hel" + "l" + "o" -> "hello"
    expect(doc.getText()).toBe("hello");
  });

  it("deleting removes exactly the targeted character", () => {
    const doc = new RGADocument("A");
    typeString(doc, "hello");
    doc.localDelete(4); // remove trailing "o"
    expect(doc.getText()).toBe("hell");
    doc.localDelete(0); // remove leading "h"
    expect(doc.getText()).toBe("ell");
  });

  it("returns null for an out-of-range delete instead of corrupting state", () => {
    const doc = new RGADocument("A");
    typeString(doc, "hi");
    expect(doc.localDelete(5)).toBeNull();
    expect(doc.getText()).toBe("hi");
  });
});

describe("RGADocument: two replicas converge on sequential (already-causal) delivery", () => {
  it("relays every insert and delete and ends up identical", () => {
    const a = new RGADocument("A");
    const b = new RGADocument("B");

    const ops = typeString(a, "hello");
    for (const op of ops) b.applyRemote(op);
    expect(b.getText()).toBe("hello");

    const del = a.localDelete(0)!;
    b.applyRemote(del);
    expect(a.getText()).toBe(b.getText());
    expect(a.getText()).toBe("ello");
  });
});

describe("RGADocument: concurrent inserts at the same position converge", () => {
  it("two sites both insert at position 1 of a shared 'ac' - same final text on both, regardless of delivery order", () => {
    const a = new RGADocument("A");
    const b = new RGADocument("B");

    const seed = new RGADocument("SEED");
    const seedOps = typeString(seed, "ac");
    for (const op of seedOps) {
      a.applyRemote(op);
      b.applyRemote(op);
    }
    expect(a.getText()).toBe("ac");
    expect(b.getText()).toBe("ac");

    // both sites concurrently insert a different letter at index 1,
    // i.e. between 'a' and 'c', with neither having seen the other's edit yet
    const opA = a.localInsert(1, "X");
    const opB = b.localInsert(1, "Y");

    // deliver in OPPOSITE orders on each side
    b.applyRemote(opA);
    a.applyRemote(opB);

    expect(a.getText()).toBe(b.getText());
    // both concurrent inserts must survive - "aXc" and "aYc" both had
    // 3 chars, the merged result has 4
    expect(a.getText()).toHaveLength(4);
    expect(new Set(a.getText())).toEqual(new Set("aXYc"));
  });
});

describe("RGADocument: out-of-order and duplicate delivery", () => {
  it("still converges when remote ops arrive in a scrambled order (dependencies buffered until ready)", () => {
    const a = new RGADocument("A");
    const ops = typeString(a, "collab"); // 6 sequential, causally-dependent inserts

    const b = new RGADocument("B");
    const scrambled = [...ops].reverse(); // worst case: fully backwards
    for (const op of scrambled) b.applyRemote(op);

    expect(b.getText()).toBe("collab");
    expect(b.pendingCount).toBe(0); // everything eventually drained, nothing stuck
  });

  it("is idempotent - applying the same insert twice does not duplicate the character", () => {
    const a = new RGADocument("A");
    const ops = typeString(a, "hi");

    const b = new RGADocument("B");
    for (const op of ops) b.applyRemote(op);
    for (const op of ops) b.applyRemote(op); // redeliver the exact same ops

    expect(b.getText()).toBe("hi");
  });

  it("is idempotent for deletes too - deleting the same id twice is a no-op the second time", () => {
    const a = new RGADocument("A");
    const ops = typeString(a, "hi");
    const del = a.localDelete(0)!;

    const b = new RGADocument("B");
    for (const op of ops) b.applyRemote(op);
    b.applyRemote(del);
    b.applyRemote(del); // redelivered
    expect(b.getText()).toBe("i");
  });
});

describe("RGADocument: concurrent insert and delete near each other", () => {
  it("a concurrent insert next to a concurrently-deleted character still converges", () => {
    const seed = new RGADocument("SEED");
    const seedOps = typeString(seed, "abc");

    const a = new RGADocument("A");
    const b = new RGADocument("B");
    for (const op of seedOps) {
      a.applyRemote(op);
      b.applyRemote(op);
    }

    // site A deletes 'b' (index 1); concurrently site B inserts 'X'
    // right after 'b' (index 2), neither having seen the other's edit
    const delOp = a.localDelete(1)!;
    const insOp = b.localInsert(2, "X");

    a.applyRemote(insOp);
    b.applyRemote(delOp);

    expect(a.getText()).toBe(b.getText());
    expect(a.getText()).toBe("aXc");
  });

  it("a document's own local delete never leaks into another document that received the same insert op (node-identity regression)", () => {
    // This is a direct regression test for a real bug: integrateInsert
    // used to store the caller's node object by reference, so two
    // documents that both received the same InsertOp ended up sharing
    // one underlying node - deleting it in one document silently
    // deleted it in the other too, with no delete op ever exchanged.
    const seed = new RGADocument("SEED");
    const [insertB] = typeString(seed, "b");

    const a = new RGADocument("A");
    const b = new RGADocument("B");
    a.applyRemote(insertB);
    b.applyRemote(insertB);
    expect(a.getText()).toBe("b");
    expect(b.getText()).toBe("b");

    a.localDelete(0); // only A's copy should be affected
    expect(a.getText()).toBe("");
    expect(b.getText()).toBe("b"); // B never received a delete op - must be untouched
  });
});

describe("RGADocument: randomized multi-site convergence (property test)", () => {
  // A simple deterministic PRNG so failures are reproducible without
  // pulling in a dependency.
  function makeRng(seed: number) {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  it("many random interleavings of concurrent edits across 3 sites always converge", () => {
    const alphabet = "abcdefghij";

    for (let trial = 0; trial < 30; trial++) {
      const rng = makeRng(trial * 7919 + 1);
      const sites = ["A", "B", "C"].map((id) => new RGADocument(id));
      const allOps: CRDTOp[] = [];

      // each site independently performs a handful of local edits
      // against its OWN current view, before anyone has synced -
      // this is exactly what genuine concurrent editing looks like
      for (const site of sites) {
        const editCount = 3 + Math.floor(rng() * 4);
        for (let i = 0; i < editCount; i++) {
          const text = site.getText();
          const doDelete = text.length > 0 && rng() < 0.3;
          if (doDelete) {
            const pos = Math.floor(rng() * text.length);
            const op = site.localDelete(pos);
            if (op) allOps.push(op);
          } else {
            const pos = Math.floor(rng() * (text.length + 1));
            const ch = alphabet[Math.floor(rng() * alphabet.length)];
            allOps.push(site.localInsert(pos, ch));
          }
        }
      }

      // now fully connect every site to every op, including its own
      // (exercising the duplicate-delivery no-op path), each in an
      // independently shuffled order
      for (const site of sites) {
        const order = [...allOps];
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }
        for (const op of order) site.applyRemote(op);
      }

      const texts = sites.map((s) => s.getText());
      expect(texts[1], `trial ${trial}: site B diverged from site A`).toBe(texts[0]);
      expect(texts[2], `trial ${trial}: site C diverged from site A`).toBe(texts[0]);
      for (const site of sites) expect(site.pendingCount, `trial ${trial}: ops stuck pending`).toBe(0);
    }
  });
});
