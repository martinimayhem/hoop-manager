import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Dev only: ?turntable shows every hairstyle and skin tone from eight angles. Left out of builds.
const Turntable = import.meta.env.DEV ? lazy(() => import('./dev/Turntable').then((m) => ({ default: m.Turntable }))) : null;
const turntable = Turntable && new URLSearchParams(window.location.search).has('turntable');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {turntable && Turntable ? (
      <Suspense fallback={null}>
        <Turntable />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
