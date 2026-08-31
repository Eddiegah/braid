/** A character's identity is permanent and globally unique: which site
 * created it, and that site's own monotonic counter at the time. Two
 * different sites never produce the same id, and a given id always
 * refers to the same character forever - it's never reused, even after
 * the character is deleted (deletion is a tombstone, not a removal). */
export interface CharId {
  site: string;
  counter: number;
}

export function charIdEquals(a: CharId | null, b: CharId | null): boolean {
  if (a === null || b === null) return a === b;
  return a.site === b.site && a.counter === b.counter;
}

/** The total order used to break ties between characters inserted
 * concurrently at the same position. Any consistent total order works
 * for CRDT correctness - what matters is that every replica uses the
 * exact same one, so they all resolve the tie identically. */
export function compareCharIds(a: CharId, b: CharId): number {
  if (a.counter !== b.counter) return a.counter - b.counter;
  return a.site < b.site ? -1 : a.site > b.site ? 1 : 0;
}

export interface CRDTNode {
  id: CharId;
  value: string;
  deleted: boolean;
  /** the id of the node immediately to this node's left at the moment
   * it was inserted - not necessarily its left neighbor now, since
   * concurrent inserts may have landed between them since. */
  leftOrigin: CharId | null;
  /** likewise, the id of the node immediately to the right at
   * insertion time - together with leftOrigin this anchors where a
   * remote replica should place the node once it arrives. */
  rightOrigin: CharId | null;
}

export interface InsertOp {
  type: "insert";
  node: CRDTNode;
}

export interface DeleteOp {
  type: "delete";
  id: CharId;
}

export type CRDTOp = InsertOp | DeleteOp;
