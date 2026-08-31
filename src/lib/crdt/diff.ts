import type { RGADocument } from "./document";
import type { CRDTOp } from "./types";

/**
 * Translates a plain "the text changed from `oldText` to `newText`"
 * event (exactly what a browser textarea's onChange gives you) into the
 * sequence of CRDT operations that produces that change - by finding
 * the shared prefix/suffix and treating only the differing middle as
 * edited. This is what lets a completely ordinary <textarea> drive a
 * CRDT document: the browser owns the text box, this function is the
 * only place that has to know how to turn "what changed" into "what
 * operations to broadcast."
 */
export function diffToOps(doc: RGADocument, oldText: string, newText: string): CRDTOp[] {
  let prefixLen = 0;
  const maxPrefix = Math.min(oldText.length, newText.length);
  while (prefixLen < maxPrefix && oldText[prefixLen] === newText[prefixLen]) prefixLen++;

  let suffixLen = 0;
  const maxSuffix = maxPrefix - prefixLen;
  while (
    suffixLen < maxSuffix &&
    oldText[oldText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const removedCount = oldText.length - prefixLen - suffixLen;
  const insertedText = newText.slice(prefixLen, newText.length - suffixLen);

  const ops: CRDTOp[] = [];
  for (let i = 0; i < removedCount; i++) {
    const op = doc.localDelete(prefixLen);
    if (op) ops.push(op);
  }
  for (let i = 0; i < insertedText.length; i++) {
    ops.push(doc.localInsert(prefixLen + i, insertedText[i]));
  }
  return ops;
}
