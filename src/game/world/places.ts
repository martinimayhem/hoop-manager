// The career world's places (WORLD_SPEC §1.3, slice brief W1 §2): real cities, invented nicknames
// (checked against real teams' nicknames by a test). Listed from the biggest and most famous
// basketball city down, so bigger cities start higher: in America the first 18 start in the Big
// League and the next 16 in each of Divisions 2, 3 and 4; in each European country the first 12 are
// in its first tier and the next 12 in its second (Portugal: one tier of 12). Big cities host two or
// more clubs, with different nicknames.

export interface Place {
  city: string;
  /** ISO 3166 alpha-2 country code. */
  country: string;
  nickname: string;
  /** US state, for colleges and hometowns. */
  state?: string;
}

const p = (city: string, country: string, nickname: string, state?: string): Place => ({ city, country, nickname, ...(state ? { state } : {}) });

/** The 66 American clubs' places. */
export const AMERICA: Place[] = [
  // Big League, America conference (18)
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
  p('San Diego', 'US', 'Surfriders', 'CA'),
  p('Tampa', 'US', 'Mangroves', 'FL'),
  // US Division 2 (16)
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
  p('Cincinnati', 'US', 'Riverboats', 'OH'),
  p('Kansas City', 'US', 'Fountains', 'MO'),
  // US Division 3 (16)
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
  p('Fort Worth', 'US', 'Stockyards', 'TX'),
  p('El Paso', 'US', 'Mesas', 'TX'),
  // US Division 4 (16)
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
  p('Birmingham', 'US', 'Vulcans', 'AL'),
  p('Virginia Beach', 'US', 'Boardwalks', 'VA'),
];

/**
 * The 11 European countries' clubs (WORLD_SPEC §1.1): 24 each (two tiers of 12), Portugal 12 (one
 * tier). The first clubs of a licence country hold its Big League licences (LICENCES below).
 */
export const EUROPE: Record<string, Place[]> = {
  ES: [
    // Tier 1
    p('Madrid', 'ES', 'Meteors'),
    p('Barcelona', 'ES', 'Breakers'),
    p('Valencia', 'ES', 'Oranges'),
    p('Vitoria', 'ES', 'Foxes'),
    p('Málaga', 'ES', 'Sunbeams'),
    p('Las Palmas', 'ES', 'Canaries'),
    p('Madrid', 'ES', 'Cobalts'),
    p('Barcelona', 'ES', 'Mosaics'),
    p('La Laguna', 'ES', 'Volcanoes'),
    p('Badalona', 'ES', 'Steamers'),
    p('Murcia', 'ES', 'Lemons'),
    p('Bilbao', 'ES', 'Shipwrights'),
    // Tier 2
    p('Zaragoza', 'ES', 'Basilisks'),
    p('Manresa', 'ES', 'Mountaineers'),
    p('Girona', 'ES', 'Ramparts'),
    p('Granada', 'ES', 'Pomegranates'),
    p('Seville', 'ES', 'Flamencos'),
    p('Burgos', 'ES', 'Castellans'),
    p('Lugo', 'ES', 'Romans'),
    p('Palencia', 'ES', 'Harvesters'),
    p('Valladolid', 'ES', 'Vintners'),
    p('Fuenlabrada', 'ES', 'Commuters'),
    p('Oviedo', 'ES', 'Miners'),
    p('Alicante', 'ES', 'Seagulls'),
  ],
  TR: [
    // Tier 1
    p('Istanbul', 'TR', 'Crescents'),
    p('Istanbul', 'TR', 'Ferrymen'),
    p('Ankara', 'TR', 'Angoras'),
    p('Izmir', 'TR', 'Figs'),
    p('Istanbul', 'TR', 'Galleons'),
    p('Bursa', 'TR', 'Silkmen'),
    p('Antalya', 'TR', 'Turtles'),
    p('Gaziantep', 'TR', 'Pistachios'),
    p('Konya', 'TR', 'Whirlers'),
    p('Ankara', 'TR', 'Citadels'),
    p('Izmir', 'TR', 'Breezes'),
    p('Istanbul', 'TR', 'Herons'),
    // Tier 2
    p('Mersin', 'TR', 'Citrus'),
    p('Manisa', 'TR', 'Tulips'),
    p('Bandırma', 'TR', 'Sailors'),
    p('Afyonkarahisar', 'TR', 'Marbles'),
    p('Samsun', 'TR', 'Lighthouses'),
    p('Trabzon', 'TR', 'Anchovies'),
    p('Eskişehir', 'TR', 'Meerschaums'),
    p('Kayseri', 'TR', 'Summits'),
    p('Denizli', 'TR', 'Roosters'),
    p('Adana', 'TR', 'Cottons'),
    p('Edirne', 'TR', 'Wrestlers'),
    p('Tekirdağ', 'TR', 'Vineyards'),
  ],
  GR: [
    // Tier 1
    p('Athens', 'GR', 'Owls'),
    p('Piraeus', 'GR', 'Triremes'),
    p('Athens', 'GR', 'Columns'),
    p('Thessaloniki', 'GR', 'Cormorants'),
    p('Thessaloniki', 'GR', 'Byzantines'),
    p('Peristeri', 'GR', 'Doves'),
    p('Marousi', 'GR', 'Olympians'),
    p('Patras', 'GR', 'Vintners'),
    p('Heraklion', 'GR', 'Minotaurs'),
    p('Larissa', 'GR', 'Horsemen'),
    p('Lavrio', 'GR', 'Silvermen'),
    p('Ioannina', 'GR', 'Silversmiths'),
    // Tier 2
    p('Volos', 'GR', 'Argonauts'),
    p('Kavala', 'GR', 'Harbourmen'),
    p('Rhodes', 'GR', 'Deer'),
    p('Chania', 'GR', 'Lighthouses'),
    p('Kalamata', 'GR', 'Olives'),
    p('Trikala', 'GR', 'Monks'),
    p('Karditsa', 'GR', 'Plainsmen'),
    p('Chalkida', 'GR', 'Tides'),
    p('Corfu', 'GR', 'Kumquats'),
    p('Komotini', 'GR', 'Thracians'),
    p('Serres', 'GR', 'Shepherds'),
    p('Lamia', 'GR', 'Hoplites'),
  ],
  IT: [
    // Tier 1
    p('Milan', 'IT', 'Herons'),
    p('Bologna', 'IT', 'Porticos'),
    p('Bologna', 'IT', 'Scholars'),
    p('Rome', 'IT', 'Centurions'),
    p('Venice', 'IT', 'Gondoliers'),
    p('Varese', 'IT', 'Gardeners'),
    p('Brescia', 'IT', 'Ironmen'),
    p('Trento', 'IT', 'Alpinists'),
    p('Sassari', 'IT', 'Corals'),
    p('Tortona', 'IT', 'Cyclists'),
    p('Treviso', 'IT', 'Canals'),
    p('Reggio Emilia', 'IT', 'Tricolours'),
    // Tier 2
    p('Pesaro', 'IT', 'Fishermen'),
    p('Cremona', 'IT', 'Violins'),
    p('Naples', 'IT', 'Vesuvians'),
    p('Turin', 'IT', 'Spires'),
    p('Trieste', 'IT', 'Boras'),
    p('Brindisi', 'IT', 'Columns'),
    p('Cantù', 'IT', 'Carpenters'),
    p('Pistoia', 'IT', 'Blacksmiths'),
    p('Scafati', 'IT', 'Tomatoes'),
    p('Udine', 'IT', 'Castles'),
    p('Verona', 'IT', 'Balconies'),
    p('Cagliari', 'IT', 'Flamingos'),
  ],
  FR: [
    // Tier 1
    p('Paris', 'FR', 'Swifts'),
    p('Lyon', 'FR', 'Larks'),
    p('Paris', 'FR', 'Gargoyles'),
    p('Strasbourg', 'FR', 'Steeples'),
    p('Le Mans', 'FR', 'Roadsters'),
    p('Limoges', 'FR', 'Porcelains'),
    p('Nanterre', 'FR', 'Terraces'),
    p('Bourg-en-Bresse', 'FR', 'Roosters'),
    p('Dijon', 'FR', 'Mustards'),
    p('Cholet', 'FR', 'Weavers'),
    p('Pau', 'FR', 'Pyreneans'),
    p('Gravelines', 'FR', 'Dunes'),
    // Tier 2
    p('Le Portel', 'FR', 'Fishers'),
    p('Chalon-sur-Saône', 'FR', 'Barges'),
    p('Roanne', 'FR', 'Railmen'),
    p('Nancy', 'FR', 'Thistles'),
    p('Orléans', 'FR', 'Arrows'),
    p('Boulogne', 'FR', 'Herrings'),
    p('Saint-Quentin', 'FR', 'Lacemakers'),
    p('Antibes', 'FR', 'Yachts'),
    p('Fos-sur-Mer', 'FR', 'Refiners'),
    p('Rouen', 'FR', 'Cathedrals'),
    p('Nantes', 'FR', 'Elephants'),
    p('Marseille', 'FR', 'Calanques'),
  ],
  DE: [
    // Tier 1
    p('Munich', 'DE', 'Alpines'),
    p('Berlin', 'DE', 'Sparrows'),
    p('Berlin', 'DE', 'Trams'),
    p('Bamberg', 'DE', 'Bellringers'),
    p('Ulm', 'DE', 'Tinkers'),
    p('Ludwigsburg', 'DE', 'Palaces'),
    p('Oldenburg', 'DE', 'Moorlanders'),
    p('Bonn', 'DE', 'Composers'),
    p('Hamburg', 'DE', 'Tugboats'),
    p('Frankfurt', 'DE', 'Bankers'),
    p('Würzburg', 'DE', 'Bishops'),
    p('Chemnitz', 'DE', 'Engineers'),
    // Tier 2
    p('Göttingen', 'DE', 'Professors'),
    p('Braunschweig', 'DE', 'Merchants'),
    p('Bayreuth', 'DE', 'Tenors'),
    p('Heidelberg', 'DE', 'Philosophers'),
    p('Rostock', 'DE', 'Hanseatics'),
    p('Vechta', 'DE', 'Ploughmen'),
    p('Weißenfels', 'DE', 'Shoemakers'),
    p('Gießen', 'DE', 'Rivermen'),
    p('Crailsheim', 'DE', 'Horses'),
    p('Bremerhaven', 'DE', 'Trawlers'),
    p('Cologne', 'DE', 'Carnivals'),
    p('Düsseldorf', 'DE', 'Painters'),
  ],
  IL: [
    // Tier 1
    p('Tel Aviv', 'IL', 'Boulevards'),
    p('Jerusalem', 'IL', 'Stones'),
    p('Tel Aviv', 'IL', 'Jaffas'),
    p('Haifa', 'IL', 'Carmels'),
    p('Holon', 'IL', 'Sands'),
    p('Jerusalem', 'IL', 'Pilgrims'),
    p('Rishon LeZion', 'IL', 'Cellars'),
    p("Be'er Sheva", 'IL', 'Camels'),
    p('Herzliya', 'IL', 'Surfers'),
    p('Nahariya', 'IL', 'Coasters'),
    p('Haifa', 'IL', 'Dockers'),
    p('Tel Aviv', 'IL', 'Kingfishers'),
    // Tier 2
    p('Ashdod', 'IL', 'Cranes'),
    p('Ashkelon', 'IL', 'Sycamores'),
    p('Netanya', 'IL', 'Diamonds'),
    p('Ramat Gan', 'IL', 'Jewellers'),
    p('Petah Tikva', 'IL', 'Pioneers'),
    p('Eilat', 'IL', 'Reefs'),
    p('Kiryat Ata', 'IL', 'Spinners'),
    p('Hadera', 'IL', 'Eucalypts'),
    p('Rehovot', 'IL', 'Orchards'),
    p("Ra'anana", 'IL', 'Oaks'),
    p('Kfar Saba', 'IL', 'Meadows'),
    p('Bat Yam', 'IL', 'Mermaids'),
  ],
  LT: [
    // Tier 1
    p('Kaunas', 'LT', 'Ambers'),
    p('Vilnius', 'LT', 'Storks'),
    p('Kaunas', 'LT', 'Ironwood'),
    p('Klaipėda', 'LT', 'Lagoons'),
    p('Panevėžys', 'LT', 'Glassmakers'),
    p('Šiauliai', 'LT', 'Crosses'),
    p('Vilnius', 'LT', 'Baroques'),
    p('Alytus', 'LT', 'Pinecones'),
    p('Utena', 'LT', 'Lakelanders'),
    p('Marijampolė', 'LT', 'Riders'),
    p('Klaipėda', 'LT', 'Sails'),
    p('Vilnius', 'LT', 'Bisons'),
    // Tier 2
    p('Jonava', 'LT', 'Chemists'),
    p('Kėdainiai', 'LT', 'Cucumbers'),
    p('Prienai', 'LT', 'Elks'),
    p('Telšiai', 'LT', 'Samogitians'),
    p('Mažeikiai', 'LT', 'Refiners'),
    p('Druskininkai', 'LT', 'Springs'),
    p('Raseiniai', 'LT', 'Horsemen'),
    p('Tauragė', 'LT', 'Hussars'),
    p('Plungė', 'LT', 'Manors'),
    p('Visaginas', 'LT', 'Atoms'),
    p('Kretinga', 'LT', 'Gardeners'),
    p('Palanga', 'LT', 'Piers'),
  ],
  RS: [
    // Tier 1
    p('Belgrade', 'RS', 'Kestrels'),
    p('Belgrade', 'RS', 'Sentinels'),
    p('Belgrade', 'RS', 'Bridgemen'),
    p('Novi Sad', 'RS', 'Fortresses'),
    p('Niš', 'RS', 'Emperors'),
    p('Kragujevac', 'RS', 'Gunsmiths'),
    p('Subotica', 'RS', 'Windmills'),
    p('Čačak', 'RS', 'Plums'),
    p('Kraljevo', 'RS', 'Crowns'),
    p('Zlatibor', 'RS', 'Pines'),
    p('Novi Sad', 'RS', 'Danubians'),
    p('Belgrade', 'RS', 'Kites'),
    // Tier 2
    p('Vršac', 'RS', 'Vintners'),
    p('Novi Pazar', 'RS', 'Bazaars'),
    p('Smederevo', 'RS', 'Steelmen'),
    p('Šabac', 'RS', 'Fairs'),
    p('Valjevo', 'RS', 'Mills'),
    p('Zrenjanin', 'RS', 'Barges'),
    p('Kruševac', 'RS', 'Princes'),
    p('Pančevo', 'RS', 'Engines'),
    p('Sombor', 'RS', 'Horsemen'),
    p('Leskovac', 'RS', 'Peppers'),
    p('Užice', 'RS', 'Ridges'),
    p('Sremska Mitrovica', 'RS', 'Sirmians'),
  ],
  NL: [
    // Tier 1
    p('Amsterdam', 'NL', 'Tulips'),
    p('Groningen', 'NL', 'Northmen'),
    p('Rotterdam', 'NL', 'Dockers'),
    p('Den Bosch', 'NL', 'Dragons'),
    p('Leiden', 'NL', 'Keys'),
    p('Zwolle', 'NL', 'Hanzemen'),
    p('The Hague', 'NL', 'Diplomats'),
    p('Utrecht', 'NL', 'Canalboats'),
    p('Amsterdam', 'NL', 'Cyclists'),
    p('Rotterdam', 'NL', 'Bridges'),
    p('Den Helder', 'NL', 'Admirals'),
    p('Eindhoven', 'NL', 'Lamplighters'),
    // Tier 2
    p('Apeldoorn', 'NL', 'Forests'),
    p('Nijmegen', 'NL', 'Bridges'),
    p('Haarlem', 'NL', 'Clocks'),
    p('Almere', 'NL', 'Polders'),
    p('Arnhem', 'NL', 'Hills'),
    p('Enschede', 'NL', 'Mills'),
    p('Breda', 'NL', 'Barons'),
    p('Tilburg', 'NL', 'Textiles'),
    p('Maastricht', 'NL', 'Grottos'),
    p('Weert', 'NL', 'Weavers'),
    p('Delft', 'NL', 'Potters'),
    p('Zaandam', 'NL', 'Millers'),
  ],
  PT: [
    // Tier 1
    p('Lisbon', 'PT', 'Navigators'),
    p('Porto', 'PT', 'Rabelos'),
    p('Lisbon', 'PT', 'Trams'),
    p('Porto', 'PT', 'Cellars'),
    p('Braga', 'PT', 'Archbishops'),
    p('Coimbra', 'PT', 'Scholars'),
    p('Guimarães', 'PT', 'Founders'),
    p('Aveiro', 'PT', 'Lagoons'),
    p('Setúbal', 'PT', 'Sardines'),
    p('Faro', 'PT', 'Lighthouses'),
    p('Funchal', 'PT', 'Levadas'),
    p('Viseu', 'PT', 'Granites'),
  ],
};

/** The European countries, in the order the screens list them. */
export const EUROPE_COUNTRIES = Object.keys(EUROPE);

/** Big League Europe licences per country (WORLD_SPEC §1.2, agreed 18 Nov 2026). */
export const LICENCES: Record<string, number> = { ES: 2, TR: 2, GR: 1, IT: 1, FR: 1, DE: 1, IL: 1, LT: 1 };

/** For a national league's name: "Spanish League", "Spanish League 2". */
export const LEAGUE_ADJECTIVE: Record<string, string> = {
  ES: 'Spanish', TR: 'Turkish', GR: 'Greek', IT: 'Italian', FR: 'French', DE: 'German', IL: 'Israeli', LT: 'Lithuanian',
  RS: 'Serbian', NL: 'Dutch', PT: 'Portuguese',
};

/** Country names, for the screens. */
export const COUNTRY_NAME: Record<string, string> = {
  US: 'United States', CA: 'Canada', ES: 'Spain', TR: 'Türkiye', GR: 'Greece', RS: 'Serbia', IT: 'Italy', LT: 'Lithuania',
  FR: 'France', DE: 'Germany', IL: 'Israel', NL: 'Netherlands', PT: 'Portugal', HR: 'Croatia', GB: 'United Kingdom',
  BE: 'Belgium', SI: 'Slovenia', LV: 'Latvia', PL: 'Poland', CZ: 'Czechia', ME: 'Montenegro', BA: 'Bosnia and Herzegovina',
  AU: 'Australia', NG: 'Nigeria', SN: 'Senegal', CM: 'Cameroon', BR: 'Brazil', AR: 'Argentina', DO: 'Dominican Republic',
  PR: 'Puerto Rico', CD: 'DR Congo', CH: 'Switzerland', NZ: 'New Zealand', CN: 'China', SE: 'Sweden', FI: 'Finland',
  SK: 'Slovakia', MK: 'North Macedonia',
};

/** Three-letter codes, for narrow tables ("USA", "LTU"). */
export const COUNTRY_CODE3: Record<string, string> = {
  US: 'USA', CA: 'CAN', ES: 'ESP', TR: 'TUR', GR: 'GRE', RS: 'SRB', IT: 'ITA', LT: 'LTU', FR: 'FRA', DE: 'GER', IL: 'ISR',
  NL: 'NED', PT: 'POR', HR: 'CRO', GB: 'GBR', BE: 'BEL', SI: 'SLO', LV: 'LAT', PL: 'POL', CZ: 'CZE', ME: 'MNE', BA: 'BIH',
  AU: 'AUS', NG: 'NGR', SN: 'SEN', CM: 'CMR', BR: 'BRA', AR: 'ARG', DO: 'DOM', PR: 'PUR', CD: 'COD', CH: 'SUI', NZ: 'NZL',
  CN: 'CHN', SE: 'SWE', FI: 'FIN', SK: 'SVK', MK: 'MKD',
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
