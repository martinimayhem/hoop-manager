// Real professional teams' nicknames (SEASON_SPEC R3.2): a club may be a real city, but its nickname
// is always invented, never one of these. NBA, WNBA, G League, NFL, MLB, NHL, MLS, and the
// EuroLeague and EuroCup clubs' names and nicknames. Compared with case and spaces ignored.

const LIST = `
Hawks Celtics Nets Hornets Bulls Cavaliers Mavericks Nuggets Pistons Warriors Rockets Pacers Clippers
Lakers Grizzlies Heat Bucks Timberwolves Pelicans Knicks Thunder Magic 76ers Sixers Suns Trail-Blazers
Blazers Kings Spurs Raptors Jazz Wizards
Dream Sky Sun Wings Fever Aces Sparks Lynx Liberty Mercury Storm Mystics Valkyries Tempo Fire Comets
Skyhawks Cruise Legends Mad-Ants Herd Hustle Swarm Charge Gold Vipers Stampede Squadron Blue Go-Go
Remix Knights Wolves Long-Island-Nets Westchester-Knicks Maine-Celtics Osceola-Magic Motor-City-Cruise
Stockton-Kings Salt-Lake-City-Stars Stars Austin-Spurs Iowa-Wolves Valley-Suns Rip-City-Remix
Bears Lions Packers Vikings Giants Eagles Cowboys Commanders Saints Falcons Panthers Buccaneers Rams
49ers Seahawks Cardinals Patriots Bills Dolphins Jets Ravens Steelers Browns Bengals Texans Colts
Jaguars Titans Broncos Chiefs Raiders Chargers
Yankees Mets Red-Sox Cubs White-Sox Dodgers Angels Padres Mariners Astros Rangers Athletics Twins
Tigers Guardians Royals Brewers Pirates Reds Braves Marlins Phillies Nationals Orioles Blue-Jays Rays
Rockies Diamondbacks
Bruins Sabres Red-Wings Canadiens Senators Lightning Maple-Leafs Hurricanes Blue-Jackets Devils
Islanders Flyers Penguins Capitals Blackhawks Avalanche Wild Predators Blues Ducks Flames Oilers
Sharks Kraken Canucks Golden-Knights Mammoth Coyotes
Galaxy Union Crew Sounders Timbers Whitecaps Dynamo Revolution Red-Bulls Earthquakes Rapids United
Sporting Inter City FC
Real-Madrid Barca Barcelona Olympiacos Panathinaikos Fenerbahce Anadolu-Efes Efes Partizan
Crvena-Zvezda Red-Star Zalgiris Baskonia Maccabi Bayern Monaco Virtus Olimpia Armani ASVEL
Paris-Basketball Valencia-Basket Hapoel Dubai Lietkabelis Bourg Hamburg-Towers Towers Turk-Telekom
Besiktas Galatasaray Bahcesehir Umana-Reyer Reyer Cedevita Buducnost Ulm Joventut Gran-Canaria
Unicaja Ratiopharm Wolves Trento Aquila Prometey Slask Manresa Tenerife Lenovo Peristeri Aris PAOK
`;

const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.'’]/g, '');

export const REAL_NICKNAMES: ReadonlySet<string> = new Set(LIST.split(/\s+/).filter(Boolean).map(norm));

/**
 * Whether a club's name uses a real team's nickname: its last word, or last two words (Red Sox,
 * Trail Blazers), or the whole name.
 */
export function usesRealNickname(clubName: string): boolean {
  const words = clubName.trim().split(/\s+/);
  const tails = [words.slice(-1), words.slice(-2), words].map((w) => norm(w.join('')));
  return tails.some((t) => REAL_NICKNAMES.has(t));
}
