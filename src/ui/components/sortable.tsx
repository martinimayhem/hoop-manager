// Click-to-sort table headers, the same in every table. The first click sorts a column from high to
// low (names A to Z), the second the other way round, the third goes back to the table's own order
// (the standings, the starters first, and so on). Rows without a value (a DNP) always go last.
//
// Touch screens (GAME_FLOW §6.1a): the headers stay compact, and a 44 px Sort button above the table
// opens the same choices as a pop-up. With a mouse the button is hidden and the headers sort.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { SortDownIcon, SortIcon, SortUpIcon } from '../icons';

export type SortValue = number | string | null | undefined;
export interface SortState {
  key: string | null;
  desc: boolean;
}

export interface ThOptions {
  tip?: string;
  /** Text aligned left (names). */
  left?: boolean;
  /** The wide column of an equal-width table (the name). */
  wide?: boolean;
  /** Not sortable: a plain header that lines up with the rest. */
  plain?: boolean;
  /** A fixed width (px), for a column of buttons. */
  width?: number;
}

/** A sortable column, as the Sort pop-up lists it. */
interface Column {
  key: string;
  label: ReactNode;
  tip?: string;
  /** Names: A to Z first. */
  text: boolean;
}

export function useSort<T>(value: (row: T, key: string) => SortValue, initial: SortState = { key: null, desc: true }) {
  const [sort, setSort] = useState<SortState>(initial);
  // The sortable columns of the last render, in order (the Sort pop-up lists them).
  const columns = useRef<Column[]>([]);
  const rendering = useRef(0);
  const renderNo = useRef(0);
  renderNo.current++;
  const sorted = (rows: readonly T[]): T[] => {
    const key = sort.key;
    if (key === null) return [...rows];
    // Keep the table's own order between equals.
    const keyed = rows.map((row, i) => ({ row, i, v: value(row, key) }));
    keyed.sort((a, b) => {
      const an = a.v === null || a.v === undefined;
      const bn = b.v === null || b.v === undefined;
      if (an || bn) return an && bn ? a.i - b.i : an ? 1 : -1;
      const c = typeof a.v === 'string' ? a.v.localeCompare(b.v as string) : (a.v as number) - (b.v as number);
      return (sort.desc ? -c : c) || a.i - b.i;
    });
    return keyed.map((k) => k.row);
  };
  const click = (key: string, textFirst: boolean) =>
    setSort((s) => {
      const first = !textFirst; // numbers start high to low, names A to Z
      if (s.key !== key) return { key, desc: first };
      if (s.desc === first) return { key, desc: !first };
      return { key: null, desc: true };
    });
  const th = (key: string, label: ReactNode, o: ThOptions = {}) => {
    const cls = [o.left ? 'left' : '', o.wide ? 'wide' : '', o.plain ? '' : 'sortable', sort.key === key ? 'sorted' : ''].filter(Boolean).join(' ');
    if (o.plain)
      return (
        <th key={key} className={cls} title={o.tip} style={o.width ? { width: o.width } : undefined}>
          {label}
        </th>
      );
    // A new render starts a new list of columns.
    if (rendering.current !== renderNo.current) {
      rendering.current = renderNo.current;
      columns.current = [];
    }
    if (!columns.current.some((c) => c.key === key)) columns.current.push({ key, label, tip: o.tip, text: !!o.left });
    return (
      <th
        key={key}
        className={cls}
        style={o.width ? { width: o.width } : undefined}
        title={o.tip ? `${o.tip}. Click to sort.` : 'Click to sort.'}
        onClick={() => click(key, !!o.left)}
      >
        {label}
        <span className="sort-mark">{sort.key === key ? sort.desc ? <SortDownIcon /> : <SortUpIcon /> : null}</span>
      </th>
    );
  };
  /** The touch screens' Sort button, placed just above the table (hidden with a mouse). */
  const sortButton = (
    <SortButton
      columns={columns}
      sort={sort}
      pick={(key, desc) => setSort({ key, desc })}
      reset={() => setSort({ key: null, desc: true })}
    />
  );
  return { sort, sorted, th, sortButton };
}

function SortButton({
  columns,
  sort,
  pick,
  reset,
}: {
  columns: { current: Column[] };
  sort: SortState;
  pick: (key: string, desc: boolean) => void;
  reset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const current = columns.current.find((c) => c.key === sort.key);
  useEffect(() => {
    if (!open) return;
    // Escape closes this pop-up only (not the screen or pop-up under it).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  const choose = (key: string, desc: boolean) => {
    pick(key, desc);
    setOpen(false);
  };
  return (
    <>
      <button className="sort-touch" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <SortIcon /> Sort
        {current && (
          <span className="sort-touch-now">
            · {current.tip ? current.tip.split(/[:;,(]/)[0].trim() : current.label} {sort.desc ? <SortDownIcon /> : <SortUpIcon />}
          </span>
        )}
      </button>
      {open &&
        createPortal(
          <div className="sort-pop-back" onClick={() => setOpen(false)}>
            <div className="panel sort-pop" role="dialog" aria-label="Sort the table" onClick={(e) => e.stopPropagation()}>
              <div className="sort-pop-head">
                <h3>Sort by</h3>
                <button className="brk-close" onClick={() => setOpen(false)} aria-label="Close" title="Close">
                  <X size={20} aria-hidden="true" />
                </button>
              </div>
              <div className="sort-pop-cols">
                {columns.current.map((c) => {
                  const on = sort.key === c.key;
                  // Numbers high to low first, names A to Z first; tap again for the other way.
                  const desc = on ? !sort.desc : !c.text;
                  return (
                    <button key={c.key} className={on ? 'on' : ''} title={c.tip} onClick={() => choose(c.key, desc)}>
                      <span className="sort-pop-label">{c.tip ? c.tip.split(/[:;,(]/)[0].trim() : c.label}</span>
                      {on && (sort.desc ? <SortDownIcon /> : <SortUpIcon />)}
                    </button>
                  );
                })}
              </div>
              <button
                className="sort-pop-reset"
                disabled={sort.key === null}
                onClick={() => {
                  reset();
                  setOpen(false);
                }}
              >
                The table's own order
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
