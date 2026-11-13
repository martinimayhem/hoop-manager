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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {turntable && Turntable ? (
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
