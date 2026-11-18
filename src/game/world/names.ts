// Names for the career world (WORLD_SPEC §1.4): first names and surnames per family of countries, so
// a Lithuanian sounds Lithuanian and a Texan sounds like a Texan. Ordinary, invented-feeling names, not
// parodies; a blocklist rejects the exact names of well-known real players. The generator (../names.ts)
// takes every first × last pair in a seeded order and adds a suffix when they run out, so it always
// finishes.

const split = (s: string) => s.trim().split(/\s+/);

export interface NameFamily {
  first: readonly string[];
  last: readonly string[];
}

export const NAME_FAMILIES: Record<string, NameFamily> = {
  anglo: {
    first: split(`James John Robert Michael William David Richard Joseph Thomas Charles Christopher Daniel Matthew
      Anthony Mark Donald Steven Paul Andrew Joshua Kevin Brian George Timothy Ronald Jason Jeffrey Ryan Jacob Gary
      Nicholas Eric Jonathan Stephen Larry Justin Scott Brandon Benjamin Samuel Gregory Alexander Patrick Frank
      Raymond Jack Dennis Jerry Tyler Aaron Jose Adam Nathan Henry Zachary Douglas Peter Kyle Noah Ethan Jeremy
      Walter Christian Keith Roger Terry Austin Sean Gerald Carl Dylan Harold Jordan Jesse Bryan Lawrence Arthur
      Gabriel Bruce Logan Billy Joe Alan Juan Elijah Willie Albert Wayne Randy Mason Vincent Liam Roy Bobby Caleb
      Bradley Russell Lucas Marcus Darnell Tremaine Jamal Malik Terrence Isaiah Jalen Darius Andre Cedric Devin
      Trey Quentin Reggie Marquis Desmond Rashad Tavon Keon Cameron Jaylen Elliot Grant Shane Wesley Calvin`),
    last: split(`Smith Johnson Williams Brown Jones Miller Davis Wilson Anderson Taylor Thomas Moore Martin Jackson
      Thompson White Harris Clark Lewis Robinson Walker Young Allen King Wright Scott Hill Green Adams Baker Nelson
      Carter Mitchell Roberts Turner Phillips Campbell Parker Evans Edwards Collins Stewart Morris Murphy Cook Rogers
      Morgan Cooper Peterson Reed Bailey Bell Kelly Howard Ward Cox Richardson Wood Watson Brooks Bennett Gray Hughes
      Price Sanders Myers Long Ross Foster Powell Jenkins Perry Russell Sullivan Fisher Henderson Coleman Simmons
      Patterson Jordan Reynolds Hamilton Graham Wallace Woods Cole West Owens Marshall Ellis Harrison Gibson McDonald
      Kennedy Wells Dixon Hayes Ford Hunter Spencer Stone Hawkins Dunn Perkins Hudson Spears Mason Holmes Lane Rhodes
      Barnes Webb Tucker Porter Hunt Black Daniels Palmer Mills Grant Knight Ferguson Rose Burke Shaw Warren Fox
      Bishop Lawson Fields Weaver Banks Holland Freeman Wade Boyd Mathis Pryor Rowland Calloway Whitfield Pettiford`),
  },
  hispanic: {
    first: split(`Alejandro Carlos Javier Diego Sergio Pablo Daniel Adrián Álvaro Marcos Hugo Mario Raúl Víctor Iván
      Rubén Jaime Óscar Guillermo Rodrigo Nicolás Santiago Mateo Lucas Martín Gonzalo Íñigo Unai Joan Pau Jordi Xavier
      Andrés Fernando Ignacio Alberto Emilio Héctor Ramón Tomás`),
    last: split(`García Fernández González Rodríguez López Martínez Sánchez Pérez Gómez Martín Jiménez Ruiz Hernández
      Díaz Moreno Muñoz Álvarez Romero Alonso Gutiérrez Navarro Torres Domínguez Vázquez Ramos Gil Ramírez Serrano
      Blanco Molina Morales Suárez Ortega Delgado Castro Ortiz Rubio Marín Sanz Iglesias Medina Garrido Cortés Castillo
      Santos Lozano Guerrero Cano Prieto Méndez Cruz Calvo Gallego Vidal León Márquez Herrera Peña Flores Cabrera
      Campos Vega Fuentes Carrasco Diez Reyes Caballero Nieto Aguilar Pascual Santana Herrero Lorenzo Montero Hidalgo
      Giménez Ibáñez Ferrer Durán Santiago Benítez Vargas Mora Vicente Arias Carmona Crespo Román Pastor Soto Sáez`),
  },
  lusophone: {
    first: split(`João Pedro Tiago Rui Miguel Diogo Gonçalo Bruno Ricardo André Nuno Hugo Filipe Rafael Luís Paulo Vasco
      Duarte Marco Fábio Lucas Gabriel Mateus Thiago Caio Felipe Leandro Rodrigo Renato Gustavo`),
    last: split(`Silva Santos Ferreira Pereira Oliveira Costa Rodrigues Martins Jesus Sousa Fernandes Gonçalves Gomes
      Lopes Marques Alves Almeida Ribeiro Pinto Carvalho Teixeira Moreira Correia Mendes Nunes Soares Vieira Monteiro
      Cardoso Rocha Raposo Neves Coelho Cruz Cunha Pires Ramos Reis Simões Antunes Matos Fonseca Machado Araújo Barbosa`),
  },
  french: {
    first: split(`Lucas Hugo Louis Gabriel Arthur Jules Mathis Nathan Théo Raphaël Tom Léo Maxime Antoine Baptiste
      Clément Alexandre Thomas Nicolas Julien Romain Quentin Guillaume Florian Kevin Adrien Mathieu Pierre Vincent
      Benoît Yann Olivier Cédric Sébastien Jérémy Damien Mamadou Moussa Ibrahim Samuel`),
    last: split(`Martin Bernard Dubois Thomas Robert Richard Petit Durand Leroy Moreau Simon Laurent Lefebvre Michel
      Garcia David Bertrand Roux Vincent Fournier Morel Girard André Lefèvre Mercier Dupont Lambert Bonnet François
      Martinez Legrand Garnier Faure Rousseau Blanc Guérin Muller Henry Roussel Nicolas Perrin Morin Mathieu Clément
      Gauthier Dumont Lopez Fontaine Chevalier Robin Masson Sanchez Gérard Nguyen Boyer Denis Lemaire Duval Joly
      Gautier Roger Roche Roy Noel Meyer Lucas Meunier Jean Perez Marchand Dufour Blanchard Marie Barbier Brun Dumas
      Brunet Schmitt Leroux Colin Fernandez Pierre Renard Arnaud Rolland Caron Aubert Giraud Leclerc Vidal Bourgeois`),
  },
  italian: {
    first: split(`Alessandro Andrea Matteo Lorenzo Francesco Leonardo Riccardo Gabriele Marco Davide Simone Federico
      Luca Giuseppe Antonio Giovanni Stefano Paolo Daniele Nicola Michele Fabio Roberto Alberto Enrico Filippo Pietro
      Tommaso Edoardo Emanuele Giacomo Mattia Samuele Claudio Massimo`),
    last: split(`Rossi Russo Ferrari Esposito Bianchi Romano Colombo Ricci Marino Greco Bruno Gallo Conti De-Luca
      Mancini Costa Giordano Rizzo Lombardi Moretti Barbieri Fontana Santoro Mariani Rinaldi Caruso Ferrara Galli
      Martini Leone Longo Gentile Martinelli Vitale Lombardo Serra Coppola De-Santis D'Angelo Marchetti Parisi Villa
      Conte Ferraro Ferri Fabbri Bianco Marini Grasso Valentini Messina Sala De-Angelis Gatti Pellegrini Palumbo
      Sanna Farina Rizzi Monti Cattaneo Morelli Amato Silvestri Mazza Testa Grassi Pellegrino Carbone Giuliani Benedetti`),
  },
  german: {
    first: split(`Lukas Leon Finn Jonas Paul Luis Felix Maximilian Elias Noah Ben Tim Jan Niklas Moritz Philipp Tobias
      Julian Fabian Florian Sebastian Daniel Stefan Christian Matthias Andreas Markus Johannes David Simon Jakob
      Marvin Dennis Kai Sven`),
    last: split(`Müller Schmidt Schneider Fischer Weber Meyer Wagner Becker Schulz Hoffmann Schäfer Koch Bauer Richter
      Klein Wolf Schröder Neumann Schwarz Zimmermann Braun Krüger Hofmann Hartmann Lange Schmitt Werner Schmitz Krause
      Meier Lehmann Schmid Schulze Maier Köhler Herrmann König Walter Mayer Huber Kaiser Fuchs Peters Lang Scholz Möller
      Weiß Jung Hahn Schubert Vogel Friedrich Keller Günther Frank Berger Winkler Roth Beck Lorenz Baumann Franke
      Albrecht Schuster Simon Ludwig Böhm Winter Kraus Martin Schumacher Krämer Vogt Stein Jäger Otto Sommer Groß`),
  },
  dutch: {
    first: split(`Daan Sem Lucas Levi Finn Luuk Milan Bram Thijs Jesse Ruben Niels Stijn Tim Koen Jasper Lars Sander
      Bas Joost Wouter Pieter Maarten Jeroen Rick Mike Thomas Dennis Kevin Arjen`),
    last: split(`de-Jong Jansen de-Vries van-den-Berg van-Dijk Bakker Janssen Visser Smit Meijer de-Boer Mulder
      de-Groot Bos Vos Peters Hendriks van-Leeuwen Dekker Brouwer de-Wit Dijkstra Smits de-Graaf van-der-Meer
      van-der-Linden Kok Jacobs de-Haan Vermeulen van-den-Heuvel van-der-Veen van-den-Broek de-Bruijn de-Bruin
      van-der-Heijden Schouten van-Beek Willems van-Vliet van-de-Ven Hoekstra Maas Verhoeven Koster van-Dam`),
  },
  greek: {
    first: split(`Georgios Dimitrios Konstantinos Ioannis Nikolaos Panagiotis Vasileios Christos Athanasios Michail
      Evangelos Spyridon Antonios Ilias Stavros Theodoros Anastasios Emmanouil Petros Apostolos Kyriakos Stefanos
      Alexandros Angelos Charalampos Sotirios Lefteris Thanasis Giannis Kostas`),
    last: split(`Papadopoulos Papadakis Georgiou Oikonomou Dimitriou Konstantinou Nikolaou Ioannou Vlachos Makris
      Antoniou Pappas Karagiannis Vasileiou Papageorgiou Christodoulou Athanasiou Theodorou Panagiotou Alexiou
      Michailidis Georgiadis Papanikolaou Petropoulos Anagnostou Karalis Kontos Sotiropoulos Lambrou Mavros
      Stavrou Tsakalidis Zervas Galanis Kyriakou Raptis Manolis Doukas Chatzis Kostopoulos`),
  },
  turkish: {
    first: split(`Mehmet Mustafa Ahmet Ali Hüseyin Hasan İbrahim İsmail Osman Yusuf Murat Ömer Ramazan Halil Süleyman
      Abdullah Mahmut Recep Emre Burak Can Cem Kaan Serkan Onur Tolga Barış Furkan Berk Doğan Arda Kerem Ege Alper`),
    last: split(`Yılmaz Kaya Demir Şahin Çelik Yıldız Yıldırım Öztürk Aydın Özdemir Arslan Doğan Kılıç Aslan Çetin
      Kara Koç Kurt Özkan Şimşek Polat Özcan Korkmaz Çakır Erdoğan Yavuz Can Acar Şen Aktaş Güler Yalçın Güneş Bozkurt
      Bulut Keskin Ünal Turan Gül Özer Işık Kaplan Avcı Sarı Tekin Taş Köse Yüksel Ateş Aksoy`),
  },
  balkan: {
    first: split(`Nikola Marko Stefan Luka Milan Aleksandar Nemanja Miloš Dušan Uroš Filip Lazar Vuk Bogdan Đorđe
      Vladimir Ivan Petar Ante Mateo Josip Dario Tomislav Mario Matej Jure Domagoj Luka Andrej Žiga Jan Rok Tilen
      Haris Amar Emir Edin Adnan Goran Zoran Dragan Igor Boris Vanja`),
    last: split(`Jovanović Petrović Nikolić Marković Đorđević Stojanović Ilić Stanković Pavlović Milošević Popović
      Đukić Kostić Lazić Simić Tomić Zorić Vasić Ristić Mitrović Babić Horvat Kovačević Knežević Marić Vuković Perić
      Jurić Novak Matić Pavić Kovač Kralj Krajnc Zupan Hodžić Hadžić Delić Kovačić Begić Mujić Radić Vidić Lukić Bošković
      Dragić Savić Šarić Mandić Radović Đurić Nešić Grbić Lončar Vukčević Bulatović Popovski Stojanovski Nikolovski`),
  },
  lithuanian: {
    first: split(`Jonas Mantas Tomas Lukas Paulius Darius Marius Andrius Mindaugas Vytautas Rokas Domantas Arnas
      Edgaras Ignas Justas Karolis Laurynas Matas Nojus Gediminas Saulius Kęstutis Rimantas Žygimantas Deividas`),
    last: split(`Kazlauskas Jankauskas Petrauskas Stankevičius Vasiliauskas Žukauskas Butkus Paulauskas Urbonas
      Kavaliauskas Navickas Ramanauskas Savickas Rimkus Baranauskas Žilinskas Vaitkus Bernotas Lukoševičius
      Mockus Kairys Šimkus Balčiūnas Grigas Valančius Jurevičius Adomaitis Gudaitis Morkūnas Juknevičius`),
  },
  latvian: {
    first: split(`Jānis Andris Edgars Kristaps Dāvis Artūrs Rihards Mārtiņš Roberts Kārlis Raivis Toms Aigars Gints
      Ainārs Ivars Valters Rolands Ēriks Mārcis`),
    last: split(`Bērziņš Kalniņš Ozoliņš Jansons Liepiņš Krūmiņš Balodis Eglītis Zariņš Pētersons Vītols Klaviņš
      Kārkliņš Vanags Lācis Jēkabsons Grīnbergs Siliņš Zālītis Upītis`),
  },
  estonian: {
    first: split(`Martin Rasmus Markus Kristjan Siim Tanel Rain Kaspar Mihkel Andres Priit Margus Taavi Karl Oliver
      Henri Joosep Sander`),
    last: split(`Tamm Saar Sepp Mägi Kask Kukk Rebane Ilves Pärn Koppel Lepik Oja Kuusk Raudsepp Vaher Lill Teder Kõiv`),
  },
  westslavic: {
    first: split(`Jakub Kacper Mateusz Szymon Michał Bartosz Piotr Paweł Tomasz Krzysztof Marcin Łukasz Adam Kamil
      Jan Tomáš Lukáš Ondřej Petr Martin Jiří Vojtěch Matěj Filip David Daniel Marek Patrik`),
    last: split(`Nowak Kowalski Wiśniewski Wójcik Kowalczyk Kamiński Lewandowski Zieliński Szymański Woźniak Dąbrowski
      Kozłowski Jankowski Mazur Kwiatkowski Krawczyk Piotrowski Grabowski Nowakowski Pawłowski Novák Svoboda Novotný
      Dvořák Černý Procházka Kučera Veselý Horák Němec Pokorný Marek Pospíšil Hájek Jelínek Král Růžička Beneš Fiala`),
  },
  hungarian: {
    first: split(`Bence Máté Levente Dávid Dominik Ádám Balázs Péter Gábor Zoltán László Tamás Attila Krisztián
      Norbert Zsolt Márk Botond Gergő Kristóf`),
    last: split(`Nagy Kovács Tóth Szabó Horváth Varga Kiss Molnár Németh Farkas Balogh Papp Takács Juhász Lakatos
      Mészáros Oláh Simon Rácz Fekete Szilágyi Török Fehér Balázs Gál`),
  },
  romanian: {
    first: split(`Andrei Alexandru Mihai Ionuț Ștefan Gabriel Cristian Florin Adrian Vlad Răzvan Bogdan Marius
      Cătălin Sorin Radu Tudor Darius Sebastian Paul`),
    last: split(`Popescu Ionescu Popa Pop Radu Dumitru Stoica Stan Gheorghe Matei Ciobanu Rusu Munteanu Constantin
      Marin Moldovan Lazăr Florea Dobre Barbu Nistor Ene Toma Dinu`),
  },
  bulgarian: {
    first: split(`Georgi Ivan Dimitar Nikolay Petar Hristo Stoyan Todor Aleksandar Martin Kaloyan Yordan Vasil
      Krasimir Plamen Stefan Borislav Radoslav Tsvetan Lyubomir`),
    last: split(`Ivanov Georgiev Dimitrov Petrov Nikolov Hristov Stoyanov Todorov Iliev Atanasov Angelov Vasilev
      Petkov Marinov Kolev Yordanov Popov Stefanov Kostov Mihaylov`),
  },
  nordic: {
    first: split(`Erik Lars Anders Johan Karl Nils Per Mikael Magnus Henrik Oscar Emil William Elias Axel Viktor
      Jonas Mathias Kristian Sindre Eirik Mads Rasmus Frederik Mikkel Jukka Mikko Antti Teemu Lauri Ville`),
    last: split(`Andersson Johansson Karlsson Nilsson Eriksson Larsson Olsson Persson Svensson Gustafsson Hansen
      Johansen Olsen Larsen Andersen Pedersen Nielsen Kristiansen Jensen Berg Haugen Lund Dahl Lindqvist Holm
      Korhonen Virtanen Mäkinen Nieminen Mäkelä Hämäläinen Laine Heikkinen Koskinen Järvinen`),
  },
  israeli: {
    first: split(`Yonatan Omri Itay Noam Daniel Guy Tal Amit Ido Roi Eyal Lior Nadav Yuval Oren Ariel Shay Gal Tomer
      Asaf Elad Avi Ran Ohad Matan Rotem Yarden Erez Dror Gilad Nir Alon Yoav Barak Idan Maor Ofir Raz Shahar Elior`),
    last: split(`Cohen Levi Mizrahi Peretz Biton Dahan Avraham Friedman Azulay Malka Katz Shapira Ben-David Ohana Gabay
      Amar Goldberg Rosen Hadad Vaknin Elbaz Ben-Haim Segal Weiss Sasson Golan Navon Shalom Kaplan Ashkenazi Harel
      Carmeli Zilberman Avital Erez Halevi Yosef Baruch Shemesh Rubin Tzur Dayan Mor Sharabi Levin Ben-Ami Oz`),
  },
  westafrican: {
    first: split(`Chinedu Emeka Obinna Ikenna Chukwuma Tunde Femi Segun Ayo Kunle Mamadou Ousmane Cheikh Babacar
      Ibrahima Moussa Abdoulaye Pape Serge Joel Samuel Franck Arnaud Didier Patrick`),
    last: split(`Okafor Okonkwo Eze Nwosu Adeyemi Oladipo Balogun Ogunleye Adebayo Uche Diop Ndiaye Fall Sarr Faye Gueye
      Ba Cisse Diallo Sow Mbappe Nkoulou Eto Mbia Ngando`),
  },
};

/** Which family of names a country's players have. */
const FAMILY_OF: Record<string, string> = {
  US: 'anglo', CA: 'anglo', AU: 'anglo', GB: 'anglo', IE: 'anglo', ES: 'hispanic', AR: 'hispanic', DO: 'hispanic',
  PR: 'hispanic', PT: 'lusophone', BR: 'lusophone', FR: 'french', BE: 'french', MC: 'french', IT: 'italian',
  DE: 'german', AT: 'german', NL: 'dutch', GR: 'greek', TR: 'turkish', RS: 'balkan', HR: 'balkan', BA: 'balkan',
  ME: 'balkan', SI: 'balkan', MK: 'balkan', LT: 'lithuanian', LV: 'latvian', EE: 'estonian', PL: 'westslavic',
  CZ: 'westslavic', HU: 'hungarian', RO: 'romanian', BG: 'bulgarian', DK: 'nordic', SE: 'nordic', NO: 'nordic',
  FI: 'nordic', NG: 'westafrican', SN: 'westafrican', CM: 'westafrican', IL: 'israeli', SK: 'westslavic', CD: 'french',
  CH: 'french', NZ: 'anglo',
};

export function familyOf(country: string): string {
  return FAMILY_OF[country] ?? 'anglo';
}

/** A surname written with hyphens for its spaces (de-Jong) is shown with spaces. */
export function showName(raw: string): string {
  return raw.replace(/-/g, ' ').replace(/\bDe Luca\b/, 'De Luca');
}

/**
 * Well-known real players (current and recent, NBA and Europe): no generated player may have one of
 * these names exactly (accents and case ignored).
 */
export const FAMOUS_REAL_PLAYERS = `
LeBron James; Stephen Curry; Kevin Durant; Nikola Jokic; Luka Doncic; Giannis Antetokounmpo; Joel Embiid;
Jayson Tatum; Jaylen Brown; Anthony Davis; James Harden; Kawhi Leonard; Paul George; Damian Lillard;
Devin Booker; Donovan Mitchell; Ja Morant; Trae Young; Zion Williamson; Anthony Edwards; Shai Gilgeous-Alexander;
Tyrese Haliburton; Jimmy Butler; Bam Adebayo; Kyrie Irving; Chris Paul; Russell Westbrook; Kevin Love;
Draymond Green; Klay Thompson; Karl-Anthony Towns; Rudy Gobert; Domantas Sabonis; Jalen Brunson; Victor Wembanyama;
Paolo Banchero; Scottie Barnes; Cade Cunningham; Evan Mobley; Jaren Jackson; Desmond Bane; Brandon Ingram;
De'Aaron Fox; Kyle Lowry; DeMar DeRozan; Zach LaVine; Bradley Beal; Kristaps Porzingis; Jrue Holiday;
Michael Jordan; Kobe Bryant; Magic Johnson; Larry Bird; Tim Duncan; Shaquille O'Neal; Dirk Nowitzki;
Tony Parker; Pau Gasol; Marc Gasol; Manu Ginobili; Arvydas Sabonis; Sarunas Jasikevicius; Drazen Petrovic;
Toni Kukoc; Vlade Divac; Peja Stojakovic; Dino Radja; Nikola Mirotic; Sergio Llull; Sergio Rodriguez;
Ricky Rubio; Rudy Fernandez; Juan Carlos Navarro; Felipe Reyes; Vassilis Spanoulis; Theodoros Papaloukas;
Nick Calathes; Kostas Sloukas; Georgios Printezis; Bogdan Bogdanovic; Bojan Bogdanovic; Nikola Vucevic;
Jusuf Nurkic; Goran Dragic; Zoran Dragic; Vasilije Micic; Nemanja Bjelica; Milos Teodosic; Nikola Kalinic;
Facundo Campazzo; Walter Tavares; Edy Tavares; Mike James; Shane Larkin; Will Clyburn; Nando de Colo;
Jonas Valanciunas; Domantas Motiejunas; Mindaugas Kuzminskas; Rokas Jokubaitis; Dennis Schroder; Franz Wagner;
Moritz Wagner; Daniel Theis; Rudy Gobert; Evan Fournier; Nicolas Batum; Frank Ntilikina; Alperen Sengun;
Cedi Osman; Furkan Korkmaz; Ersan Ilyasova; Hedo Turkoglu; Mehmet Okur; Danilo Gallinari; Marco Belinelli;
Andrea Bargnani; Simone Fontecchio; Nicolo Melli; Gigi Datome; Luigi Datome; Achille Polonara;
Jan Vesely; Tomas Satoransky; Kristaps Porzingis; Davis Bertans; Dario Saric; Ivica Zubac; Bojan Bogdanovic;
Mario Hezonja; Dragan Bender; Ante Zizic; Luka Samanic; Jakob Poeltl; Lauri Markkanen; Dennis Smith;
Omri Casspi; Deni Avdija; Gal Mekel; Tal Brody; Lior Eliyahu; Yogev Ohayon; Guy Pnini; Doron Jamchi; Ben Saraf;
Tamir Blatt; Jake Cohen; Rafi Menco; Yam Madar; Bruno Fernando; Neemias Queta; Joao Gomes; Ricardo Pereira;
`;

/** A name for comparing: lower case, no accents, no punctuation. */
export function plainName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ł/g, 'l')
    .replace(/đ/g, 'd')
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const FAMOUS = new Set(FAMOUS_REAL_PLAYERS.split(';').map((n) => plainName(n)).filter(Boolean));

/** Whether a name is exactly a well-known real player's. */
export function isFamousRealName(name: string): boolean {
  return FAMOUS.has(plainName(name));
}

/** A player's id from his name: plain letters and hyphens ("Žiga Krajnc" → "ziga-krajnc"). */
export function idOf(name: string): string {
  return plainName(name).replace(/ /g, '-');
}
