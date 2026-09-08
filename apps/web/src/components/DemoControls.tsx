import { useState } from 'react';
import type { ReturnTypeOfUseVaani } from '../App';

const DEMOS: { key: string; label: string; script: string[] }[] = [
  {
    key: 'normal',
    label: 'Normal flow',
    script: ['Where are my headphones?', 'When will it arrive?', 'What is the refund policy?'],
  },
  {
    key: 'interrupt',
    label: 'Interrupt test',
    script: ['Show me my orders.', 'Where is my laptop?', 'Wait, I mean my blue headphones.'],
  },
  {
    key: 'stale',
    label: 'Stale result test',
    script: ['Where is my laptop?', 'Wait, I mean my blue headphones.'],
  },
  {
    key: 'confirmation',
    label: 'Confirm / changed mind',
    script: ['Cancel my headphones.', "Actually don't cancel them."],
  },
  {
    key: 'refund',
    label: 'Return + refund',
    script: ['Want to return my delivered iPhone.', 'Refund status?'],
  },
  {
    key: 'shopping',
    label: 'Voice shopping',
    script: ['Find a laptop under 70000.', 'Show me headphones under 3000.', 'Suggest a laptop for coding.'],
  },
  {
    key: 'products',
    label: 'Show me phones',
    script: ['Show me phones.', 'How much is the iPhone 15?'],
  },
  {
    key: 'orders',
    label: 'My orders',
    script: ['Show me my orders.', 'Which one arrives tomorrow?', "When does my Samsung arrive?"],
  },
  {
    key: 'deliverydays',
    label: 'Delivery days',
    script: ['When will my headphones arrive?', 'And the MacBook?', 'What about the Samsung?'],
  },
  {
    key: 'mobiles',
    label: 'Show me mobiles',
    script: ['Show me mobiles under 25000.', 'How much is the Nothing phone?'],
  },
  {
    key: 'headphones',
    label: 'Headphones',
    script: ['Suggest headphones under 5000.', 'Is the JBL in stock?'],
  },
  {
    key: 'warranty',
    label: 'Warranty',
    script: ["What's the warranty on my MacBook?", 'Is my Kindle covered?'],
  },
];

export function DemoControls({ vaani }: { vaani: ReturnTypeOfUseVaani }) {
  const [running, setRunning] = useState<string | null>(null);

  const run = async (key: string, script: string[]) => {
    if (running) return;
    setRunning(key);
    for (const line of script) {
      vaani.sendTextTurn(line);
      await new Promise((r) => setTimeout(r, 4200));
    }
    setRunning(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-5 py-2 bg-white/[0.02]">
      <span className="text-[11px] uppercase tracking-wider text-white/40">DEMO MODE · triggers real turns</span>
      {DEMOS.map((d) => (
        <button
          key={d.key}
          disabled={running !== null}
          onClick={() => void run(d.key, d.script)}
          className={`text-[11px] px-2.5 py-1 rounded-md border text-white/80 transition ${
            running === d.key ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-200 animate-pulse' : 'border-white/15 hover:bg-white/10'
          }`}
        >
          {running === d.key ? 'Running…' : d.label}
        </button>
      ))}
    </div>
  );
}