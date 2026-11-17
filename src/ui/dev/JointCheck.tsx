// Dev only (?jointcheck&seed=1&q=1&minutes=3[&limits=off]; `npm run joints`): plays real match play
// through the 3D view and measures every joint of every player every frame against how far a human
// joint can bend (court3d/joints.ts). It reports how often and how far each joint goes past its limit,
// how often a ball held in the hands is off the palms (the limits must not pull the hands off it), and
// the worst moments with their match clock, to film them with npm run frames. With limits=off it shows
// what the poses would do without the limits (the "before").
//
// For `npm run joints`: the report is saved as frames/jointcheck/report.txt, and the run fails if any
// joint is past its limit by more than TOLERANCE_DEG with the limits on.

import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../../data/teams';
import { isRef } from '../court/animation';
import { lookFor3d } from '../court3d/roster3d';
import { Scene3D, loadAssets } from '../court3d/scene3d';
import { clockString } from '../labels';
import { LiveMatch } from '../match/controller';

const DT = 1 / 60;
const DEG = 180 / Math.PI;
/** Past a limit by more than this (degrees) counts. */
const TOLERANCE_DEG = 2;
/** A ball held in the hands further than this from both palms counts as off them (m). */
const OFF_PALM_M = 0.08;

interface Worst {
  bone: string;
  deg: number;
  kind: 'swing' | 'twist';
  clock: string;
  quarter: number;
  who: string;
  arms: string;
}

type Rig = { probe?(bone: string): { theta: number; du: number; dv: number; twist: number } | null; jointExcess(): { bone: string; swing: number; twist: number }[]; setJointLimits(on: boolean): void; state: { arms: string }; ballInPalm(s: 'l' | 'r'): THREE.Vector3 };

export function JointCheck() {
  const [status, setStatus] = useState('Loading the 3D models…');
  const [report, setReport] = useState('');

  useEffect(() => {
    let cancelled = false;
    window.__shots = { done: false, images: [] };
    (async () => {
      const q = new URLSearchParams(window.location.search);
      const seed = Number(q.get('seed')) || 1;
      const quarter = Number(q.get('q')) || 1;
      const minutes = Number(q.get('minutes')) || 3;
      const limitsOn = q.get('limits') !== 'off';
      const assets = await loadAssets();
      const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], seed, ['ai', 'ai'], 'normal');
      m.highlights = false;
      const canvas = document.createElement('canvas');
      const scene = new Scene3D(canvas, assets, (k) => lookFor3d(m, k));
      scene.resize(64, 48);
      const perBone: Record<string, { frames: number; max: number }> = {};
      const worst: Worst[] = [];
      let frames = 0;
      let playerFrames = 0;
      let held = 0;
      let offPalm = 0;
      let worstOff = 0;
      const set = new Set<object>();
      const probeBones = (q.get('probe') ?? '').split(',').filter(Boolean);
      // ?only=upperarm: the worst moments only for joints whose name has that in it.
      const only = q.get('only');
      const probes: Record<string, { du: number[]; dv: number[]; twist: number[] }> = {};
      const end = 720 - minutes * 60;
      while (!cancelled && m.phase !== 'final' && (m.quarter < quarter || (m.quarter === quarter && m.clock > end))) {
        m.tick(DT);
        if (m.phase === 'timeout' || m.phase === 'break') m.resume();
        if (m.phase === 'argue') m.letItGo();
        if (m.phase === 'clutch') while (m.clutch) m.submitClutch(m.clutch.pending[0], null);
        m.drainFx();
        if (m.quarter < quarter) continue;
        const frame = m.frame();
        if (!frame) continue;
        const holder = m.holderKey();
        scene.render(frame, m.currentAction(), holder, DT * (frame.timeScale ?? 1), m.upcomingAction());
        frames++;
        if (frames % 1500 === 0) {
          setStatus(`Q${m.quarter} ${clockString(m.clock)}`);
          await new Promise((r) => setTimeout(r, 0));
        }
        for (const key of Object.keys(frame.players)) {
          const rig = scene.rigOf(key) as unknown as Rig | null;
          if (!rig) continue;
          if (!set.has(rig)) {
            set.add(rig);
            rig.setJointLimits(limitsOn);
          }
          if (isRef(key)) continue;
          playerFrames++;
          // ?probe=bone,bone: where those joints go, in the cone's terms (to set limits from real motion).
          for (const pb of probeBones) {
            const r = (rig as unknown as { limits: { probe(b: string): { theta: number; du: number; dv: number; twist: number } | null } }).limits.probe(pb);
            if (!r) continue;
            const s = (probes[pb] ??= { du: [], dv: [], twist: [] });
            s.du.push(r.du);
            s.dv.push(r.dv);
            s.twist.push(r.twist);
          }
          for (const e of rig.jointExcess()) {
            for (const [kind, rad] of [['swing', e.swing], ['twist', e.twist]] as const) {
              const deg = rad * DEG;
              if (deg <= TOLERANCE_DEG) continue;
              const b = (perBone[`${e.bone} ${kind}`] ??= { frames: 0, max: 0 });
              b.frames++;
              b.max = Math.max(b.max, deg);
              if (!only || e.bone.includes(only)) worst.push({ bone: e.bone, deg, kind, clock: clockString(m.clock), quarter: m.quarter, who: key, arms: rig.state.arms });
              if (worst.length > 4000) {
                worst.sort((x, y) => y.deg - x.deg);
                worst.length = 200;
              }
            }
          }
          // A ball in his hands (holding it, not dribbling it): on his palms.
          const arms = rig.state.arms;
          if (holder === key && /holding|pass: (picking|pushing)|pump fake|pass fake|gathered|taking it up|both hands on the ball/.test(arms)) {
            held++;
            const b = scene.ballDrawn;
            const d = Math.min(rig.ballInPalm('l').distanceTo(b), rig.ballInPalm('r').distanceTo(b));
            if (d > OFF_PALM_M) offPalm++;
            worstOff = Math.max(worstOff, d);
          }
        }
      }
      worst.sort((x, y) => y.deg - x.deg);
      // The worst moments, one per player and second.
      const seen = new Set<string>();
      const top = worst.filter((w) => {
        if (only && !w.bone.includes(only)) return false;
        const k = `${w.who}|${w.clock}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const lines = [
        `Joint check, seed ${seed}, Q${quarter}, ${minutes} min, limits ${limitsOn ? 'ON' : 'OFF'}: ${frames} frames, ${playerFrames} player-frames.`,
        `Ball held in the hands: ${held} player-frames, off the palms (> ${OFF_PALM_M * 100} cm) in ${offPalm}; worst ${(worstOff * 100).toFixed(1)} cm.`,
        '',
        `Past the limit by more than ${TOLERANCE_DEG}°: joint, share of player-frames, worst.`,
        ...Object.entries(perBone)
          .sort((a, b) => b[1].frames - a[1].frames)
          .map(([k, v]) => `  ${k.padEnd(20)} ${((100 * v.frames) / Math.max(1, playerFrames)).toFixed(2).padStart(6)}%  worst ${v.max.toFixed(0)}°`),
        Object.keys(perBone).length ? '' : '  none',
        ...Object.entries(probes).map(([b, s]) => {
          const pct = (xs: number[], p: number) => [...xs].sort((x, y) => x - y)[Math.floor((xs.length - 1) * p)].toFixed(0);
          const row = (n: string, xs: number[]) => `${n} 1% ${pct(xs, 0.01)} 50% ${pct(xs, 0.5)} 99% ${pct(xs, 0.99)} min ${pct(xs, 0)} max ${pct(xs, 1)}`;
          return `Probe ${b}: ${row('u', s.du)} | ${row('v', s.dv)} | ${row('twist', s.twist)}`;
        }),
        '',
        'Worst moments:',
        ...top.slice(0, 25).map((w) => `  Q${w.quarter} ${w.clock}  ${w.who.padEnd(10)} ${w.bone} ${w.kind} +${w.deg.toFixed(0)}°  (${w.arms || '-'})`),
      ];
      const text = lines.join('\n');
      if (cancelled) return;
      setReport(text);
      setStatus('Done.');
      const failed = limitsOn && Object.keys(perBone).length > 0;
      window.__shots = {
        done: true,
        images: [{ name: limitsOn ? 'report.txt' : 'report-limits-off.txt', png: `data:text/plain;base64,${btoa(text)}` }],
        error: failed ? `joints past their limits:\n${text}` : undefined,
      };
    })().catch((e: unknown) => {
      setStatus(String(e));
      window.__shots = { done: true, images: [], error: String(e) };
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#0d1218', color: '#d6deec', font: '13px ui-monospace, monospace', padding: 16 }}>
      <h2 style={{ margin: '0 0 6px', fontFamily: 'system-ui' }}>Joint check</h2>
      <div style={{ color: '#9fb0c8', marginBottom: 12 }}>{status}</div>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{report}</pre>
    </div>
  );
}
