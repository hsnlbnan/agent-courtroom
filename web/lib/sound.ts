'use client';
// Courtroom cues synthesized with WebAudio at play time: no audio files.
// Off by default; the choice is remembered per browser. Nothing plays while the
// tab is hidden, and bursts (instant replays) are rate-limited to one cue at a time.
import { useCallback, useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './motion';

const KEY = 'council-sound';
let ctx: AudioContext | null = null;
let lastAt = 0;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function envelope(a: BaseAudioContext, at: number, peak: number, attack: number, release: number) {
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + release);
  return g;
}

// A wooden knock: a short low thump plus a filtered noise click.
function knock(a: BaseAudioContext, out: AudioNode, at: number, level = 1) {
  const thump = a.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(190, at);
  thump.frequency.exponentialRampToValueAtTime(70, at + 0.12);
  const tg = envelope(a, at, 0.9 * level, 0.004, 0.16);
  thump.connect(tg).connect(out);
  thump.start(at);
  thump.stop(at + 0.2);

  const len = Math.floor(a.sampleRate * 0.05);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const noise = a.createBufferSource();
  noise.buffer = buf;
  const lp = a.createBiquadFilter();
  lp.type = 'bandpass';
  lp.frequency.value = 1800;
  lp.Q.value = 0.9;
  const ng = envelope(a, at, 0.5 * level, 0.002, 0.05);
  noise.connect(lp).connect(ng).connect(out);
  noise.start(at);
}

function tone(a: BaseAudioContext, out: AudioNode, at: number, freq: number, dur: number, peak: number, type: OscillatorType = 'sine') {
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  const g = envelope(a, at, peak, 0.01, dur);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + dur + 0.05);
}

export type Cue = 'gavel' | 'objection' | 'tick' | 'verdict';

// With reduced motion asked for, the repetitive cues (tick, gavel) stay silent; the
// meaningful ones (objection, verdict) still play once the person has turned sound on.
const calm = prefersReducedMotion;

export function play(cue: Cue, mood: Mood = 'conditional', force = false) {
  if (typeof document !== 'undefined' && document.hidden) return;
  if (!force && calm() && (cue === 'tick' || cue === 'gavel')) return;
  const a = audio();
  if (!a) return;
  const nowMs = performance.now();
  if (cue !== 'verdict' && nowMs - lastAt < 250) return; // no machine-gun cues in fast replays
  lastAt = nowMs;
  schedule(a, cue, mood, a.currentTime + 0.01);
}

export type Mood = 'go' | 'no-go' | 'conditional';

/** The chair's verdict as a mood; anything unexpected sounds as conditional. */
export const moodOf = (verdict: string): Mood => (verdict === 'go' || verdict === 'no-go' ? verdict : 'conditional');

function schedule(a: BaseAudioContext, cue: Cue, mood: Mood, t: number) {
  const master = a.createGain();
  master.gain.value = 0.22;
  master.connect(a.destination);
  // Levels measured with web/scripts/sounds.mjs: gavel and verdict peak near -15 dBFS, the
  // objection matches them, the tick (the most frequent cue) sits about 9 dB below.
  if (cue === 'tick') tone(a, master, t, 1760, 0.03, 0.3, 'triangle');
  if (cue === 'gavel') { knock(a, master, t); knock(a, master, t + 0.17, 0.8); }
  if (cue === 'objection') { tone(a, master, t, 523, 0.09, 0.8, 'triangle'); tone(a, master, t + 0.1, 784, 0.16, 0.8, 'triangle'); }
  if (cue === 'verdict') {
    knock(a, master, t); knock(a, master, t + 0.17, 0.85); knock(a, master, t + 0.34, 0.7);
    // Major for go, minor for no-go, a suspended chord for conditional.
    const chord = mood === 'go' ? [261.6, 329.6, 392] : mood === 'no-go' ? [261.6, 311.1, 392] : [261.6, 349.2, 392];
    for (const f of chord) tone(a, master, t + 0.5, f, 1.4, 0.16);
  }
}

/** The same cue rendered offline (no speakers), for listening to and measuring it as a file. */
export function render(cue: Cue, mood: Mood = 'conditional', rate = 48_000) {
  const a = new OfflineAudioContext(1, Math.ceil(rate * 2.2), rate);
  schedule(a, cue, mood, 0.01);
  return a.startRendering();
}

/** The sound toggle: off until the person turns it on. */
export function useSoundSetting() {
  const [on, setOn] = useState(false);
  useEffect(() => { try { setOn(localStorage.getItem(KEY) === 'on'); } catch {} }, []);
  const toggle = useCallback(() => {
    const next = !on;
    setOn(next);
    try { localStorage.setItem(KEY, next ? 'on' : 'off'); } catch {}
    if (next) play('tick', 'conditional', true); // also unlocks audio inside this click
  }, [on]);
  return { on, toggle };
}

interface Watch { live: { n: number } | null; speaker: string | null; lastStance: string | null; lastN: number; verdict: string | null; entries: number }

/** Plays cues as a hearing moves: gavel when the floor is given, a cue on an objection,
 * a tick when a statement lands, and a sting on the verdict. Silent on instant replays. */
export function useHearingSounds(on: boolean, w: Watch, quiet: boolean) {
  const prev = useRef<Watch | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = w;
    if (!on || quiet || !p) return;
    if (w.verdict && !p.verdict) { play('verdict', moodOf(w.verdict)); return; }
    if (w.lastN > p.lastN && w.lastStance === 'challenge') { play('objection'); return; }
    if (w.live && w.live.n !== p.live?.n) { play('gavel'); return; }
    if (w.entries > p.entries) play('tick');
  }, [on, quiet, w]);
}
