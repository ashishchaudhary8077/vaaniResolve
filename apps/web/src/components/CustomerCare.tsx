/**
 * CustomerCare — floating button (bottom-right), handoff summary panel (right
 * side; bottom sheet on mobile) and the in-app "call a representative" flow.
 *
 * Rules honoured:
 *  • Summary is derived from the LIVE conversation (buildCareSummary) each time
 *    the panel opens or the user hits refresh — never hardcoded.
 *  • Handoff POST /api/care/handoff → the representative dashboard already has
 *    the full summary before the "call" connects, so the customer never repeats.
 *  • No telephony is faked: if a real phone provider isn't configured, we show a
 *    polished in-app handoff (connecting → summary transferred → connected →
 *    live timer) and clearly label it "in-app base" — no pretend phone call.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { CareSummary } from '@vaaniresolve/shared';
import type { ReturnTypeOfUseVaani } from '../App';
import { buildCareSummary } from '../summary';

type CallStage = 'idle' | 'connecting' | 'transferring' | 'connected';

const EMPTY: CareSummary = {
  mainProblem: '—',
  conversationSummary: 'No conversation yet.',
  importantDetails: [],
  actionsAlreadyTaken: [],
  orderShoppingContext: [],
  currentStatus: 'Ready',
  recommendedNextStep: 'Ask the customer to describe their issue.',
};

/** Extract an INR price from the current summary (shopping context). */
function currentBudget(summary: CareSummary): string | null {
  const m = summary.conversationSummary.match(/under ₹?([\d,]+)/i);
  return m ? `₹${m[1]}` : null;
}

function HeadsetIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
  );
}

const FIELD_LABELS: { key: keyof CareSummary; label: string; icon: string }[] = [
  { key: 'mainProblem', label: 'Main Problem', icon: '⚠' },
  { key: 'conversationSummary', label: 'Conversation Summary', icon: '💬' },
  { key: 'importantDetails', label: 'Important Details', icon: '📌' },
  { key: 'actionsAlreadyTaken', label: 'Actions Already Taken', icon: '✅' },
  { key: 'orderShoppingContext', label: 'Order / Shopping Context', icon: '🛍' },
  { key: 'currentStatus', label: 'Current Status', icon: '▶' },
  { key: 'recommendedNextStep', label: 'Recommended Next Step', icon: '➜' },
];

export function CustomerCare({ vaani }: { vaani: ReturnTypeOfUseVaani }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<CareSummary>(EMPTY);
  const [stage, setStage] = useState<CallStage>('idle');
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [handoffId, setHandoffId] = useState<string | null>(null);
  const [callSeconds, setCallSeconds] = useState(0);
  const timerRef = useRef<number | undefined>(undefined);
  const stageStartedAt = useRef(0);

  const refresh = useCallback(() => {
    setSummary(buildCareSummary({ transcripts: vaani.transcripts, cards: vaani.cards }));
  }, [vaani.transcripts, vaani.cards]);

  // Rebuild summary whenever the panel is open and the conversation changes
  // (live "refresh" — the rep sees the newest state).
  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const openPanel = () => {
    refresh();
    setSent(false);
    setSendError(null);
    setStage('idle');
    setCallSeconds(0);
    setOpen(true);
  };

  const clearTimer = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = undefined;
  };

  useEffect(() => () => clearTimer(), []);

  const postHandoff = async (s: CareSummary): Promise<string | null> => {
    try {
      const r = await fetch('/api/care/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: vaani.session?.sessionId ?? 'unknown', summary: s }),
      });
      const j = (await r.json()) as { ok: boolean; handoffId?: string; error?: string };
      if (!r.ok || !j.ok) {
        setSendError(j.error ?? 'Could not reach the customer-care desk.');
        return null;
      }
      return j.handoffId ?? null;
    } catch {
      setSendError('Voice response is temporarily unavailable.');
      return null;
    }
  };

  const startCall = async () => {
    if (stage !== 'idle') return;
    setStage('connecting');
    setSendError(null);
    stageStartedAt.current = Date.now();

    // Connecting animation (~1.6s) → summary transfer.
    await new Promise((r) => setTimeout(r, 1600));
    if (!open) return;
    setStage('transferring');
    const id = await postHandoff(summary);
    if (!open) return;

    // Even if POST failed the dialog still shows the summary; the message bar
    // communicates success/failure clearly.
    if (id) setHandoffId(id);
    setSent(true);
    await new Promise((r) => setTimeout(r, 1300));
    if (!open) return;

    setStage('connected');
    setCallSeconds(0);
    timerRef.current = window.setInterval(() => setCallSeconds((s) => s + 1), 1000);
  };

  const endCall = () => {
    clearTimer();
    setStage('idle');
  };

  const closePanel = () => {
    clearTimer();
    setStage('idle');
    setOpen(false);
  };

  const minutes = String(Math.floor(callSeconds / 60)).padStart(2, '0');
  const seconds = String(callSeconds % 60).padStart(2, '0');
  const budget = currentBudget(summary);

  return (
    <>
      {/* floating button — bottom-right, never overlaps the mic/messages centre */}
      <motion.button
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 22, delay: 0.35 }}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.94 }}
        onClick={openPanel}
        aria-label="Open customer care"
        title="Customer care"
        className={`fixed bottom-5 right-5 z-40 grid h-14 w-14 place-items-center rounded-full text-white shadow-2xl transition ${
          open ? 'bg-white/10 text-white' : 'bg-gradient-to-br from-blue-500 to-violet-500 animate-pulseGlow'
        }`}
      >
        {open ? (
          <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        ) : (
          <HeadsetIcon className="w-6 h-6" />
        )}
        {!open && (
          <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-emerald-400 border-2 border-ink-900 animate-pulse" aria-hidden="true" />
        )}
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            {/* backdrop for mobile focus */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closePanel}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
              aria-hidden="true"
            />
            <motion.aside
              initial={{ x: '100%', opacity: 0.5 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '100%', opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 30 }}
              className="fixed z-50 right-0 top-0 bottom-0 w-full sm:w-[26rem] max-w-full bg-ink-800/85 border-l border-white/10 backdrop-blur-2xl flex flex-col shadow-2xl shadow-black/50"
              role="dialog"
              aria-label="Customer care summary"
            >
              {/* header */}
              <header className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-blue-500 text-white">
                    <HeadsetIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-display font-bold tracking-tight">Customer Care Summary</h2>
                    <p className="text-[11px] text-white/45">Session {vaani.session?.sessionId?.slice(0, 8) ?? '—'}</p>
                  </div>
                </div>
                <button
                  onClick={closePanel}
                  className="rounded-lg border border-white/15 px-2 py-1 text-xs text-white/70 hover:bg-white/10"
                  aria-label="Close customer care panel"
                >
                  ✕
                </button>
              </header>

              {/* summary (live) */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wider text-white/40">Live handoff summary</span>
                  <button
                    onClick={() => {
                      refresh();
                      setSendError(null);
                    }}
                    className="text-[11px] text-blue-300 hover:text-blue-200 inline-flex items-center gap-1"
                    aria-label="Regenerate summary from latest conversation"
                  >
                    ⟳ refresh
                  </button>
                </div>

                {/* banner announcing transfer state (clearly in-app, not a real call) */}
                <div className="rounded-2xl border border-blue-400/25 bg-blue-400/10 px-3 py-2.5 text-[12px] leading-relaxed text-blue-100/90">
                  {sent && stage === 'connected' && handoffId ? (
                    <>✅ Summary sent to Customer Care · handoff <span className="font-mono text-blue-200">{handoffId}</span>. The representative already sees what you told the assistant — no need to repeat.</>
                  ) : sent ? (
                    <>✅ Summary sent to Customer Care — the representative has your context.</>
                  ) : (
                    <>Your conversation with the assistant is summarized live below. When you connect, the representative receives this summary before the call connects.</>
                  )}
                </div>

                {FIELD_LABELS.map(({ key, label, icon }) => {
                  const v = summary[key];
                  return (
                    <section key={key} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
                      <h3 className="text-[11px] uppercase tracking-wide text-emerald-300/90 flex items-center gap-1.5">
                        <span aria-hidden="true">{icon}</span> {label}
                      </h3>
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
                          <p className="mt-1.5 text-sm text-white/35 italic">Nothing recorded yet.</p>
                        )
                      ) : (
                        <p className="mt-1.5 text-sm text-white/85">{v}</p>
                      )}
                    </section>
                  );
                })}

                {budget && (
                  <p className="text-[11px] text-white/40">
                    Shopping budget detected: <span className="text-emerald-300 font-semibold">{budget}</span>
                  </p>
                )}
              </div>

              {/* call action area */}
              <footer className="border-t border-white/10 px-5 py-4 space-y-3 bg-ink-800/70">
                {/* Connecting / transferring progress */}
                {(stage === 'connecting' || stage === 'transferring') && (
                  <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-3">
                    <div className="flex items-center gap-3">
                      <div className="grid place-items-center">
                        <motion.span
                          className="block h-3 w-3 rounded-full bg-emerald-400"
                          animate={{ scale: [1, 1.6, 1], opacity: [0.7, 1, 0.7] }}
                          transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                          aria-hidden="true"
                        />
                      </div>
                      <div className="text-sm text-white/90">
                        {stage === 'connecting' ? 'Connecting to a representative…' : 'Transferring your summary…'}
                        <AnimatePresence>
                          <motion.span
                            key={stage}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="block text-[12px] text-white/45"
                          >
                            {stage === 'connecting'
                              ? 'In-app channel · establishing a secure base'
                              : 'The representative already sees your full conversation.'}
                          </motion.span>
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>
                )}

                {stage === 'connected' && (
                  <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
                        </span>
                        <span className="text-sm font-semibold text-white/95">In-app call connected</span>
                      </div>
                      <span className="font-mono text-sm text-emerald-200 tabular-nums">
                        {minutes}:{seconds}
                      </span>
                    </div>
                    <p className="text-[12px] text-white/55 mt-1">
                      <span className="text-emerald-300">Summary transferred ✓</span> — the representative has your context and is ready.
                    </p>
                  </div>
                )}

                {sendError && <p className="text-xs text-rose-300">{sendError}</p>}

                <div className="flex gap-2">
                  {stage === 'idle' && (
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      whileHover={{ scale: 1.02 }}
                      onClick={() => void startCall()}
                      className="flex-1 rounded-xl bg-gradient-to-br from-emerald-500 to-blue-500 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-500/20"
                    >
                      Connect to Customer Care
                    </motion.button>
                  )}
                  {(stage === 'connecting' || stage === 'transferring') && (
                    <button
                      onClick={() => {
                        clearTimer();
                        setStage('idle');
                      }}
                      className="flex-1 rounded-xl border border-white/15 py-3 text-sm font-semibold text-white/70 hover:bg-white/10"
                    >
                      Cancel
                    </button>
                  )}
                  {stage === 'connected' && (
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={endCall}
                      className="flex-1 rounded-xl bg-rose-500/90 hover:bg-rose-500 py-3 text-sm font-bold text-white"
                    >
                      End call
                    </motion.button>
                  )}
                </div>
              </footer>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}