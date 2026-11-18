// The career world's places (WORLD_SPEC §1.3): 64 American and 64 European cities, each with one club
// (a real city, an invented nickname, checked against real teams' nicknames by a test). Listed per
// region from the biggest down: the first 16 start in the Big League, the next 16 in Division 2, and
// so on. The Quick League's 48 clubs keep their names here.
//
// America and Europe are separate: their clubs never share a division (WORLD_SPEC §1.1).

import type { Region } from '../league/leagues';

export interface Place {
  city: string;
  /** ISO 3166 alpha-2 country code (GB for the United Kingdom). */
  country: string;
  nickname: string;
  /** US state or region, for colleges and hometowns. */
  state?: string;
}

const p = (city: string, country: string, nickname: string, state?: string): Place => ({ city, country, nickname, ...(state ? { state } : {}) });

export const PLACES: Record<Region, Place[]> = {
  america: [
    // Big League, America Conference
    p('New York', 'US', 'Skyliners', 'NY'),
    p('Los Angeles', 'US', 'Palms', 'CA'),
    p('Chicago', 'US', 'Gales', 'IL'),
    p('Houston', 'US', 'Orbits', 'TX'),
    p('Philadelphia', 'US', 'Bells', 'PA'),
    p('Dallas', 'US', 'Lassos', 'TX'),
    p('Miami', 'US', 'Flamingos', 'FL'),
    p('Boston', 'US', 'Lanterns', 'MA'),
    p('Atlanta', 'US', 'Peaches', 'GA'),
    p('Washington', 'US', 'Monuments', 'DC'),
    p('San Francisco', 'US', 'Trolleys', 'CA'),
    p('Phoenix', 'US', 'Mirages', 'AZ'),
    p('Seattle', 'US', 'Squalls', 'WA'),
    p('Detroit', 'US', 'Gears', 'MI'),
    p('Denver', 'US', 'Peaks', 'CO'),
    p('Minneapolis', 'US', 'Voyagers', 'MN'),
    // Division 2
    p('San Diego', 'US', 'Surfriders', 'CA'),
    p('Tampa', 'US', 'Mangroves', 'FL'),
    p('St. Louis', 'US', 'Arches', 'MO'),
    p('Baltimore', 'US', 'Harbormasters', 'MD'),
    p('Charlotte', 'US', 'Racers', 'NC'),
    p('Portland', 'US', 'Bridges', 'OR'),
    p('Sacramento', 'US', 'Prospectors', 'CA'),
    p('Indianapolis', 'US', 'Speedsters', 'IN'),
    p('Memphis', 'US', 'Paddlers', 'TN'),
    p('Oklahoma City', 'US', 'Twisters', 'OK'),
    p('Salt Lake City', 'US', 'Gulls', 'UT'),
    p('Milwaukee', 'US', 'Anchors', 'WI'),
    p('Pittsburgh', 'US', 'Ironworks', 'PA'),
    p('Cleveland', 'US', 'Foundry', 'OH'),
    p('San Antonio', 'US', 'Riverwalkers', 'TX'),
    p('Orlando', 'US', 'Groves', 'FL'),
    // Division 3
    p('Cincinnati', 'US', 'Riverboats', 'OH'),
    p('Kansas City', 'US', 'Fountains', 'MO'),
    p('Nashville', 'US', 'Fiddlers', 'TN'),
    p('Austin', 'US', 'Bats', 'TX'),
    p('Columbus', 'US', 'Explorers', 'OH'),
    p('Las Vegas', 'US', 'Neons', 'NV'),
    p('New Orleans', 'US', 'Brass', 'LA'),
    p('Raleigh', 'US', 'Oaks', 'NC'),
    p('Louisville', 'US', 'Thoroughbreds', 'KY'),
    p('Jacksonville', 'US', 'Lighthouses', 'FL'),
    p('Richmond', 'US', 'Ironclads', 'VA'),
    p('Buffalo', 'US', 'Snowbirds', 'NY'),
    p('Hartford', 'US', 'Charters', 'CT'),
    p('Albuquerque', 'US', 'Balloons', 'NM'),
    p('Tucson', 'US', 'Saguaros', 'AZ'),
    p('Omaha', 'US', 'Prairies', 'NE'),
    // Division 4
    p('Fort Worth', 'US', 'Stockyards', 'TX'),
    p('El Paso', 'US', 'Mesas', 'TX'),
    p('Tulsa', 'US', 'Derricks', 'OK'),
    p('Honolulu', 'US', 'Outriggers', 'HI'),
    p('Anchorage', 'US', 'Glaciers', 'AK'),
    p('Boise', 'US', 'Foothills', 'ID'),
    p('Spokane', 'US', 'Pines', 'WA'),
    p('Des Moines', 'US', 'Cornstalks', 'IA'),
    p('Little Rock', 'US', 'Quartz', 'AR'),
    p('Knoxville', 'US', 'Ridgerunners', 'TN'),
    p('Lexington', 'US', 'Bluegrass', 'KY'),
    p('Syracuse', 'US', 'Saltmakers', 'NY'),
    p('Rochester', 'US', 'Lilacs', 'NY'),
    p('Providence', 'US', 'Quahogs', 'RI'),
    p('Dayton', 'US', 'Aviators', 'OH'),
    p('Fresno', 'US', 'Vineyards', 'CA'),
  ],
  europe: [
    // Big League, Europe Conference
    p('Madrid', 'ES', 'Meteors'),
    p('Barcelona', 'ES', 'Breakers'),
    p('Istanbul', 'TR', 'Crescents'),
    p('Athens', 'GR', 'Owls'),
    p('Belgrade', 'RS', 'Kestrels'),
    p('Milan', 'IT', 'Herons'),
    p('Kaunas', 'LT', 'Ambers'),
    p('Paris', 'FR', 'Swifts'),
    p('Valencia', 'ES', 'Oranges'),
    p('Bologna', 'IT', 'Porticos'),
    p('Vitoria', 'ES', 'Foxes'),
    p('Lyon', 'FR', 'Larks'),
    p('Munich', 'DE', 'Alpines'),
    p('Berlin', 'DE', 'Sparrows'),
    p('Vilnius', 'LT', 'Storks'),
    p('Zagreb', 'HR', 'Kites'),
    // Division 2
    p('London', 'GB', 'Cabbies'),
    p('Amsterdam', 'NL', 'Tulips'),
    p('Lisbon', 'PT', 'Navigators'),
    p('Manchester', 'GB', 'Bees'),
    p('Rome', 'IT', 'Centurions'),
    p('Hamburg', 'DE', 'Tugboats'),
    p('Antwerp', 'BE', 'Diamonds'),
    p('Ljubljana', 'SI', 'Larches'),
    p('Thessaloniki', 'GR', 'Cormorants'),
    p('Malaga', 'ES', 'Sunbeams'),
    p('Monaco', 'MC', 'Yachtsmen'),
    p('Ankara', 'TR', 'Angoras'),
    p('Izmir', 'TR', 'Figs'),
    p('Venice', 'IT', 'Gondoliers'),
    p('Bamberg', 'DE', 'Bellringers'),
    p('Seville', 'ES', 'Flamencos'),
    // Division 3
    p('Bilbao', 'ES', 'Shipwrights'),
    p('Zaragoza', 'ES', 'Basilisks'),
    p('Turin', 'IT', 'Spires'),
    p('Naples', 'IT', 'Volcanoes'),
    p('Strasbourg', 'FR', 'Steeples'),
    p('Frankfurt', 'DE', 'Bankers'),
    p('Cologne', 'DE', 'Carnivals'),
    p('Riga', 'LV', 'Pinewoods'),
    p('Warsaw', 'PL', 'Mermaids'),
    p('Prague', 'CZ', 'Golems'),
    p('Budapest', 'HU', 'Thermals'),
    p('Vienna', 'AT', 'Waltzers'),
    p('Brussels', 'BE', 'Atomiums'),
    p('Rotterdam', 'NL', 'Dockers'),
    p('Porto', 'PT', 'Rabelos'),
    p('Copenhagen', 'DK', 'Cyclists'),
    // Division 4
    p('Stockholm', 'SE', 'Skerries'),
    p('Helsinki', 'FI', 'Icebreakers'),
    p('Oslo', 'NO', 'Fjords'),
    p('Sofia', 'BG', 'Roses'),
    p('Bucharest', 'RO', 'Lindens'),
    p('Podgorica', 'ME', 'Ravines'),
    p('Sarajevo', 'BA', 'Coppersmiths'),
    p('Skopje', 'MK', 'Stonebridges'),
    p('Split', 'HR', 'Sailmakers'),
    p('Novi Sad', 'RS', 'Fortresses'),
    p('Tallinn', 'EE', 'Ramparts'),
    p('Glasgow', 'GB', 'Thistles'),
    p('Dublin', 'IE', 'Harps'),
    p('Limoges', 'FR', 'Porcelains'),
    p('Ulm', 'DE', 'Tinkers'),
    p('Patras', 'GR', 'Vintners'),
  ],
};

/** Country names, for the screens. */
export const COUNTRY_NAME: Record<string, string> = {
  US: 'United States', CA: 'Canada', ES: 'Spain', TR: 'Türkiye', GR: 'Greece', RS: 'Serbia', IT: 'Italy', LT: 'Lithuania',
  FR: 'France', DE: 'Germany', HR: 'Croatia', GB: 'United Kingdom', NL: 'Netherlands', PT: 'Portugal', BE: 'Belgium',
  SI: 'Slovenia', MC: 'Monaco', LV: 'Latvia', PL: 'Poland', CZ: 'Czechia', HU: 'Hungary', AT: 'Austria', DK: 'Denmark',
  SE: 'Sweden', FI: 'Finland', NO: 'Norway', BG: 'Bulgaria', RO: 'Romania', ME: 'Montenegro', BA: 'Bosnia and Herzegovina',
  MK: 'North Macedonia', EE: 'Estonia', IE: 'Ireland', AU: 'Australia', NG: 'Nigeria', SN: 'Senegal', CM: 'Cameroon',
  BR: 'Brazil', AR: 'Argentina', DO: 'Dominican Republic', PR: 'Puerto Rico',
};

/**
 * The 40 colleges (WORLD_SPEC §5.1): invented names, each tied to a real place so a player can find
 * one near him. Checked against real NCAA Division I schools by a test.
 */
export interface CollegePlace {
  name: string;
  city: string;
  state: string;
  /** 1 (best) to 5: how good its players are. */
  level: number;
}

const c = (name: string, city: string, state: string, level: number): CollegePlace => ({ name, city, state, level });

export const COLLEGES: CollegePlace[] = [
  c('Sacramento Valley University', 'Sacramento', 'CA', 2),
  c('Pacific Shores University', 'San Diego', 'CA', 1),
  c('Golden Bay Institute', 'Oakland', 'CA', 3),
  c('Inland Empire College', 'Riverside', 'CA', 4),
  c('Cascade Mountain University', 'Portland', 'OR', 2),
  c('Puget Sound Polytechnic', 'Tacoma', 'WA', 3),
  c('Desert Sun University', 'Tucson', 'AZ', 2),
  c('Red Rock College', 'Las Vegas', 'NV', 4),
  c('High Plains University', 'Lubbock', 'TX', 3),
  c('Lone Star Polytechnic', 'Austin', 'TX', 1),
  c('Gulf Bayou University', 'Houston', 'TX', 2),
  c('Rio Bravo College', 'El Paso', 'TX', 5),
  c('Front Range University', 'Boulder', 'CO', 2),
  c('Great Salt Basin College', 'Provo', 'UT', 4),
  c('Prairie Wind University', 'Wichita', 'KS', 3),
  c('Heartland Institute', 'Omaha', 'NE', 4),
  c('Twin Rivers University', 'Minneapolis', 'MN', 3),
  c('Lakeshore Polytechnic', 'Chicago', 'IL', 1),
  c('Great Lakes Maritime College', 'Cleveland', 'OH', 4),
  c('Buckeye Valley University', 'Columbus', 'OH', 2),
  c('Motor City Institute', 'Detroit', 'MI', 3),
  c('Hoosier Plains College', 'Bloomington', 'IN', 2),
  c('Bluegrass Hills University', 'Lexington', 'KY', 1),
  c('Smoky Ridge College', 'Knoxville', 'TN', 3),
  c('Delta Crossing University', 'Memphis', 'TN', 3),
  c('Ozark Highlands College', 'Fayetteville', 'AR', 4),
  c('Bayou Crescent University', 'New Orleans', 'LA', 4),
  c('Magnolia Coast College', 'Mobile', 'AL', 5),
  c('Peach Orchard University', 'Atlanta', 'GA', 2),
  c('Sunshine Coast Institute', 'Tampa', 'FL', 3),
  c('Everglades University', 'Miami', 'FL', 2),
  c('Tobacco Road Institute', 'Durham', 'NC', 1),
  c('Blue Ridge Polytechnic', 'Roanoke', 'VA', 4),
  c('Capital District University', 'Washington', 'DC', 2),
  c('Chesapeake Bay College', 'Baltimore', 'MD', 3),
  c('Keystone Hills University', 'Philadelphia', 'PA', 2),
  c('Empire Harbor University', 'New York', 'NY', 1),
  c('Hudson Highlands College', 'Albany', 'NY', 5),
  c('Bay State Polytechnic', 'Worcester', 'MA', 3),
  c('Granite Coast College', 'Portland', 'ME', 5),
];

/** Real NCAA Division I schools (the best known): no college may have one of these names. */
export const REAL_COLLEGES = `
Duke; North Carolina; Kentucky; Kansas; UCLA; Gonzaga; Villanova; Michigan State; Michigan; Indiana; Purdue;
Syracuse; Arizona; Arizona State; Connecticut; UConn; Louisville; Florida; Florida State; Baylor; Texas; Texas Tech;
Houston; Virginia; Virginia Tech; Wisconsin; Ohio State; Illinois; Iowa; Iowa State; Tennessee; Auburn; Alabama;
Arkansas; LSU; Ole Miss; Mississippi State; Georgetown; Marquette; Creighton; Xavier; Butler; Providence;
St. John's; Seton Hall; DePaul; Notre Dame; Maryland; Oregon; Oregon State; Washington; Washington State;
Stanford; California; USC; Utah; Colorado; BYU; San Diego State; UNLV; Nevada; New Mexico; Memphis; Cincinnati;
Wichita State; Saint Mary's; San Francisco; Santa Clara; Pepperdine; Loyola Marymount; Dayton; VCU; Richmond;
Davidson; Wake Forest; Clemson; Georgia Tech; Georgia; South Carolina; Miami; Pittsburgh; Boston College;
Penn State; Rutgers; Nebraska; Minnesota; Northwestern; Oklahoma; Oklahoma State; TCU; SMU; Rice; Tulane;
Temple; Drexel; Harvard; Yale; Princeton; Penn; Columbia; Cornell; Brown; Dartmouth; Navy; Army; Air Force;
Boise State; Fresno State; Utah State; Colorado State; Wyoming; Montana; Gulf Coast; Florida Gulf Coast;
Oral Roberts; Murray State; Belmont; Vermont; Saint Louis; Loyola Chicago; Bradley; Drake; Valparaiso;
Lehigh; Bucknell; Hofstra; Northeastern; UMass; Rhode Island; Fordham; Manhattan; Iona; Siena; Albany;
Stony Brook; Delaware; Towson; George Mason; George Washington; Howard; Hampton; Old Dominion; Charlotte;
UNC Wilmington; East Carolina; Appalachian State; Liberty; Furman; Wofford; Samford; Chattanooga; Mercer;
Kennesaw State; Georgia State; Jacksonville; North Florida; Stetson; UCF; USF; South Florida; FIU; FAU;
Texas A&M; Texas State; UTEP; UTSA; North Texas; Sam Houston; Lamar; McNeese; Grand Canyon; New Mexico State;
Long Beach State; Cal State Fullerton; UC Irvine; UC Santa Barbara; UC Davis; Hawaii; Seattle; Portland;
Portland State; Gonzaga Bulldogs; Weber State; Idaho; Idaho State; Northern Arizona; Southern Utah;
Kent State; Akron; Toledo; Ohio; Miami (OH); Bowling Green; Ball State; Western Michigan; Central Michigan;
Eastern Michigan; Northern Illinois; Wright State; Cleveland State; Detroit Mercy; Oakland; Green Bay;
Milwaukee; Evansville; Indiana State; Southern Illinois; Missouri; Missouri State; Kansas State; Tulsa;
Arkansas State; Little Rock; Louisiana Tech; Southern Miss; Middle Tennessee; Western Kentucky; Marshall;
West Virginia; Duquesne; Robert Morris; La Salle; Saint Joseph's; Saint Peter's; Monmouth; Rider; Wagner;
`;
