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
  const [pendingBySite, setPendingBySite] = useState<Record<string, number>>(() => Object.fromEntries(SITES.map((s) => [s.id, 0])));
  const [receivedBySite, setReceivedBySite] = useState<Record<string, number>>(() => Object.fromEntries(SITES.map((s) => [s.id, 0])));
  const [flashSite, setFlashSite] = useState<SiteId | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function refreshTexts() {
    setTexts(Object.fromEntries(SITES.map((s) => [s.id, docsRef.current.get(s.id)!.getText()])));
  }

  function triggerFlash(siteId: SiteId) {
    setFlashSite(siteId);
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = setTimeout(() => setFlashSite(null), 500);
  }

  function broadcast(fromSiteId: SiteId, ops: CRDTOp[]) {
    for (const site of SITES) {
      if (site.id === fromSiteId) continue;
      for (const op of ops) {
        if (mode === "instant") {
          docsRef.current.get(site.id)!.applyRemote(op);
          setReceivedBySite((r) => ({ ...r, [site.id]: r[site.id] + 1 }));
          triggerFlash(site.id);
        } else {
          const delay = randomNetworkDelayMs();
          setInFlight((c) => c + 1);
          setPendingBySite((p) => ({ ...p, [site.id]: p[site.id] + 1 }));
          setTimeout(() => {
            docsRef.current.get(site.id)!.applyRemote(op);
            setInFlight((c) => c - 1);
            setPendingBySite((p) => ({ ...p, [site.id]: Math.max(0, p[site.id] - 1) }));
            setReceivedBySite((r) => ({ ...r, [site.id]: r[site.id] + 1 }));
            triggerFlash(site.id);
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
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-accent"
        >
          Inject concurrent edit (🦊 vs 🐢, same position)
        </button>

        <div className="flex items-center gap-2 text-xs">
          <span
            className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${settled && converged ? "bg-[var(--status-ok)]" : "animate-pulse bg-[var(--status-pending)]"}`}
          />
          {!settled && (
            <span className="text-[var(--status-pending)]">
              {inFlight} message{inFlight === 1 ? "" : "s"} in flight&hellip;
            </span>
          )}
          {settled && converged && <span className="font-medium text-[var(--status-ok)]">Converged</span>}
          {settled && !converged && <span className="text-[var(--status-pending)]">Diverged</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {SITES.map((site) => {
          const pending = pendingBySite[site.id];
          const isFlashing = flashSite === site.id;
          return (
            <div
              key={site.id}
              className="flex flex-col overflow-hidden rounded-xl border bg-surface shadow-sm transition-[border-color,box-shadow] duration-300"
              style={{
                borderColor: isFlashing ? site.color : "var(--border)",
                boxShadow: isFlashing ? `0 0 0 3px color-mix(in srgb, ${site.color} 20%, transparent)` : undefined,
              }}
            >
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2" style={{ background: site.bg }}>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: site.color }} />
                  <span className="text-sm font-semibold" style={{ color: site.color }}>
                    {site.name}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {pending > 0 && (
                    <span
                      className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{ background: site.bg, color: site.color }}
                    >
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: site.color }} />
                      {pending} incoming
                    </span>
                  )}
                  <span className="text-[10px] text-muted">{receivedBySite[site.id]} received</span>
                </div>
              </div>
              <textarea
                value={texts[site.id]}
                onChange={(e) => handleChange(site.id, e.target.value)}
                rows={10}
                placeholder={`Type here as ${site.name}...`}
                className="flex-1 resize-none bg-transparent p-3 text-sm leading-relaxed text-foreground outline-none"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
