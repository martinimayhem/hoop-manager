// The top bar of every screen except the main menu (GAME_FLOW §6.1b): Back first on the left, always in
// the same place and the same size (greyed when there is nowhere to go back to; "Leave" on a
// full-screen moment), the main menu next to it, then the path to this screen, every part clickable.
// Fixed to the top of the window, so no screen's layout can move it.

import { ArrowLeft, ChevronRight, House, LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNav, type Route } from '../nav';

export interface Crumb {
  label: string;
  /** Where it leads; none for a part that has no screen of its own. */
  route?: Route;
}

export function TopBar({
  crumbs,
  right,
  leave,
  onMenu,
}: {
  crumbs: Crumb[];
  /** The screen's own controls, on the right. */
  right?: ReactNode;
  /** A full-screen moment: Back becomes Leave, which goes here (after any guard has asked). */
  leave?: () => void;
  /** Instead of going straight to the main menu (a career saves first). */
  onMenu?: () => void;
}) {
  const nav = useNav();
  const canBack = nav.canBack || !!leave;
  return (
    <>
      <header className="tb" data-testid="top-bar">
        <button className="tb-back" disabled={!canBack} onClick={() => (leave ? leave() : nav.back())} aria-label={leave ? 'Leave' : 'Back'} title={leave ? 'Leave' : canBack ? 'Back' : 'Nothing to go back to'}>
          {leave ? <LogOut size={18} aria-hidden="true" /> : <ArrowLeft size={18} aria-hidden="true" />}
          <span>{leave ? 'Leave' : 'Back'}</span>
        </button>
        <button className="tb-menu" onClick={() => (onMenu ? onMenu() : nav.menu())} aria-label="Main menu" title="Main menu">
          <House size={18} aria-hidden="true" />
          <span>Menu</span>
        </button>
        <nav className="tb-path" aria-label="Where you are">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <span key={`${c.label}-${i}`} className="tb-crumb">
                {i > 0 && <ChevronRight size={14} aria-hidden="true" className="tb-sep" />}
                <button className={last ? 'here' : ''} aria-current={last ? 'page' : undefined} disabled={!c.route} onClick={() => c.route && !last && nav.go(c.route)}>
                  {c.label}
                </button>
              </span>
            );
          })}
        </nav>
        {right && <div className="tb-right">{right}</div>}
      </header>
      <div className="tb-space" aria-hidden="true" />
    </>
  );
}
