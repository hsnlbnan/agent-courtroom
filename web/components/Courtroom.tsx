'use client';
// The scale-model courtroom. Pure presentation: it renders a Frame.
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, QuadraticBezierLine, RoundedBox, SpotLight } from '@react-three/drei';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { type Frame, type Member, type Place, accentOf, placeOf, VOTE_TINT } from '@/lib/council';
import { oklchToHex } from '@/lib/color';

// An architect's maquette: two matte tones (clay, clayDeep), one warm wood for rails and table tops,
// and the board the model stands on (base). No gloss, no glow.
export interface Palette { clay: string; clayDeep: string; wood: string; base: string; bg: string; arc: string; dark: boolean }

const BENCH_Z = -3.4;

// World positions per place; members of the same place spread along a line.
function layout(members: Member[]) {
  const byPlace = new Map<Place, Member[]>();
  for (const m of members) {
    const p = placeOf(m.role);
    byPlace.set(p, [...(byPlace.get(p) ?? []), m]);
  }
  const pos = new Map<string, [number, number, number]>();
  for (const [place, list] of byPlace) {
    list.forEach((m, i) => {
      if (place === 'bench') pos.set(m.role, [0, 0.95, BENCH_Z - 0.55]);
      else if (place === 'pros') pos.set(m.role, [-2.1 + i * 0.7, 0, 2.15]);
      else if (place === 'def') pos.set(m.role, [2.1 - i * 0.7, 0, 2.15]);
      else if (place === 'witness') pos.set(m.role, i === 0 ? [3.15, 0.42, -1.25] : [3.95, 0, -0.1 + (i - 1) * 0.75]);
      else pos.set(m.role, [-3.75, 0.28, -2.1 + i * 0.9]);
    });
  }
  return pos;
}

type Mats = { clay: THREE.Material; deep: THREE.Material; wood: THREE.Material; base: THREE.Material };

function useMats(palette: Palette): Mats {
  return useMemo(() => {
    const m = (color: string, roughness = 0.82) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
    return { clay: m(palette.clay), deep: m(palette.clayDeep), wood: m(palette.wood, 0.7), base: m(palette.base, 0.9) };
  }, [palette.clay, palette.clayDeep, palette.wood, palette.base]);
}

type V3 = [number, number, number];

/** A softened block. Shared materials keep shader compiles to four for the whole room. */
function Block({ size, at, mat, r = 0.03 }: { size: V3; at: V3; mat: THREE.Material; r?: number }) {
  return <RoundedBox args={size} radius={r} smoothness={2} position={at} material={mat} castShadow receiveShadow />;
}

/** Thin square posts (rail balusters, table legs) as one instanced mesh. */
function Posts({ at, size, mat }: { at: V3[]; size: V3; mat: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const o = new THREE.Object3D();
    at.forEach((p, i) => { o.position.set(...p); o.updateMatrix(); ref.current?.setMatrixAt(i, o.matrix); });
    if (ref.current) ref.current.instanceMatrix.needsUpdate = true;
  }, [at]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, at.length]} material={mat} castShadow receiveShadow>
      <boxGeometry args={size} />
    </instancedMesh>
  );
}

/** A rail: posts every `step` along x (or z) between a and b, with a wood cap on top. */
function railPosts(a: V3, b: V3, step: number, h: number): V3[] {
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const n = Math.max(2, Math.round(len / step) + 1);
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return [a[0] + (b[0] - a[0]) * t, h / 2, a[2] + (b[2] - a[2]) * t] as V3;
  });
}

const PLINTH = { w: 11.4, d: 9.6, h: 0.36, z: -0.95 };
const BAR_Z = 3.05;

function Room({ mats, jurySeats }: { mats: Mats; jurySeats: number }) {
  const { clay, deep, wood, base } = mats;
  const seats = Math.max(jurySeats, 2);
  const juryLen = seats * 0.9 + 0.3;
  const juryMidZ = -2.1 + (seats - 1) * 0.45;
  const legs = useMemo(() => [-1, 1].flatMap((side) => [-0.95, 0.95].flatMap((dx) => [1.3, 1.8].map((z) => [side * 2.1 + dx, 0.28, z] as V3))), []);
  // The bar: a low balustrade across the room with a gate in the middle.
  const bar = useMemo(() => [...railPosts([-5.1, 0, BAR_Z], [-0.75, 0, BAR_Z], 0.36, 0.5), ...railPosts([0.75, 0, BAR_Z], [5.1, 0, BAR_Z], 0.36, 0.5)], []);
  const juryRail = useMemo(() => railPosts([-3.2, 0, -2.4], [-3.2, 0, -2.4 + juryLen - 0.3], 0.3, 0.62), [juryLen]);
  return (
    <group>
      {/* The board the model stands on. */}
      <Block size={[PLINTH.w, PLINTH.h, PLINTH.d]} at={[0, -PLINTH.h / 2, PLINTH.z]} mat={base} r={0.06} />
      {/* The well: a slightly raised floor between the bar and the bench. */}
      <Block size={[9.6, 0.03, 6.7]} at={[0, 0.015, -1.6]} mat={deep} r={0.01} />

      {/* Back wall with recessed panels and the emblem over the judge. */}
      <Block size={[10.6, 2.7, 0.24]} at={[0, 1.35, -5.35]} mat={clay} />
      {[-4.0, -2.4, 2.4, 4.0].map((x) => <Block key={x} size={[1.3, 1.7, 0.04]} at={[x, 1.25, -5.21]} mat={deep} r={0.01} />)}
      <mesh position={[0, 2.08, -5.2]} rotation-x={Math.PI / 2} material={wood} castShadow>
        <cylinderGeometry args={[0.46, 0.46, 0.05, 48]} />
      </mesh>
      <mesh position={[0, 2.08, -5.17]} rotation-x={Math.PI / 2} material={clay}>
        <cylinderGeometry args={[0.32, 0.32, 0.03, 48]} />
      </mesh>
      {/* Side walls, low, so the room reads as a room from the camera. */}
      <Block size={[0.2, 1.3, 4.2]} at={[-5.2, 0.65, -3.35]} mat={clay} />
      <Block size={[0.2, 1.3, 4.2]} at={[5.2, 0.65, -3.35]} mat={clay} />

      {/* Bench: two-step dais, a panelled front and a wood top. */}
      <Block size={[5.0, 0.22, 2.3]} at={[0, 0.11, BENCH_Z - 0.3]} mat={deep} />
      <Block size={[4.3, 0.2, 1.7]} at={[0, 0.32, BENCH_Z - 0.45]} mat={deep} />
      <Block size={[3.6, 1.15, 0.7]} at={[0, 0.875, BENCH_Z]} mat={clay} />
      {[-1.15, 0, 1.15].map((x) => <Block key={x} size={[0.95, 0.72, 0.03]} at={[x, 0.82, BENCH_Z + 0.36]} mat={deep} r={0.01} />)}
      <Block size={[3.8, 0.07, 0.86]} at={[0, 1.48, BENCH_Z]} mat={wood} r={0.02} />

      {/* Counsel tables: wood tops on legs. */}
      <Block size={[2.15, 0.07, 0.72]} at={[-2.1, 0.6, 1.55]} mat={wood} r={0.02} />
      <Block size={[2.15, 0.07, 0.72]} at={[2.1, 0.6, 1.55]} mat={wood} r={0.02} />
      <Posts at={legs} size={[0.06, 0.56, 0.06]} mat={deep} />

      {/* Witness stand: a raised box with panels on three sides and a rail cap. */}
      <Block size={[1.1, 0.42, 1.1]} at={[3.15, 0.21, -1.25]} mat={deep} />
      <Block size={[1.14, 0.62, 0.08]} at={[3.15, 0.73, -0.7]} mat={clay} />
      <Block size={[0.08, 0.62, 1.1]} at={[2.6, 0.73, -1.25]} mat={clay} />
      <Block size={[1.22, 0.05, 0.14]} at={[3.15, 1.06, -0.7]} mat={wood} r={0.015} />

      {/* Jury box: a stepped platform behind a balustrade. */}
      <Block size={[1.0, 0.28, juryLen]} at={[-3.8, 0.14, juryMidZ]} mat={deep} />
      <Block size={[0.5, 0.16, juryLen]} at={[-4.35, 0.36, juryMidZ]} mat={deep} />
      <Posts at={juryRail} size={[0.05, 0.62, 0.05]} mat={clay} />
      <Block size={[0.12, 0.05, juryLen]} at={[-3.2, 0.64, juryMidZ]} mat={wood} r={0.015} />

      {/* The bar: where the public would stand, kept empty in the model. */}
      <Posts at={bar} size={[0.05, 0.5, 0.05]} mat={clay} />
      <Block size={[4.45, 0.05, 0.11]} at={[-2.93, 0.52, BAR_Z]} mat={wood} r={0.015} />
      <Block size={[4.45, 0.05, 0.11]} at={[2.93, 0.52, BAR_Z]} mat={wood} r={0.015} />
    </group>
  );
}

// A figurine: a tapered body with rounded shoulders and a neck, turned on a lathe.
const FIGURE_BODY = new THREE.LatheGeometry([
  [0, 0.04], [0.2, 0.04], [0.19, 0.2], [0.17, 0.46], [0.18, 0.6], [0.165, 0.66], [0.12, 0.7], [0.06, 0.72], [0.055, 0.76], [0, 0.77],
].map(([x, y]) => new THREE.Vector2(x, y)), 40);

function Figure({ m, at, palette, stand, speaking, target, tint, dim }: {
  m: Member; at: [number, number, number]; palette: Palette; stand: THREE.Material; speaking: boolean; target: boolean; tint?: string; dim: boolean;
}) {
  const ref = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const accent = useMemo(() => new THREE.Color(oklchToHex(accentOf(m.role))), [m.role]);
  const base = useMemo(() => new THREE.Color(tint ? oklchToHex(tint) : palette.clay), [tint, palette.clay]);
  const scale = m.chair ? 1.15 : 1;
  useFrame((_, dt) => {
    const k = 1 - Math.exp(-dt * 6);
    // New figures grow into their seat.
    if (ref.current) ref.current.scale.setScalar(THREE.MathUtils.lerp(ref.current.scale.x, scale, k));
    if (ref.current) ref.current.position.y = THREE.MathUtils.lerp(ref.current.position.y, at[1] + (speaking ? 0.12 : 0), k);
    if (mat.current) {
      mat.current.color.lerp(speaking ? accent : base, k);
      mat.current.emissive.lerp(speaking ? accent : new THREE.Color(0, 0, 0), k);
      mat.current.emissiveIntensity = THREE.MathUtils.lerp(mat.current.emissiveIntensity, speaking ? 0.18 : target ? 0.05 : 0, k);
      mat.current.opacity = THREE.MathUtils.lerp(mat.current.opacity, dim ? 0.68 : 1, k);
    }
  });
  // One material for body and head, so speaking, dimming and verdict tint move them together.
  const body = useMemo(() => new THREE.MeshStandardMaterial({ color: palette.clay, roughness: 0.8, metalness: 0, transparent: true, opacity: 1 }), [palette.clay]);
  useLayoutEffect(() => { mat.current = body; }, [body]);
  return (
    <group ref={ref} position={at} scale={0.35}>
      <mesh castShadow receiveShadow position={[0, 0.02, 0]} material={stand}>
        <cylinderGeometry args={[0.27, 0.29, 0.04, 40]} />
      </mesh>
      <mesh castShadow geometry={FIGURE_BODY} material={body} />
      <mesh castShadow position={[0, 0.86, 0]} material={body}>
        <sphereGeometry args={[0.125, 32, 20]} />
      </mesh>
    </group>
  );
}

const CENTRE = new THREE.Vector3(-0.35, 0.35, -1.0);
const HOME = new THREE.Vector3(2.7, 8.7, 12.4);

function cameraTargets(focus: [number, number, number] | null, t: number, still: boolean) {
  const f = focus ? new THREE.Vector3(...focus) : CENTRE.clone();
  const offset = f.clone().sub(CENTRE);
  // Lean toward the speaker: a dolly in plus a slow idle drift so the room breathes.
  const drift = still ? new THREE.Vector3() : new THREE.Vector3(Math.sin(t * 0.13) * 0.55, Math.sin(t * 0.09) * 0.2, 0);
  const pos = HOME.clone().add(offset.clone().multiplyScalar(0.38)).add(drift);
  if (focus) pos.lerp(f.clone().add(new THREE.Vector3(1.6, 4.6, 6.8)), 0.24);
  const look = CENTRE.clone().lerp(f, focus ? 0.42 : 0);
  return { pos, look };
}

// Narrow or tall viewports pull the camera back so the whole room stays in frame.
const pullBack = (aspect: number) => Math.min(2.5, Math.max(1, 1.8 / aspect));
function fit(pos: THREE.Vector3, look: THREE.Vector3, aspect: number) {
  return look.clone().add(pos.clone().sub(look).multiplyScalar(pullBack(aspect)));
}

// Fog follows the camera distance, so pulling back never hides the room.
function FitFog({ color }: { color: string }) {
  const { size } = useThree();
  const m = pullBack(size.width / Math.max(1, size.height));
  return <fog attach="fog" args={[color, 14 * m, 27 * m]} />;
}

function CameraRig({ focus, still }: { focus: [number, number, number] | null; still: boolean }) {
  const { camera, size } = useThree();
  const aspect = size.width / Math.max(1, size.height);
  const look = useRef(CENTRE.clone());
  // Snap on mount (and on every change when motion is reduced) so the first frame is composed.
  useLayoutEffect(() => {
    if (!still && look.current !== null && camera.userData.placed) return;
    const { pos, look: l } = cameraTargets(focus, 0, true);
    camera.position.copy(fit(pos, l, aspect));
    look.current.copy(l);
    camera.lookAt(l);
    camera.userData.placed = true;
  }, [focus, still, camera, aspect]);
  useFrame(({ clock }, dt) => {
    if (still) return;
    const k = 1 - Math.exp(-dt * 1.3);
    const { pos, look: l } = cameraTargets(focus, clock.elapsedTime, false);
    camera.position.lerp(fit(pos, l, aspect), k);
    look.current.lerp(l, k);
    camera.lookAt(look.current);
  });
  return null;
}

function Beam({ at, color, intensity, power }: { at: [number, number, number]; color: string; intensity: number; power: number }) {
  const target = useMemo(() => new THREE.Object3D(), []);
  useLayoutEffect(() => { target.position.set(at[0], at[1], at[2]); target.updateMatrixWorld(); }, [at, target]);
  return (
    <>
      <primitive object={target} />
      <SpotLight castShadow target={target} position={[at[0] + 0.4, 7.2, at[2] + 1.4]} angle={0.24} penumbra={0.4}
        distance={11} attenuation={8} anglePower={power} intensity={intensity} color={color} opacity={0.8}
        volumetric radiusTop={0.12} radiusBottom={1.6} />
    </>
  );
}

function Arc({ from, to, color }: { from: [number, number, number]; to: [number, number, number]; color: string }) {
  const a = new THREE.Vector3(from[0], from[1] + 1.2, from[2]);
  const b = new THREE.Vector3(to[0], to[1] + 1.2, to[2]);
  const mid = a.clone().lerp(b, 0.5);
  mid.y += 1.1 + a.distanceTo(b) * 0.12;
  return <QuadraticBezierLine start={a} end={b} mid={mid} color={color} lineWidth={2.2} />;
}

/** Calls `onReady` once, after the first frame is drawn (shader compile can take seconds). */
function FirstFrame({ onReady }: { onReady?: () => void }) {
  const done = useRef(false);
  useFrame(() => { if (!done.current) { done.current = true; onReady?.(); } });
  return null;
}

export default function Courtroom({ frame, palette, still = false, onReady }: { frame: Frame; palette: Palette; still?: boolean; onReady?: () => void }) {
  const pos = useMemo(() => layout(frame.members), [frame.members]);
  const juryCount = frame.members.filter((m) => placeOf(m.role) === 'jury').length;
  const speakerAt = frame.speaker ? pos.get(frame.speaker) ?? null : null;
  const verdict = !!frame.verdict;
  const houseUp = verdict || !!frame.lit;
  const linkFrom = frame.link && pos.get(frame.link.from);
  const linkTo = frame.link && pos.get(frame.link.to);
  const mats = useMats(palette);
  // The room is lit by a soft studio environment (generated, no files); it rises with the house lights.
  const ambient = houseUp ? 1 : frame.writing?.length ? 0.55 : frame.speaker ? (palette.dark ? 0.32 : 0.45) : 0.55;
  return (
    <Canvas shadows="soft" dpr={[1, 2]} camera={{ fov: 30, position: [2.7, 8.7, 12.4] }} gl={{ antialias: true }} aria-hidden="true">
      <color attach="background" args={[palette.bg]} />
      <FirstFrame onReady={onReady} />
      <FitFog color={palette.bg} />
      {/* House lights: low until the verdict. */}
      <Environment resolution={64} frames={1} environmentIntensity={ambient}>
        <Lightformer form="rect" intensity={2.2} position={[0, 6, 2]} rotation-x={Math.PI / 2} scale={[10, 8, 1]} />
        <Lightformer form="rect" intensity={0.8} position={[-7, 3, 2]} rotation-y={Math.PI / 2} scale={[8, 3, 1]} />
        <Lightformer form="rect" intensity={0.5} position={[6, 2, 6]} rotation-y={-Math.PI / 3} scale={[6, 2, 1]} />
      </Environment>
      <directionalLight castShadow position={[4, 9, 6]} intensity={houseUp ? 1.6 : palette.dark ? 0.22 : 0.3} shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004} shadow-normalBias={0.02}
        shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={7} shadow-camera-bottom={-7} />
      {speakerAt && !verdict && (
        <Beam at={speakerAt} color={palette.dark ? '#ffe9cf' : '#fff3df'} intensity={palette.dark ? 300 : 240} power={5} />
      )}
      {frame.link && linkTo && !verdict && (
        <Beam at={linkTo} color={oklchToHex('oklch(0.68 0.17 30)')} intensity={palette.dark ? 90 : 70} power={6} />
      )}
      {verdict && <pointLight position={[0, 3.2, BENCH_Z + 1.2]} intensity={14} distance={6} color="#fff1d6" />}
      {/* Desk lamps: while members write in parallel, each one still writing is lit. */}
      {!verdict && (frame.writing ?? []).map((r) => {
        const at = pos.get(r);
        return at ? <pointLight key={r} position={[at[0], at[1] + 1.6, at[2] + 0.6]} intensity={palette.dark ? 14 : 9} distance={4} color="#ffd9a8" /> : null;
      })}
      <CameraRig focus={linkFrom && linkTo
        ? [(linkFrom[0] + linkTo[0]) / 2, (linkFrom[1] + linkTo[1]) / 2, (linkFrom[2] + linkTo[2]) / 2]
        : speakerAt} still={still} />

      {/* The table the model stands on, in the page colour. */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -PLINTH.h, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color={palette.bg} roughness={1} />
      </mesh>
      <ContactShadows position={[0, 0.032, -0.6]} scale={[10, 8]} blur={2.2} far={2.5} opacity={palette.dark ? 0.7 : 0.45} />

      <Room mats={mats} jurySeats={juryCount} />
      {frame.members.map((m) => {
        const at = pos.get(m.role);
        if (!at) return null;
        const v = frame.votes[m.role]?.vote;
        return (
          <Figure key={m.role} m={m} at={at} palette={palette} stand={mats.deep}
            speaking={frame.speaker === m.role} target={frame.link?.to === m.role}
            tint={verdict ? (m.chair ? VOTE_TINT[frame.verdict?.verdict ?? ''] : v ? VOTE_TINT[v] : undefined) : undefined}
            dim={!verdict && !!frame.speaker && frame.speaker !== m.role && frame.link?.to !== m.role} />
        );
      })}
      {linkFrom && linkTo && <Arc from={linkFrom} to={linkTo} color={palette.arc} />}
    </Canvas>
  );
}
