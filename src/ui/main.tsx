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
// Dev only: ?heads3d shows the 3D heads close up (every hairstyle and skin tone; =match: a match's ten players).
const Heads3D = import.meta.env.DEV ? lazy(() => import('./dev/Heads3D').then((m) => ({ default: m.Heads3D }))) : null;
const heads3d = Heads3D && new URLSearchParams(window.location.search).has('heads3d');
// Dev only: ?clips3d plays each Mixamo clip on the base body; ?dribble3d films one player dribbling at three speeds.
const Clips3D = import.meta.env.DEV ? lazy(() => import('./dev/Clips3D').then((m) => ({ default: m.Clips3D }))) : null;
const clips3d = Clips3D && new URLSearchParams(window.location.search).has('clips3d');
const Dribble3D = import.meta.env.DEV ? lazy(() => import('./dev/Dribble3D').then((m) => ({ default: m.Dribble3D }))) : null;
const dribble3d = Dribble3D && new URLSearchParams(window.location.search).has('dribble3d');
const DribbleCheck = import.meta.env.DEV ? lazy(() => import('./dev/DribbleCheck').then((m) => ({ default: m.DribbleCheck }))) : null;
const dribblecheck = DribbleCheck && new URLSearchParams(window.location.search).has('dribblecheck');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {dribblecheck && DribbleCheck ? (
      <Suspense fallback={null}>
        <DribbleCheck />
      </Suspense>
    ) : clips3d && Clips3D ? (
      <Suspense fallback={null}>
        <Clips3D />
      </Suspense>
    ) : dribble3d && Dribble3D ? (
      <Suspense fallback={null}>
        <Dribble3D />
      </Suspense>
    ) : heads3d && Heads3D ? (
      <Suspense fallback={null}>
        <Heads3D />
      </Suspense>
    ) : capture && Capture ? (
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
