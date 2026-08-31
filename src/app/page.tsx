import { CollabDemo } from "./CollabDemo";

export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col items-center px-6 py-12">
      <div className="w-full max-w-5xl">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground">Braid</h1>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted">
            A real-time collaborative text editor built on a from-scratch CRDT (a Replicated Growable Array). Three
            independent replicas below - type in more than one at once, or switch to chaotic network mode and watch
            messages arrive late and out of order. They always converge to the exact same text.
          </p>
        </div>

        <CollabDemo />

        <div className="mx-auto mt-8 max-w-2xl rounded-xl border border-border bg-surface p-4 text-xs leading-relaxed text-muted">
          <p className="mb-2">
            Every character typed becomes a permanent, uniquely-identified node with a reference to its left and
            right neighbor at insertion time. Deleting never removes a node, it only tombstones it - visible text is
            just the tombstone-filtered sequence. When two replicas insert at the same position concurrently, both
            resolve the tie the same way everywhere, using a fixed order on character ids rather than arrival time -
            that&apos;s what makes convergence hold regardless of network conditions.
          </p>
          <p>
            In chaotic mode, an insert that references a neighbor a replica hasn&apos;t received yet is buffered
            until that neighbor arrives, then integrated - so &quot;Diverged&quot; during delivery is expected and
            temporary, not a bug. Once every message settles, all three panes are byte-for-byte identical.
          </p>
        </div>
      </div>
    </div>
  );
}
