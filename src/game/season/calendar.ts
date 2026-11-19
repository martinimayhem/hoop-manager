// The season's calendar (slice brief W2a §1, GAME_FLOW §3.2): day by day from the first Saturday of
// October. Big League games midweek; US Divisions 2–4 and national leagues at the weekend; the cup
// weekends left free for the cups (W2b). All the numbers here are starting values (tune).

/** Day 0 is the first Saturday on or after this date (month 0-based). */
export const SEASON_START = { month: 9, day: 1 };

/** Weekdays by day number: day 0 is a Saturday. */
export const SAT = 0;
export const SUN = 1;
export const TUE = 3;
export const WED = 4;
export const THU = 5;
const WEEKDAY_NAMES = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Weekends kept free for the cups' rounds and Final Four weekends (W2b). */
export const CUP_WEEKS = [5, 11, 17, 23, 29];
/** US Divisions 2–4: a game every Saturday from week 0 that isn't a cup weekend (30 games: weeks 0–34). */
export const US_LAST_WEEK = 34;
/** National leagues: 22 rounds spread over the weekends of weeks 0–31 that aren't cup weekends. */
export const NATIONAL_LAST_WEEK = 31;
/** Big League: 40 rounds over weeks 0–31: Tuesday and Thursday in every fourth week, else Wednesday. */
export const BIG_LEAGUE_LAST_WEEK = 31;
export const isBigLeagueDoubleWeek = (week: number) => week % 4 === 1;

/** The season's first day (a Saturday), as a UTC date. */
export function seasonStart(year: number): Date {
  const d = new Date(Date.UTC(year, SEASON_START.month, SEASON_START.day));
  while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

export function dateOf(year: number, day: number): Date {
  const d = seasonStart(year);
  d.setUTCDate(d.getUTCDate() + day);
  return d;
}

export const weekday = (day: number) => ((day % 7) + 7) % 7;
export const weekOf = (day: number) => Math.floor(day / 7);
export const dayOf = (week: number, wd: number) => week * 7 + wd;

/** "Sat 3 Oct". */
export function shortDate(year: number, day: number): string {
  const d = dateOf(year, day);
  return `${WEEKDAY_NAMES[weekday(day)]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}`;
}

/** "Saturday 3 October 2026". */
export function longDate(year: number, day: number): string {
  const d = dateOf(year, day);
  const long = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][weekday(day)];
  return `${long} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** A month of the season: its key ("2026-10") and name ("October 2026"). */
export function monthOf(year: number, day: number): { key: string; name: string } {
  const d = dateOf(year, day);
  return { key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, name: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
}
