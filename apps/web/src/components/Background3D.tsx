/**
 * Background3D — a calm, studio-lit 3D scene floating behind the UI.
 *
 * No postprocessing, no downloaded HDR environment (works offline): just a few
 * low-poly shapes (distorted chromatic sphere, wireframe icosahedron, torus
 * knot, small companions) lit by ambient + colored point lights and soft fog.
 * Slow rotation comes from a useFrame on the group; drei <Float> adds the
 * idle bobbing. Everything respects prefers-reduced-motion (static frame).
 */

import { Suspense, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, MeshDistortMaterial } from '@react-three/drei';
import type { Group } from 'three';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function webglAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function FloatingShapes({ reduced }: { reduced: boolean }) {
  const group = useRef<Group>(null);
  useFrame((state, delta) => {
    if (reduced || !group.current) return;
    group.current.rotation.y += delta * 0.08;
    group.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.25) * 0.05;
  });

  return (
    <group ref={group}>
      {/* distorted chromatic sphere — the hero piece */}
      <Float speed={reduced ? 0 : 1.4} rotationIntensity={reduced ? 0 : 0.4} floatIntensity={reduced ? 0 : 1.1} floatingRange={[-0.4, 0.6]}>
        <mesh position={[-3.2, 1.2, -1]}>
          <sphereGeometry args={[1.5, 64, 64]} />
          <MeshDistortMaterial color="#6d8bff" distort={0.34} speed={reduced ? 0 : 1.8} roughness={0.25} metalness={0.7} />
        </mesh>
      </Float>

      {/* wireframe icosahedron */}
      <Float speed={reduced ? 0 : 1.1} rotationIntensity={reduced ? 0 : 0.5} floatIntensity={reduced ? 0 : 0.7} floatingRange={[-0.5, 0.5]}>
        <mesh position={[3.1, -1.2, -2]}>
          <icosahedronGeometry args={[1.35, 1]} />
          <meshStandardMaterial wireframe color="#8fd6ff" transparent opacity={0.55} />
        </mesh>
      </Float>

      {/* glossy torus knot */}
      <Float speed={reduced ? 0 : 1.3} rotationIntensity={reduced ? 0 : 0.6} floatIntensity={reduced ? 0 : 0.9} floatingRange={[-0.4, 0.5]}>
        <mesh position={[2.5, 1.9, -3]}>
          <torusKnotGeometry args={[0.85, 0.28, 160, 20]} />
          <meshStandardMaterial color="#b794f6" metalness={0.55} roughness={0.24} emissive="#241242" emissiveIntensity={0.5} />
        </mesh>
      </Float>

      {/* small emerald companion sphere */}
      <Float speed={reduced ? 0 : 1.5} rotationIntensity={0} floatIntensity={reduced ? 0 : 0.6} floatingRange={[-0.3, 0.4]}>
        <mesh position={[-1.7, -1.9, -1.5]}>
          <sphereGeometry args={[0.34, 32, 32]} />
          <meshStandardMaterial color="#5eead4" transparent opacity={0.7} />
        </mesh>
      </Float>

      {/* small magenta octahedron */}
      <Float speed={reduced ? 0 : 1.2} rotationIntensity={reduced ? 0 : 0.5} floatIntensity={reduced ? 0 : 0.7} floatingRange={[-0.3, 0.5]}>
        <mesh position={[0.7, 2.3, -4]}>
          <octahedronGeometry args={[0.5, 0]} />
          <meshStandardMaterial color="#f0abfc" metalness={0.4} roughness={0.3} />
        </mesh>
      </Float>
    </group>
  );
}

export function Background3D() {
  const [reduced] = useState(prefersReducedMotion);
  const [hasWebgl] = useState(webglAvailable);
  if (!hasWebgl) return null; // fall back to the static gradient — never a blank box

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [0, 0, 9], fov: 45 }}
        gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
        style={{ background: 'transparent' }}
      >
        <fog attach="fog" args={['#0a0e1e', 7, 17]} />
        {/* studio lighting: soft fill + three tinted accents */}
        <ambientLight intensity={0.55} />
        <directionalLight position={[4, 6, 4]} intensity={1.15} color="#e0e7ff" />
        <pointLight position={[-6, -2, 2]} intensity={34} color="#3b82f6" />
        <pointLight position={[6, 3, -2]} intensity={26} color="#a78bfa" />
        <pointLight position={[0, -4, 4]} intensity={16} color="#34d399" />
        <Suspense fallback={null}>
          <FloatingShapes reduced={reduced} />
        </Suspense>
      </Canvas>
    </div>
  );
}