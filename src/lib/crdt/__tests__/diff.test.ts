import { describe, expect, it } from "vitest";
import { RGADocument } from "../document";
import { diffToOps } from "../diff";

function apply(doc: RGADocument, oldText: string, newText: string): void {
  diffToOps(doc, oldText, newText);
  expect(doc.getText()).toBe(newText);
}

describe("diffToOps: keeps a document's text in sync with a textarea's value", () => {
  it("handles typing a single character at the end", () => {
    const doc = new RGADocument("A");
    apply(doc, "", "h");
    apply(doc, "h", "he");
    apply(doc, "he", "hel");
  });

  it("handles typing a character in the middle", () => {
    const doc = new RGADocument("A");
    apply(doc, "", "helo");
    apply(doc, "helo", "hello");
  });

  it("handles backspace at the end", () => {
    const doc = new RGADocument("A");
    apply(doc, "", "hello");
    apply(doc, "hello", "hell");
  });

  it("handles deleting from the middle", () => {
    const doc = new RGADocument("A");
    apply(doc, "", "hxello");
    apply(doc, "hxello", "hello");
  });

  it("handles a multi-character paste", () => {
    const doc = new RGADocument("A");
    apply(doc, "", "start end");
    apply(doc, "start end", "start middle end");
  });

  it("handles replacing a selection (delete + insert in one change)", () => {
    const doc = new RGADocument("A");
    apply(doc, "", "the cat sat");
    apply(doc, "the cat sat", "the dog sat");
  });

  it("handles clearing the whole field", () => {
    const doc = new RGADocument("A");
    apply(doc, "", "goodbye");
    apply(doc, "goodbye", "");
  });

  it("produces operations that another replica can apply to reach the same text", () => {
    const a = new RGADocument("A");
    const b = new RGADocument("B");

    const ops1 = diffToOps(a, "", "hello");
    for (const op of ops1) b.applyRemote(op);
    expect(b.getText()).toBe("hello");

    const ops2 = diffToOps(a, "hello", "hello world");
    for (const op of ops2) b.applyRemote(op);
    expect(b.getText()).toBe("hello world");
  });
});
