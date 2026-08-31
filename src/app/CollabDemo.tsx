"use client";

import { useRef, useState } from "react";
import { RGADocument } from "@/lib/crdt/document";
import { diffToOps } from "@/lib/crdt/diff";
import type { CRDTOp } from "@/lib/crdt/types";

const SITES = [
  { id: "A", name: "Ava", color: "var(--site-a)", bg: "var(--site-a-bg)" },
  { id: "B", name: "Ben", color: "var(--site-b)", bg: "var(--site-b-bg)" },
  { id: "C", name: "Cleo", color: "var(--site-c)", bg: "var(--site-c-bg)" },
] as const;

type NetworkMode = "instant" | "chaotic";
type SiteId = (typeof SITES)[number]["id"];

/** Kept outside the component so it's unambiguously an event-driven
 * side effect (called only from broadcast, itself only reachable from
 * onChange/onClick handlers), never something the render path itself
 * could call. */
function randomNetworkDelayMs(): number {
  return 300 + Math.random() * 2200;
}

export function CollabDemo() {
  const docsRef = useRef(new Map(SITES.map((s) => [s.id, new RGADocument(s.id)])));
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(SITES.map((s) => [s.id, ""])));
  const [mode, setMode] = useState<NetworkMode>("instant");
  const [inFlight, setInFlight] = useState(0);

  function refreshTexts() {
    setTexts(Object.fromEntries(SITES.map((s) => [s.id, docsRef.current.get(s.id)!.getText()])));
  }

  function broadcast(fromSiteId: SiteId, ops: CRDTOp[]) {
    for (const site of SITES) {
      if (site.id === fromSiteId) continue;
      for (const op of ops) {
        if (mode === "instant") {
          docsRef.current.get(site.id)!.applyRemote(op);
        } else {
          const delay = randomNetworkDelayMs();
          setInFlight((c) => c + 1);
          setTimeout(() => {
            docsRef.current.get(site.id)!.applyRemote(op);
            setInFlight((c) => c - 1);
            refreshTexts();
          }, delay);
        }
      }
    }
    refreshTexts();
  }

  function handleChange(siteId: SiteId, newText: string) {
    const doc = docsRef.current.get(siteId)!;
    const oldText = doc.getText();
    const ops = diffToOps(doc, oldText, newText);
    broadcast(siteId, ops);
  }

  function injectConcurrentDemo() {
    const [siteA, siteB] = SITES;
    const docA = docsRef.current.get(siteA.id)!;
    const docB = docsRef.current.get(siteB.id)!;
    const commonLength = docA.getText().length;
    const midpoint = Math.floor(commonLength / 2);

    // both sites insert at the SAME position, from the SAME starting
    // text, neither aware of the other - a genuine concurrent edit
    const opA = docA.localInsert(midpoint, "🦊");
    const opB = docB.localInsert(midpoint, "🐢");
    broadcast(siteA.id, [opA]);
    broadcast(siteB.id, [opB]);
  }

  const allTexts = SITES.map((s) => texts[s.id]);
  const converged = allTexts.every((t) => t === allTexts[0]);
  const settled = inFlight === 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-foreground">Network:</span>
          <div className="flex overflow-hidden rounded-lg border border-border">
            <button
              onClick={() => setMode("instant")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${mode === "instant" ? "bg-accent text-accent-foreground" : "bg-surface text-muted hover:text-foreground"}`}
            >
              Instant
            </button>
            <button
              onClick={() => setMode("chaotic")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${mode === "chaotic" ? "bg-accent text-accent-foreground" : "bg-surface text-muted hover:text-foreground"}`}
            >
              Chaotic (random delay + reordering)
            </button>
          </div>
        </div>

        <button
          onClick={injectConcurrentDemo}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:border-accent"
        >
          Inject concurrent edit (🦊 vs 🐢, same position)
        </button>

        <div className="flex items-center gap-2 text-xs">
          {!settled && <span className="text-[var(--status-pending)]">{inFlight} message{inFlight === 1 ? "" : "s"} in flight...</span>}
          {settled && converged && <span className="font-medium text-[var(--status-ok)]">✓ Converged</span>}
          {settled && !converged && <span className="text-[var(--status-pending)]">Diverged</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {SITES.map((site) => (
          <div key={site.id} className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2" style={{ background: site.bg }}>
              <span className="h-2 w-2 rounded-full" style={{ background: site.color }} />
              <span className="text-sm font-semibold" style={{ color: site.color }}>
                {site.name}
              </span>
            </div>
            <textarea
              value={texts[site.id]}
              onChange={(e) => handleChange(site.id, e.target.value)}
              rows={10}
              placeholder={`Type here as ${site.name}...`}
              className="flex-1 resize-none bg-transparent p-3 text-sm leading-relaxed text-foreground outline-none"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
