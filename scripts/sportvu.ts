// Downloads a few games of the public 2015-16 NBA SportVU tracking data and converts them for the
// realism scorecard (npm run realism).
//
//   npm run sportvu                 the default games below
//   npm run sportvu -- --games 01.02.2016.DEN.at.GSW,01.01.2016.NYK.at.CHI
//
// Source: github.com/linouk23/NBA-Player-Movements (data/2016.NBA.Raw.SportVU.Game.Logs): x,y of
// the ten players and x,y,z of the ball, 25 times a second, in feet. Each game is a ~6 MB 7-Zip
// file holding ~100 MB of JSON; it is unpacked with the system tar (bsdtar reads 7-Zip; it ships
// with Windows 10/11 and macOS; on Linux install libarchive-tools or set TAR=bsdtar).
//
// Everything goes in data/sportvu/ (git-ignored): raw/ for the downloads, and one <game>.json per
// game in our shape (scripts/realism/track.ts): metres, our court, sorted, duplicates dropped.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from './args';
import type { Track, TrackFrame } from './realism/track';

export const DEFAULT_GAMES = ['01.01.2016.CHA.at.TOR', '01.01.2016.DAL.at.MIA', '01.01.2016.NYK.at.CHI', '01.02.2016.DEN.at.GSW'];
const BASE = 'https://github.com/linouk23/NBA-Player-Movements/raw/master/data/2016.NBA.Raw.SportVU.Game.Logs';
export const DIR = join('data', 'sportvu');
const RAW = join(DIR, 'raw');
const FT = 0.3048;

type Moment = [number, number, number, number | null, null, [number, number, number, number, number][]];
interface Raw {
  gameid: string;
  events: { home: { teamid: number }; visitor: { teamid: number }; moments: Moment[] }[];
}

function convert(name: string, raw: Raw): Track {
  const home = raw.events[0].home.teamid;
  const byTime = new Map<number, TrackFrame>();
  for (const ev of raw.events) {
    for (const m of ev.moments) {
      const [period, ms, clock, , , rows] = m;
      if (byTime.has(ms) || !rows?.length) continue;
      const ball = rows.find((r) => r[0] === -1);
      const players = rows.filter((r) => r[0] !== -1);
      if (!ball || players.length !== 10) continue;
      byTime.set(ms, {
        t: ms / 1000,
        period,
        clock,
        ball: { x: ball[2] * FT, y: ball[3] * FT, z: ball[4] * FT },
        p: players.map((r) => ({ team: r[0] === home ? 0 : 1, id: String(r[1]), x: r[2] * FT, y: r[3] * FT })),
      });
    }
  }
  const frames = [...byTime.values()].sort((a, b) => a.t - b.t);
  const t0 = frames[0]?.t ?? 0;
  for (const f of frames) f.t = Math.round((f.t - t0) * 1000) / 1000;
  return { name, source: 'real', frames };
}

/** Makes sure each game is downloaded and converted; returns the converted files. */
export async function ensureGames(games: string[] = DEFAULT_GAMES): Promise<string[]> {
  mkdirSync(RAW, { recursive: true });
  const out: string[] = [];
  for (const g of games) {
    const file = join(DIR, `${g}.json`);
    out.push(file);
    if (existsSync(file)) continue;
    const archive = join(RAW, `${g}.7z`);
    if (!existsSync(archive)) {
      process.stdout.write(`Downloading ${g}.7z… `);
      const res = await fetch(`${BASE}/${g}.7z`);
      if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText} (${g})`);
      writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
      console.log('done');
    }
    // Unpack into a folder of its own, then convert the one JSON inside.
    const tmp = join(RAW, g);
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp);
    const tar = process.env.TAR ?? (process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar');
    execFileSync(tar, ['-xf', archive, '-C', tmp]);
    const json = readdirSync(tmp).find((f) => f.endsWith('.json'));
    if (!json) throw new Error(`no JSON in ${archive}`);
    const track = convert(g, JSON.parse(readFileSync(join(tmp, json), 'utf8')) as Raw);
    rmSync(tmp, { recursive: true, force: true });
    writeFileSync(file, JSON.stringify(track));
    console.log(`Converted ${g}: ${track.frames.length} frames (${(track.frames.length / 25 / 60).toFixed(0)} min)`);
  }
  return out;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/sportvu.ts')) {
  const args = parseArgs(process.argv.slice(2));
  const games = args.get('games')?.split(',').filter(Boolean) ?? DEFAULT_GAMES;
  ensureGames(games).catch((e: unknown) => {
    console.error(`sportvu: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  });
}
