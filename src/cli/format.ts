// Console formatting for play-by-play and box scores.

import type { BoxScore, TeamBox } from '../engine/stats';
import type { TimedEvent } from '../engine/types';

export function clockString(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function periodLabel(quarter: number): string {
  return quarter <= 4 ? `Q${quarter}` : `OT${quarter - 4}`;
}

export function playByPlayLine(ev: TimedEvent, text: string, abbrs: [string, string]): string {
  const score = `${abbrs[0]} ${String(ev.score[0]).padStart(3)}-${String(ev.score[1]).padEnd(3)} ${abbrs[1]}`;
  return `${periodLabel(ev.quarter).padEnd(3)} ${clockString(ev.clock).padStart(5)}  ${score}  ${text}`;
}

const pct = (made: number, att: number) => (att === 0 ? '  -  ' : `${((100 * made) / att).toFixed(1)}%`.padStart(5));
const split = (made: number, att: number) => `${made}-${att}`.padStart(5);

export function formatLineScore(box: BoxScore): string {
  const periods = Math.max(box.teams[0].quarterPoints.length, box.teams[1].quarterPoints.length);
  const head = ['    ', ...Array.from({ length: periods }, (_, i) => (i < 4 ? `Q${i + 1}` : `OT${i - 3}`).padStart(4)), '   T'].join(' ');
  const row = (t: TeamBox) => [t.abbr.padEnd(4), ...t.quarterPoints.map((p) => String(p).padStart(4)), String(t.score).padStart(4)].join(' ');
  return [head, row(box.teams[0]), row(box.teams[1])].join('\n');
}

export function formatTeamBox(t: TeamBox): string {
  const header =
    'Player                  Pos   MIN  PTS    FG    3P    FT  OR  DR REB AST STL BLK  TO  PF   +/-';
  const lines = [`${t.name} — ${t.score}`, header, '-'.repeat(header.length)];
  for (const { player, starter, stats: st } of t.players) {
    if (st.seconds === 0) {
      lines.push(`${(starter ? '' : ' ') + `#${player.number} ${player.name}`}`.padEnd(24) + `${player.position.padEnd(3)}  DNP`);
      continue;
    }
    lines.push(
      [
        `${starter ? '' : ' '}#${player.number} ${player.name}`.padEnd(23),
        player.position.padEnd(3),
        String(Math.round(st.seconds / 60)).padStart(5),
        String(st.pts).padStart(4),
        split(st.fgm, st.fga),
        split(st.tpm, st.tpa),
        split(st.ftm, st.fta),
        String(st.oreb).padStart(3),
        String(st.dreb).padStart(3),
        String(st.oreb + st.dreb).padStart(3),
        String(st.ast).padStart(3),
        String(st.stl).padStart(3),
        String(st.blk).padStart(3),
        String(st.tov).padStart(3),
        String(st.pf).padStart(3),
        (st.plusMinus > 0 ? `+${st.plusMinus}` : String(st.plusMinus)).padStart(5),
      ].join(' '),
    );
  }
  const tt = t.totals;
  lines.push('-'.repeat(header.length));
  lines.push(
    [
      'TOTAL'.padEnd(23), '   ', '     ', String(tt.pts).padStart(4), split(tt.fgm, tt.fga), split(tt.tpm, tt.tpa), split(tt.ftm, tt.fta),
      String(tt.oreb).padStart(3), String(tt.dreb).padStart(3), String(tt.oreb + tt.dreb).padStart(3), String(tt.ast).padStart(3),
      String(tt.stl).padStart(3), String(tt.blk).padStart(3), String(tt.tov).padStart(3), String(tt.pf).padStart(3),
    ].join(' '),
  );
  lines.push(
    `FG ${pct(tt.fgm, tt.fga)}   3P ${pct(tt.tpm, tt.tpa)}   FT ${pct(tt.ftm, tt.fta)}   ` +
      `Possessions ${t.extras.possessions}   Pts/poss ${(t.score / Math.max(1, t.extras.possessions)).toFixed(2)}   ` +
      `Paint ${t.extras.paintPts}   Fast break ${t.extras.fastBreakPts}   2nd chance ${t.extras.secondChancePts}`,
  );
  return lines.join('\n');
}

export function formatBoxScore(box: BoxScore): string {
  return [formatLineScore(box), '', formatTeamBox(box.teams[0]), '', formatTeamBox(box.teams[1])].join('\n');
}
