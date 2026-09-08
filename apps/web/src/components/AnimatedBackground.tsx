/**
 * Ambient background — layered depth: base gradient → glow orbs → a lazy 3D
 * scene → a soft particle field. The 3D bundle (three/fiber/drei) is loaded
 * on demand so first paint is never blocked; it fades in over the gradient.
 * Respects prefers-reduced-motion (motion stops; static gradient + 3D remain).
 * The whole layer is pointer-events-none so text stays readable and clickable.
 */

import { lazy, Suspense } from 'react';
import { motion, useReducedMotion } from 'motion/react';

// Code-split the heavy 3D stack into its own chunk; renders nothing if WebGL
// is unavailable (Background3D returns null).
const Background3D = lazy(() => import('./Background3D').then((m) => ({ default: m.Background3D })));

export function AnimatedBackground() {
  const reduced = useReducedMotion();

  const orbs = [
    { className: 'w-[34rem] h-[34rem] bg-blue-600/20', x: '-10%', y: '12%', dur: 26, delay: 0 },
    { className: 'w-[28rem] h-[28rem] bg-violet-600/16', x: '62%', y: '-8%', dur: 32, delay: 2 },
    { className: 'w-[24rem] h-[24rem] bg-emerald-500/10', x: '42%', y: '60%', dur: 28, delay: 4 },
  ];

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      {/* base static gradient (always present) */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(1200px 600px at 82% -10%, rgba(37,99,255,0.22), transparent 60%), radial-gradient(900px 500px at 8% 110%, rgba(124,58,237,0.18), transparent 60%), radial-gradient(700px 500px at 50% 30%, rgba(16,185,129,0.08), transparent 60%)',
        }}
      />

      {/* drifting glow orbs — colour wash behind the 3D shapes */}
      {orbs.map((o, i) => (
        <motion.div
          key={i}
          className={`absolute rounded-full blur-3xl ${o.className}`}
          style={{ width: o.className.includes('34rem') ? '34rem' : o.className.includes('28rem') ? '28rem' : '24rem', height: 'auto', aspectRatio: '1', left: o.x, top: o.y }}
          animate={reduced ? undefined : { y: [0, -40, 20, 0], x: [0, 30, -20, 0] }}
          transition={{ duration: o.dur, repeat: Infinity, ease: 'easeInOut', delay: o.delay }}
        />
      ))}

      {/* crisp 3D objects on top of the wash */}
      <Suspense fallback={null}>
        <Background3D />
      </Suspense>

      {/* soft particle field */}
      <div className="absolute inset-0">
        {Array.from({ length: 18 }).map((_, i) => {
          const size = 2 + (i % 3);
          const left = `${(i * 53) % 100}%`;
          const top = `${(i * 37 + 13) % 100}%`;
          return (
            <motion.span
              key={i}
              className="absolute rounded-full bg-white/20"
              style={{ width: size, height: size, left, top }}
              animate={reduced ? undefined : { y: [0, -26, 0], opacity: [0.15, 0.5, 0.15] }}
              transition={{ duration: 9 + (i % 5) * 2, repeat: Infinity, ease: 'easeInOut', delay: i * 0.7 }}
            />
          );
        })}
      </div>
    </div>
  );
}