/**
 * CareDashboard — representative view at `#/care` (separate tab → role switch).
 * Realistic call-centre look: latest handoff card with the same summary fields
 * the customer approved, status controls, and a live "incoming" ticker.
 * Reads from the in-memory backend store — the handoff the customer POSTed.
 */

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import type { CareHandoff } from '@vaaniresolve/shared';

const STATUS_THEME: Record<CareHandoff['status'], string> = {
  OPEN: 'bg-amber-400/15 text-amber-300 border-amber-400/30',
  IN_PROGRESS: 'bg-blue-400/15 text-blue-300 border-blue-400/30',
  RESOLVED: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/30',
};

const FIELDS: { key: keyof CareHandoff['summary']; label: string }[] = [
  { key: 'mainProblem', label: 'Main Problem' },
  { key: 'conversationSummary', label: 'Conversation Summary' },
  { key: 'importantDetails', label: 'Important Details' },
  { key: 'actionsAlreadyTaken', label: 'Actions Already Taken' },
  { key: 'orderShoppingContext', label: 'Order / Shopping Context' },
  { key: 'currentStatus', label: 'Current Status' },
  { key: 'recommendedNextStep', label: 'Recommended Next Step' },
];

export function CareDashboard() {
  const [handoff, setHandoff] = useState<CareHandoff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = async () => {
    try {
      const r = await fetch('/api/care/latest');
      const j = (await r.json()) as { ok: boolean; handoff: CareHandoff | null };
      if (r.ok && j.ok) {
        setHandoff(j.handoff);
        setError(null);
      } else {
        setError('No handoff yet — the customer has not connected.');
      }
    } catch {
      setError('Customer-care service is not reachable.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // Poll while on the dashboard so the newest handoff appears live.
  useEffect(() => {
    const t = window.setInterval(() => {
      void load();
      setTick((x) => x + 1);
    }, 5000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateStatus = async (status: CareHandoff['status']) => {
    if (!handoff) return;
    try {
      const r = await fetch(`/api/care/handoffs/${handoff.handoffId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (r.ok) {
        const j = (await r.json()) as { handoff: CareHandoff };
        setHandoff(j.handoff);
      }
    } catch {
      /* ignore */
    }
  };

  const GoBack = (
    <a href="#/" className="inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white/80">
      ← Back to customer kiosk
    </a>
  );

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-4 border-b border-white/10 bg-ink-800/50 backdrop-blur flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-blue-500 text-white text-sm font-bold shadow-lg">
            CC
          </div>
          <div>
            <h1 className="font-display font-bold tracking-tight">Customer Care · Representative Desk</h1>
            <p className="text-[11px] text-white/50">Live handoff queue · real summaries from the kiosk</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[11px] text-emerald-300">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            Desk online
          </span>
          {GoBack}
        </div>
      </header>

      <main className="flex-1 px-6 py-6 max-w-4xl w-full mx-auto">
        {loading && <p className="text-sm text-white/50">Loading latest handoff…</p>}

        {error && !handoff && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center"
          >
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-white/5 text-2xl">🎧</div>
            <p className="font-display font-semibold text-white/90">Waiting for a handoff</p>
            <p className="mt-1 text-sm text-white/45">
              {error} Open the customer kiosk in another tab, ask a question, then tap the customer-care button and connect.
            </p>
          </motion.div>
        )}

        {handoff && (
          <motion.section
            key={handoff.handoffId}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 28 }}
            className="rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl overflow-hidden shadow-2xl shadow-black/40"
          >
            <div className="px-6 py-4 border-b border-white/10 bg-gradient-to-r from-emerald-400/10 via-transparent to-blue-500/10 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-white/8 font-display font-bold text-white">
                  {handoff.customerName ? handoff.customerName[0].toUpperCase() : 'C'}
                </span>
                <div>
                  <p className="font-display font-bold">{handoff.customerName ?? 'Customer'}</p>
                  <p className="text-[11px] text-white/45 font-mono">
                    {handoff.handoffId} · {new Date(handoff.receivedAt).toLocaleTimeString()} · session {handoff.sessionId.slice(0, 8)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${STATUS_THEME[handoff.status]}`}>
                  {handoff.status.replace('_', ' ')}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-white/50">
                  auto-refresh {tick % 60}s
                </span>
              </div>
            </div>

            <div className="px-6 py-5 space-y-4">
              {FIELDS.map(({ key, label }) => {
                const v = handoff.summary[key];
                return (
                  <div key={key}>
                    <h3 className="text-[11px] uppercase tracking-wider text-emerald-300/80">{label}</h3>
                    {Array.isArray(v) ? (
                      v.length ? (
                        <ul className="mt-1.5 space-y-1">
                          {v.map((x, i) => (
                            <li key={i} className="text-sm text-white/80 flex gap-2">
                              <span className="text-white/30">•</span>
                              <span>{x}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-sm text-white/35 italic">Nothing recorded.</p>
                      )
                    ) : (
                      <p className="mt-1 text-sm text-white/85 leading-relaxed">{v}</p>
                    )}
                  </div>
                );
              })}

              {handoff.summary.customerLastAsked && (
                <p className="text-[11px] text-white/45">
                  Customer's last ask: <span className="text-white/70 italic">“{handoff.summary.customerLastAsked}”</span>
                </p>
              )}
            </div>

            <div className="px-6 py-4 border-t border-white/10 bg-ink-900/40 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[12px] text-white/45">
                Handoff received — you can pick up where the assistant left off.
              </p>
              <div className="flex gap-2">
                {(['OPEN', 'IN_PROGRESS', 'RESOLVED'] as const).map((s) => (
                  <motion.button
                    key={s}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => void updateStatus(s)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                      handoff.status === s
                        ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-200'
                        : 'border-white/10 text-white/55 hover:bg-white/5'
                    }`}
                  >
                    {s === 'RESOLVED' ? 'Mark resolved' : s === 'IN_PROGRESS' ? 'In progress' : 'Open'}
                  </motion.button>
                ))}
              </div>
            </div>
          </motion.section>
        )}
      </main>
    </div>
  );
}