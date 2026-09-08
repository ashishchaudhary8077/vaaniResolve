import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { ConversationState, ResolutionCard } from '@vaaniresolve/shared';
import { useVaani } from './useVaani';
import { DevPanel } from './components/DevPanel';
import { DemoControls } from './components/DemoControls';
import { CustomerCare } from './components/CustomerCare';
import { CareDashboard } from './components/CareDashboard';
import { AnimatedBackground } from './components/AnimatedBackground';

export type ReturnTypeOfUseVaani = ReturnType<typeof useVaani>;

const STATE_LABEL: Record<ConversationState, { label: string; color: string }> = {
  IDLE: { label: 'Ready', color: '#64748b' },
  LISTENING: { label: 'Listening', color: '#34d399' },
  PROCESSING: { label: 'Thinking', color: '#fbbf24' },
  TOOL_RUNNING: { label: 'Fetching', color: '#60a5fa' },
  SPEAKING: { label: 'Speaking', color: '#a78bfa' },
  INTERRUPTED: { label: 'Interrupted', color: '#fb7185' },
  WAITING_CONFIRMATION: { label: 'Confirm', color: '#fb923c' },
  EXECUTING_ACTION: { label: 'Applying', color: '#3b82f6' },
  RESOLVED: { label: 'Resolved', color: '#34d399' },
  ERROR: { label: 'Error', color: '#f43f5e' },
};

const RING_COLOR = { active: 'rgba(52,211,153,0.35)', speaking: 'rgba(167,139,250,0.35)' };

export default function App() {
  const vaani = useVaani((import.meta as { env: { VITE_WS?: string } }).env?.VITE_WS ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  const [devPanel, setDevPanel] = useState(false);
  const [holdToTalk, setHoldToTalk] = useState(true);
  const [textDraft, setTextDraft] = useState('');
  const [route, setRoute] = useState(window.location.hash);

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const stateMeta = STATE_LABEL[vaani.state] ?? STATE_LABEL.IDLE;
  const speaking = vaani.state === 'SPEAKING';

  const sendText = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    vaani.sendTextTurn(t);
  };

  // Representative desk at #/care — a clean role switch in a separate view.
  if (route === '#/care') {
    return (
      <div className="min-h-screen">
        <AnimatedBackground />
        <div className="relative z-10">
          <CareDashboard />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col md:flex-row h-full min-h-screen">
      <AnimatedBackground />
      <div className="relative z-10 flex-1 flex flex-col min-w-0">
      <div className="flex-1 flex flex-col min-w-0">
        {/* header */}
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="flex items-center justify-between px-5 py-3 border-b border-white/10"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 grid place-items-center font-display font-extrabold text-white shadow-lg shadow-blue-500/30">
              V
            </div>
            <div>
              <h1 className="font-display font-bold tracking-tight text-lg leading-none">VaaniResolve</h1>
              <p className="text-[11px] text-white/50">Talk · Interrupt · Resolve</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${vaani.connected ? 'bg-emerald-400' : 'bg-rose-500'} animate-pulse`} aria-hidden="true" />
            <span className="text-xs text-white/60 hidden sm:inline">
              {vaani.connected ? 'Voice channel open' : vaani.reconnecting ? 'Assistant unavailable — retrying…' : 'Connecting…'}
            </span>
            <button
              onClick={() => setDevPanel((v) => !v)}
              className="text-[11px] px-2.5 py-1 rounded-md border border-white/15 text-white/70 hover:bg-white/10"
              aria-label="Toggle developer panel"
            >
              Dev
            </button>
          </div>
        </motion.header>

        {/* state chip — clean, minimal. Tool running state stays internal. */}
        <div className="flex items-center justify-center gap-2 px-5 py-3" aria-live="polite">
          <motion.span
            key={vaani.state}
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: stateMeta.color }}
            animate={{ scale: [1, 1.45, 1], opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            aria-hidden="true"
          />
          <span className="text-sm font-semibold text-white/90">{stateMeta.label}</span>
          {vaani.interim && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs text-white/40 italic truncate">
              “{vaani.interim}…”
            </motion.span>
          )}
        </div>

        {/* voice surface — the mic is the hero; no noisy waveform */}
        <main className="flex-1 flex flex-col items-center justify-center gap-8 px-4 min-h-0 py-4">
          <VoiceOrb vaani={vaani} holdToTalk={holdToTalk} setHoldToTalk={setHoldToTalk} speaking={speaking} />

          {speaking && (
            <motion.button
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              onClick={vaani.interrupt}
              className="text-sm text-rose-300 hover:text-rose-200 underline underline-offset-4"
              aria-label="Stop speaking"
            >
              ▣ Stop speaking / interrupt
            </motion.button>
          )}
          {vaani.state === 'TOOL_RUNNING' && (
            <motion.button
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              onClick={vaani.interrupt}
              className="text-sm text-amber-300 hover:text-amber-200 underline underline-offset-4"
              aria-label="Interrupt tool"
            >
              ↺ Interrupt — request is still running
            </motion.button>
          )}

          <div className="w-full max-w-xl">
            <PortalNote vaani={vaani} />
          </div>
        </main>

        {/* transcript + cards */}
        <section className="max-h-[36vh] overflow-y-auto px-5 pb-4 space-y-3" aria-label="Conversation">
          <Transcript vaani={vaani} />
        </section>

        {/* demo mode row — real scripted turns */}
        <DemoControls vaani={vaani} />

        {/* text fallback input */}
        <footer className="px-5 pb-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendText(textDraft);
              setTextDraft('');
            }}
            className="flex gap-2 max-w-xl mx-auto"
          >
            <motion.input
              whileFocus={{ scale: 1.01 }}
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              placeholder="Or type… (voice is primary)"
              className="flex-1 rounded-xl bg-ink-800/80 border border-white/15 px-4 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              aria-label="Text input"
            />
            <motion.button
              type="submit"
              whileTap={{ scale: 0.96 }}
              whileHover={{ scale: 1.02 }}
              className="rounded-xl bg-brand-500 hover:bg-brand-600 px-4 text-sm font-semibold text-white"
            >
              Send
            </motion.button>
          </form>
        </footer>
      </div>

      <DevPanel open={devPanel} session={vaani.session} state={vaani.state} metrics={vaani.metrics} generation={vaani.session?.generation ?? 0} turnId={vaani.session?.turnId ?? 0} speechFallback={vaani.speechFallback} />
      </div>

      <CustomerCare vaani={vaani} />
    </div>
  );
}

/**
 * The mic at the centre of a calm, animated "voice orb".
 * Concentric rings breathe while listening/speaking; nothing jitters at rest.
 * (motion/react drives the rings so the surface stays smooth at idle.)
 */
function VoiceOrb({ vaani, holdToTalk, setHoldToTalk, speaking }: { vaani: ReturnTypeOfUseVaani; holdToTalk: boolean; setHoldToTalk: (b: boolean) => void; speaking: boolean }) {
  const active = vaani.listening;
  const ringColor = speaking ? RING_COLOR.speaking : RING_COLOR.active;

  return (
    <div className="relative w-56 h-56 grid place-items-center">
      <AnimatePresence>
        {(active || speaking) && (
          <>
            <motion.span
              key="ring-1"
              className="absolute inset-0 rounded-full"
              style={{ border: `2px solid ${ringColor}` }}
              initial={{ scale: 0.65, opacity: 0 }}
              animate={{ scale: 1.25, opacity: [0.7, 0] }}
              exit={{ opacity: 0, scale: 1.1 }}
              transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut', repeatDelay: 0.1 }}
              aria-hidden="true"
            />
            <motion.span
              key="ring-2"
              className="absolute inset-0 rounded-full"
              style={{ border: `2px solid ${ringColor}` }}
              initial={{ scale: 0.65, opacity: 0 }}
              animate={{ scale: 1.25, opacity: [0.45, 0] }}
              exit={{ opacity: 0, scale: 1.1 }}
              transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut', delay: 0.5, repeatDelay: 0.1 }}
              aria-hidden="true"
            />
          </>
        )}
      </AnimatePresence>

      <motion.button
        onPointerDown={() => {
          if (holdToTalk) vaani.startListening('hold');
        }}
        onPointerUp={() => {
          if (holdToTalk) vaani.stopListening();
        }}
        onClick={() => {
          if (!holdToTalk) {
            if (vaani.listening) vaani.stopListening();
            else vaani.startListening('continuous');
          }
        }}
        className={`relative z-10 w-28 h-28 rounded-full grid place-items-center transition-colors ${
          active ? 'bg-gradient-to-br from-emerald-400 to-blue-500' : 'bg-gradient-to-br from-brand-500 to-violet-500'
        } shadow-2xl shadow-blue-600/40`}
        animate={{ scale: active ? 1.06 : 1 }}
        whileTap={{ scale: 0.94 }}
        transition={{ type: 'spring', stiffness: 320, damping: 22 }}
        aria-label={holdToTalk ? 'Push to talk. Hold the button while speaking.' : 'Toggle continuous listening'}
        aria-pressed={active}
      >
        <motion.span animate={{ y: active ? -1 : 0 }} transition={{ duration: 0.2 }}>
          <MicIcon />
        </motion.span>
      </motion.button>

      <div className="absolute -bottom-10 inset-x-0 text-center space-y-1.5">
        <p className="text-[11px] text-white/45">{active ? 'Speak now…' : holdToTalk ? 'Hold to talk' : 'Tap to listen'}</p>
        <label className="inline-flex items-center gap-1.5 text-[11px] text-white/50 select-none">
          <input type="checkbox" checked={!holdToTalk} onChange={(e) => setHoldToTalk(!e.target.checked)} className="accent-blue-500" />
          Continuous listening
        </label>
      </div>
    </div>
  );
}

function PortalNote({ vaani }: { vaani: ReturnTypeOfUseVaani }) {
  if (vaani.confirmation) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="rounded-2xl border border-orange-400/30 bg-orange-400/10 p-4 space-y-3"
        role="alert"
      >
        <p className="text-sm font-semibold">{vaani.confirmation.summary}</p>
        <div className="flex gap-2">
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => vaani.answerConfirmation(true, vaani.confirmation!.confirmationId)}
            className="flex-1 rounded-xl bg-emerald-500 hover:bg-emerald-600 px-3 py-2 text-sm font-semibold text-white"
          >
            Yes, go ahead
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => vaani.answerConfirmation(false, vaani.confirmation!.confirmationId)}
            className="flex-1 rounded-xl bg-white/10 hover:bg-white/15 px-3 py-2 text-sm text-white/80"
          >
            No, cancel it
          </motion.button>
        </div>
        <p className="text-[11px] text-white/40">Or say “yes, go ahead” / “no, don’t cancel”</p>
      </motion.div>
    );
  }
  if (vaani.cards.length > 0) return <CardStack cards={vaani.cards} vaani={vaani} />;
  return (
    <motion.p
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.2, duration: 0.5 }}
      className="text-center text-white/30 text-sm"
    >
      Tap the mic and say <span className="text-white/60 font-medium">“where is my laptop?”</span> — then interrupt with{' '}
      <span className="text-white/60 font-medium">“wait, I mean my blue headphones.”</span>
    </motion.p>
  );
}

function CardStack({ cards, vaani }: { cards: ResolutionCard[]; vaani?: ReturnTypeOfUseVaani }) {
  return (
    <div className="space-y-2.5 w-full">
      <AnimatePresence mode="popLayout">
        {cards.map((c, i) => {
          const price = c.product?.priceInr != null ? `₹${c.product.priceInr.toLocaleString('en-IN')}` : null;
          const isShopping = c.kind === 'shopping' && c.product;
          return (
            <motion.div
              key={`${c.kind}-${c.title}-${i}`}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 300, damping: 26 }}
              className="rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-xl p-4 shadow-lg shadow-black/20"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wide text-white/40">{isShopping ? 'shopping · match' : c.kind}</span>
                <span className="text-[11px] font-mono text-emerald-300">{c.status}</span>
              </div>
              <p className="font-display font-bold mt-1 text-[15px]">{c.title}</p>
              {c.subtitle && <p className="text-sm text-white/60">{c.subtitle}</p>}

              {isShopping && c.product && (
                <>
                  <p className="text-sm text-white/70 mt-2">{c.product.description}</p>
                  <div className="flex items-end justify-between mt-3">
                    <div>
                      <p className="text-lg font-display font-extrabold text-emerald-300">
                        {price}
                        <span className="ml-1 text-[11px] font-normal text-white/40 line-through">MRP</span>
                      </p>
                      {c.product.rating > 0 && <p className="text-[11px] text-amber-300">★ {c.product.rating} rating</p>}
                    </div>
                    {c.product.inStock && (
                      <button
                        onClick={() => {
                          if (vaani) {
                            pushAsk(vaani, `Tell me more about the ${c.product!.name}.`);
                          }
                        }}
                        className="rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-blue-500/25 hover:brightness-110 active:scale-95 transition"
                        aria-label={`View details of ${c.product.name}`}
                      >
                        {c.action?.label ?? 'View details'}
                      </button>
                    )}
                  </div>
                  {c.product.inStock && (
                    <p className="mt-1.5 text-[11px] text-emerald-400/80">✓ In stock — ready to ship</p>
                  )}
                </>
              )}

              {!isShopping && c.details && (
                <dl className="grid grid-cols-2 gap-1 mt-2 text-xs">
                  {Object.entries(c.details).map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <dt className="text-white/40">{k}</dt>
                      <dd className="font-mono text-white/85">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/** Typed shortcut: send a follow-up question about the product. */
function pushAsk(vaani: ReturnTypeOfUseVaani, text: string): void {
  vaani.sendTextTurn(text);
}

function Transcript({ vaani }: { vaani: ReturnTypeOfUseVaani }) {
  return (
    <>
      {vaani.transcripts.map((t) => (
        <motion.div
          key={t.id}
          layout
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${
              t.role === 'user'
                ? 'bg-brand-600/30 border border-blue-400/20 text-white/95'
                : t.role === 'system'
                  ? 'bg-white/5 text-white/50 text-xs'
                  : t.role === 'tool'
                    ? 'bg-blue-400/10 text-blue-200/80 text-xs font-mono'
                    : 'bg-white/10 text-white/90'
            }`}
          >
            {t.text}
            <span className="block text-[10px] text-white/30 mt-0.5">g{t.generation}</span>
          </div>
        </motion.div>
      ))}
    </>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-10 h-10 text-white" fill="currentColor" aria-hidden="true">
      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" />
      <path d="M17.3 11a5.3 5.3 0 0 1-10.6 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-1.7Z" />
    </svg>
  );
}