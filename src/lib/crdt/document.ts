import { charIdEquals, compareCharIds, type CharId, type CRDTNode, type CRDTOp, type DeleteOp, type InsertOp } from "./types";

/**
 * A Replicated Growable Array (RGA) - the classic sequence CRDT for
 * collaborative text (Roh et al., "Replicated abstract data types:
 * Building blocks for collaborative applications", 2011).
 *
 * The core guarantee this class exists to provide: every replica that
 * has received the same set of operations converges to the *identical*
 * text, regardless of what order those operations arrived in, and
 * regardless of how many times a duplicate arrives. That guarantee -
 * not any particular UI - is what "real" means for this project, and
 * it's what document.test.ts spends most of its effort proving.
 *
 * How it works: every character ever typed becomes a permanent node
 * (site id + per-site counter, so ids can never collide across
 * replicas) with a left/right "origin" - the ids of its neighbors at
 * the moment it was inserted. Deleting a character never removes its
 * node, it just flags it deleted (a tombstone) - this is what makes
 * concurrent edits near a deletion resolve safely instead of racing
 * against a position that moved out from under them. When two replicas
 * concurrently insert at the same origin, both end up in the *same*
 * relative order everywhere because the tie is broken by a fixed total
 * order on ids (compareCharIds), never by arrival time.
 */
export class RGADocument {
  readonly siteId: string;
  private sequence: CRDTNode[] = [];
  private counter = 0;
  private pending: CRDTOp[] = [];

  constructor(siteId: string) {
    this.siteId = siteId;
  }

  getText(): string {
    return this.sequence
      .filter((n) => !n.deleted)
      .map((n) => n.value)
      .join("");
  }

  /** Operations still waiting on a dependency (an origin id) that
   * hasn't arrived yet - should always drain to 0 once every op a
   * replica is owed has actually been delivered. */
  get pendingCount(): number {
    return this.pending.length;
  }

  private visibleNodes(): CRDTNode[] {
    return this.sequence.filter((n) => !n.deleted);
  }

  private indexOfId(id: CharId): number {
    return this.sequence.findIndex((n) => charIdEquals(n.id, id));
  }

  private hasId(id: CharId): boolean {
    return this.indexOfId(id) !== -1;
  }

  /** Called when the user typing at *this* site inserts `value` at
   * character offset `visibleIndex` in the currently rendered text.
   * Applies immediately (local edits are never buffered - a site always
   * has its own causal history) and returns the operation to broadcast. */
  localInsert(visibleIndex: number, value: string): InsertOp {
    const visible = this.visibleNodes();
    const leftOrigin = visibleIndex === 0 ? null : visible[visibleIndex - 1].id;
    const rightOrigin = visibleIndex === visible.length ? null : visible[visibleIndex].id;
    const id: CharId = { site: this.siteId, counter: this.counter++ };
    const node: CRDTNode = { id, value, deleted: false, leftOrigin, rightOrigin };
    this.integrateInsert(node);
    return { type: "insert", node };
  }

  /** Called when the user at this site deletes the character at
   * `visibleIndex`. Returns null if the index is out of range. */
  localDelete(visibleIndex: number): DeleteOp | null {
    const visible = this.visibleNodes();
    if (visibleIndex < 0 || visibleIndex >= visible.length) return null;
    const target = visible[visibleIndex];
    target.deleted = true;
    return { type: "delete", id: target.id };
  }

  /** Applies an operation received from another replica. Safe to call
   * with operations in any order and safe to call twice with the exact
   * same operation (both are core CRDT requirements, not just this
   * implementation's choice) - an insert whose dependencies haven't
   * arrived yet is buffered until they do. */
  applyRemote(op: CRDTOp): void {
    if (op.type === "delete") {
      const idx = this.indexOfId(op.id);
      if (idx === -1) {
        this.pending.push(op);
        return;
      }
      this.sequence[idx].deleted = true;
      this.drainPending();
      return;
    }

    if (this.hasId(op.node.id)) return; // duplicate delivery - already applied, no-op

    const leftReady = op.node.leftOrigin === null || this.hasId(op.node.leftOrigin);
    const rightReady = op.node.rightOrigin === null || this.hasId(op.node.rightOrigin);
    if (!leftReady || !rightReady) {
      this.pending.push(op);
      return;
    }

    this.integrateInsert(op.node);
    this.drainPending();
  }

  /** One arrival can unblock a chain of previously-buffered operations
   * (A depended on B, B just arrived), so keep sweeping until a full
   * pass makes no further progress. */
  private drainPending(): void {
    let progressed = true;
    while (progressed) {
      progressed = false;
      const stillPending: CRDTOp[] = [];

      for (const op of this.pending) {
        if (op.type === "delete") {
          const idx = this.indexOfId(op.id);
          if (idx === -1) {
            stillPending.push(op);
            continue;
          }
          this.sequence[idx].deleted = true;
          progressed = true;
          continue;
        }

        if (this.hasId(op.node.id)) {
          progressed = true; // duplicate that arrived while buffered - drop it
          continue;
        }
        const leftReady = op.node.leftOrigin === null || this.hasId(op.node.leftOrigin);
        const rightReady = op.node.rightOrigin === null || this.hasId(op.node.rightOrigin);
        if (!leftReady || !rightReady) {
          stillPending.push(op);
          continue;
        }
        this.integrateInsert(op.node);
        progressed = true;
      }

      this.pending = stillPending;
    }
  }

  /** The heart of RGA: find where `node` belongs by scanning the gap
   * between its left and right origin, yielding to any node already
   * there that wins the fixed tie-break order - this is what makes
   * concurrent inserts at the same position land in the same relative
   * order on every replica, independent of arrival order.
   *
   * Stores its own shallow copy of `node`, never the caller's object -
   * an InsertOp is handed to every replica (including this document's
   * own return value to callers), and if two documents ever held the
   * *same* node object, one replica's local mutation of its `deleted`
   * flag would silently leak into every other replica holding that
   * reference, corrupting state that hadn't actually received the
   * delete yet. This one clone is what makes every document's copy of
   * the shared history genuinely independent. */
  private integrateInsert(node: CRDTNode): void {
    node = { ...node };
    let leftIdx = -1;
    if (node.leftOrigin !== null) {
      leftIdx = this.indexOfId(node.leftOrigin);
      if (leftIdx === -1) {
        throw new Error(`integrateInsert: left origin ${node.leftOrigin.site}:${node.leftOrigin.counter} not found - caller violated the causal-delivery invariant`);
      }
    }

    let rightIdx = this.sequence.length;
    if (node.rightOrigin !== null) {
      rightIdx = this.indexOfId(node.rightOrigin);
      if (rightIdx === -1) {
        throw new Error(`integrateInsert: right origin ${node.rightOrigin.site}:${node.rightOrigin.counter} not found - caller violated the causal-delivery invariant`);
      }
    }

    let i = leftIdx + 1;
    while (i < rightIdx) {
      const other = this.sequence[i];
      if (compareCharIds(other.id, node.id) > 0) i++;
      else break;
    }
    this.sequence.splice(i, 0, node);
  }
}
