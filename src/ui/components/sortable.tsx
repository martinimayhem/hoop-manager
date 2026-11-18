// Click-to-sort table headers, the same in every table. The first click sorts a column from high to
// low (names A to Z), the second the other way round, the third goes back to the table's own order
// (the standings, the starters first, and so on). Rows without a value (a DNP) always go last.

import { useState, type ReactNode } from 'react';
import { SortDownIcon, SortUpIcon } from '../icons';

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

export function useSort<T>(value: (row: T, key: string) => SortValue, initial: SortState = { key: null, desc: true }) {
  const [sort, setSort] = useState<SortState>(initial);
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
  return { sort, sorted, th };
}
