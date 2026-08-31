# Braid

[![CI](https://github.com/Eddiegah/braid/actions/workflows/ci.yml/badge.svg)](https://github.com/Eddiegah/braid/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Live demo](https://img.shields.io/badge/demo-live-3ecf8e?logo=vercel&logoColor=white)](https://braid-rose.vercel.app)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)
![Tests](https://img.shields.io/badge/tests-20%20passing-brightgreen)

**[braid-rose.vercel.app](https://braid-rose.vercel.app)**

A real-time collaborative text editor built on a from-scratch CRDT - a
Replicated Growable Array (RGA), the classic sequence CRDT for
collaborative text (Roh et al., 2011). No server, no operational-
transform library, no external CRDT package - the merge algorithm that
makes concurrent edits converge is entirely implemented in
`src/lib/crdt/`, and it's what's actually running under the three
editor panes in the demo. Each pane shows a live count of messages
received and a brief highlight the instant one arrives, so the network
simulation isn't just claimed in a status line - you can watch it happen.

## What "real" means here

Convergence - every replica ending up with the *exact same* text
regardless of what order operations arrived in - is the entire point
of a CRDT. It's also easy to get subtly wrong in a way that only shows
up under specific interleavings. So the test suite (20 tests across
`document.test.ts` and `diff.test.ts`) is built around proving that
guarantee directly, not just checking that typing looks right:

- **Concurrent inserts at the same position** on two replicas, applied
  to each other in *opposite* delivery orders, still produce identical
  text on both sides.
- **Out-of-order delivery**: a fully reversed stream of causally-
  dependent inserts still reconstructs the original text (dependencies
  are buffered until their left/right neighbor actually arrives).
- **Duplicate delivery** (the same operation applied twice - a real
  network condition, not a hypothetical) is a no-op the second time,
  for both inserts and deletes.
- **Concurrent insert next to a concurrent delete** - one replica
  deletes a character while another inserts right beside it, neither
  aware of the other's edit - still converges correctly on both sides.
- **A 30-trial randomized property test**: three replicas each perform
  a random sequence of local inserts/deletes against their own
  independent view, then every operation is delivered to every replica
  in an independently-shuffled order. All three converge, every trial.

## A real bug this caught

The first version had a genuine, nasty aliasing bug: `localInsert`
creates one JavaScript object for the new character node, both storing
it locally *and* returning it as part of the operation broadcast to
other replicas. `applyRemote` stored that same object reference
directly - so two documents that received the same insert operation
ended up holding the *identical* underlying object, not independent
copies. When one replica later deleted that character (mutating the
node's `deleted` flag in place), the mutation silently leaked into
every other replica holding that same reference - including ones that
had never received any delete operation at all.

This is precisely the kind of bug automated correctness tests are
built to catch, and it did: a test for "concurrent insert next to a
concurrent delete" failed with one replica missing a character it
should have had, well before any actual delete operation had reached
it. The fix is one line - `integrateInsert` now takes its own shallow
copy of every node before storing it - but it's a real illustration of
why "make every document's copy of shared state genuinely independent"
has to be enforced at the single chokepoint every insert passes
through, not trusted to every caller. There's now a dedicated
regression test (`document.test.ts`, "node-identity regression") that
directly asserts one document's local delete never affects another
that received the same insert.

## Architecture

```
src/lib/crdt/
  types.ts       CharId (site + per-site counter), CRDTNode, operation types
  document.ts    RGADocument - integrateInsert, applyRemote, causal buffering
  diff.ts        turns a plain "old text -> new text" change into CRDT ops
                 (this is what lets an ordinary <textarea> drive the CRDT)

src/app/
  CollabDemo.tsx  three independent RGADocument instances ("Ava", "Ben",
                  "Cleo"), a simulated network with an Instant mode and a
                  Chaotic mode (random 300-2500ms delay, independently
                  per message, so ops can and do arrive out of order),
                  and a live convergence indicator
```

Each character ever typed becomes a permanent node identified by
`{site, counter}` - ids can never collide across replicas because each
site owns its own counter. Deleting never removes a node, it only
tombstones it (`deleted: true`); visible text is just the
tombstone-filtered sequence, which is what lets a delete and a nearby
concurrent insert resolve safely instead of racing over a position
that moved out from under them. When two replicas insert at the same
origin concurrently, the tie is broken by a fixed total order on ids
(`compareCharIds`) - never by arrival time - so every replica resolves
it identically.

## Try it

- Type in more than one pane - Instant mode delivers changes
  immediately, so all three panes always show the same text.
- Switch to **Chaotic** mode and keep typing, or use **Inject
  concurrent edit** to fire two simultaneous inserts at the same
  position from two different panes. Watch the panes genuinely
  disagree for a moment (that's expected, not a bug - the banner says
  "Diverged" or shows a message count in flight) and then converge to
  an identical merged result once delivery catches up.

## Local development

```bash
npm install
npm run dev
npm test
```

## Deliberately out of scope for v1

- Real networking (WebSocket/WebRTC) - the "network" is simulated
  in-memory in the browser tab, which is what makes the chaotic-
  delivery demo controllable and repeatable
- Cursor/selection presence (showing where each collaborator's cursor
  is) - this demo is about text convergence, not full editor UX
- Persistence - refreshing the page resets all three documents
- Compaction of tombstones - a long-lived real document would need a
  garbage-collection strategy for deleted nodes; this demo's documents
  are short-lived enough that it doesn't matter

## License

MIT © [Edmund Eric Gah](https://github.com/Eddiegah) - see [LICENSE](LICENSE).
