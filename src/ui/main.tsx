import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Dev only: ?turntable shows every hairstyle and skin tone from eight angles. Left out of builds.
const Turntable = import.meta.env.DEV ? lazy(() => import('./dev/Turntable').then((m) => ({ default: m.Turntable }))) : null;
const turntable = Turntable && new URLSearchParams(window.location.search).has('turntable');
// Dev only: ?break plays a match to the end of Q1 (?break=2: halftime) and shows the break screen.
const BreakPreview = import.meta.env.DEV ? lazy(() => import('./dev/BreakPreview').then((m) => ({ default: m.BreakPreview }))) : null;
const breakPreview = BreakPreview && (new URLSearchParams(window.location.search).has('break') || new URLSearchParams(window.location.search).has('gamecast') || new URLSearchParams(window.location.search).has('result'));
// Dev only: ?3d is the 3D prototype (one rigged player driven by the match's frame data).
const Court3DPreview = import.meta.env.DEV ? lazy(() => import('./dev/Court3DPreview').then((m) => ({ default: m.Court3DPreview }))) : null;
const court3d = Court3DPreview && new URLSearchParams(window.location.search).has('3d');
// Dev only: ?capture is the page npm run frames drives; ?movelab loops one move in slow motion.
const Capture = import.meta.env.DEV ? lazy(() => import('./dev/Capture').then((m) => ({ default: m.Capture }))) : null;
const capture = Capture && new URLSearchParams(window.location.search).has('capture');
const MoveLab = import.meta.env.DEV ? lazy(() => import('./dev/MoveLab').then((m) => ({ default: m.MoveLab }))) : null;
const movelab = MoveLab && new URLSearchParams(window.location.search).has('movelab');
// Dev only: ?film shows every step of a dribble, a pass, a jump shot and a dunk in 3D, frame by frame.
const Court3DFilm = import.meta.env.DEV ? lazy(() => import('./dev/Court3DFilm').then((m) => ({ default: m.Court3DFilm }))) : null;
const film = Court3DFilm && new URLSearchParams(window.location.search).has('film');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {capture && Capture ? (
      <Suspense fallback={null}>
        <Capture />
      </Suspense>
    ) : movelab && MoveLab ? (
      <Suspense fallback={null}>
        <MoveLab />
      </Suspense>
    ) : film && Court3DFilm ? (
      <Suspense fallback={null}>
        <Court3DFilm />
      </Suspense>
    ) : court3d && Court3DPreview ? (
      <Suspense fallback={null}>
        <Court3DPreview />
      </Suspense>
    ) : turntable && Turntable ? (
      <Suspense fallback={null}>
        <Turntable />
      </Suspense>
    ) : breakPreview && BreakPreview ? (
      <Suspense fallback={null}>
        <BreakPreview />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
