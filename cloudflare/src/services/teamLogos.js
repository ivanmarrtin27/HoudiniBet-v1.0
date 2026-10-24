/**
 * Public crest URLs via API-Sports media CDN (no API key needed to display).
 * Keys: normalizeTeamName(name) → AF team id.
 * When AF media serves a broken/placeholder crest, prefer FotMob CDN overrides.
 */

const MEDIA = 'https://media.api-sports.io/football/teams';
const FOTMOB_MEDIA = 'https://images.fotmob.com/image_resources/logo/teamlogo';

/** AF media team ids known to serve a wrong/placeholder crest PNG. */
const AF_BROKEN_LOGO_IDS = new Set([
  1102, // RC Deportivo — CDN returns striped placeholder, not the club crest
  85, // PSG — AF media often wrong vs current crest; force FotMob
  3751, // Elche — AF media unreliable; force FotMob
  168, // Leverkusen — force FotMob so D1/client aliases always rewrite
]);

/**
 * FotMob teamlogo ids for clubs where AF media is broken or missing.
 * Checked before CLUB_IDS. Keys: normalizeTeamName(name).
 * @type {Record<string, number>}
 */
const FOTMOB_CLUB_IDS = {
  'rc deportivo': 9783,
  'rc deportivo de la coruna': 9783,
  'deportivo la coruna': 9783,
  'deportivo a coruna': 9783,
  'deportivo de la coruna': 9783,
  // Bare "deportivo" = A Coruña in our leagues (Alavés uses "deportivo alaves").
  deportivo: 9783,
  // PSG / Elche: force FotMob (AF media or D1 URL often wrong / collides with "paris").
  'paris saint germain': 9847,
  'paris saint-germain': 9847,
  'paris saint germain fc': 9847,
  'paris saint-germain fc': 9847,
  'paris sg': 9847,
  'paris s g': 9847,
  psg: 9847,
  elche: 10268,
  'elche cf': 10268,
  // Bayer Leverkusen — client often only had bare "leverkusen"; force FotMob.
  'bayer leverkusen': 8178,
  'bayer 04 leverkusen': 8178,
  'bayer 04': 8178,
  leverkusen: 8178,
  'bayer leverkusen fc': 8178,
};

/** @type {Record<string, number>} */
const CLUB_IDS = {
  // —— La Liga ——
  alaves: 542,
  'deportivo alaves': 542,
  'athletic club': 531,
  'athletic bilbao': 531,
  'ath bilbao': 531,
  'atletico madrid': 530,
  'atletico de madrid': 530,
  'atl madrid': 530,
  barcelona: 529,
  'fc barcelona': 529,
  celta: 538,
  'celta vigo': 538,
  'celta de vigo': 538,
  'rc celta': 538,
  elche: 3751,
  'elche cf': 3751,
  espanyol: 540,
  'rcd espanyol': 540,
  'rcd espanyol de barcelona': 540,
  getafe: 546,
  'getafe cf': 546,
  girona: 547,
  'girona fc': 547,
  levante: 539,
  'levante ud': 539,
  mallorca: 798,
  'rcd mallorca': 798,
  malaga: 535,
  'malaga cf': 535,
  osasuna: 727,
  'ca osasuna': 727,
  'rayo vallecano': 728,
  'real betis': 543,
  betis: 543,
  'real madrid': 541,
  'real oviedo': 718,
  oviedo: 718,
  'racing santander': 731,
  'racing de santander': 731,
  racing: 731,
  'r. racing club': 731,
  'r racing club': 731,
  'real sociedad': 548,
  sevilla: 536,
  'sevilla fc': 536,
  valencia: 532,
  'valencia cf': 532,
  villarreal: 533,
  'villarreal cf': 533,
  // RC Deportivo: AF id 1102 exists but media CDN crest is broken — see FOTMOB_CLUB_IDS.
  'rc deportivo': 1102,
  'rc deportivo de la coruna': 1102,
  'deportivo la coruna': 1102,
  'deportivo a coruna': 1102,
  'deportivo de la coruna': 1102,
  deportivo: 1102,

  // —— Premier League ——
  arsenal: 42,
  'aston villa': 66,
  bournemouth: 35,
  'afc bournemouth': 35,
  brentford: 55,
  brighton: 51,
  'brighton and hove albion': 51,
  chelsea: 49,
  'crystal palace': 52,
  everton: 45,
  fulham: 36,
  ipswich: 57,
  'ipswich town': 57,
  leicester: 46,
  'leicester city': 46,
  liverpool: 40,
  'manchester city': 50,
  'man city': 50,
  'manchester united': 33,
  'man united': 33,
  'man utd': 33,
  newcastle: 34,
  'newcastle united': 34,
  'nottingham forest': 65,
  'nottm forest': 65,
  southampton: 41,
  tottenham: 47,
  'tottenham hotspur': 47,
  spurs: 47,
  'west ham': 48,
  'west ham united': 48,
  wolves: 39,
  wolverhampton: 39,
  'wolverhampton wanderers': 39,
  burnley: 44,
  leeds: 63,
  'leeds united': 63,
  sunderland: 746,
  hull: 64,
  'hull city': 64,
  coventry: 1346,
  'coventry city': 1346,

  // —— Serie A ——
  'ac milan': 489,
  milan: 489,
  inter: 505,
  'inter milan': 505,
  internazionale: 505,
  juventus: 496,
  napoli: 492,
  'ssc napoli': 492,
  roma: 497,
  'as roma': 497,
  lazio: 487,
  atalanta: 499,
  fiorentina: 502,
  bologna: 500,
  torino: 503,
  udinese: 494,
  genoa: 495,
  cagliari: 490,
  empoli: 511,
  monza: 1579,
  lecce: 867,
  verona: 504,
  'hellas verona': 504,
  como: 895,
  'como 1907': 895,
  parma: 523,
  'parma calcio': 523,
  venezia: 517,
  'venezia fc': 517,
  sassuolo: 488,
  'us sassuolo': 488,
  frosinone: 512,
  'frosinone calcio': 512,

  // —— Bundesliga ——
  'bayern munich': 157,
  'bayern munchen': 157,
  'fc bayern munchen': 157,
  'fc bayern munich': 157,
  'borussia dortmund': 165,
  dortmund: 165,
  bvb: 165,
  'rb leipzig': 173,
  leipzig: 173,
  'bayer leverkusen': 168,
  'bayer 04 leverkusen': 168,
  'bayer 04': 168,
  leverkusen: 168,
  'bayer leverkusen fc': 168,
  'eintracht frankfurt': 169,
  frankfurt: 169,
  wolfsburg: 161,
  'vfl wolfsburg': 161,
  'borussia monchengladbach': 163,
  monchengladbach: 163,
  hoffenheim: 167,
  'tsg hoffenheim': 167,
  freiburg: 160,
  'sc freiburg': 160,
  'sport-club freiburg': 160,
  'sport club freiburg': 160,
  mainz: 164,
  'mainz 05': 164,
  'fsv mainz 05': 164,
  '1. fsv mainz 05': 164,
  '1 fsv mainz 05': 164,
  augsburg: 170,
  'fc augsburg': 170,
  stuttgart: 172,
  'vfb stuttgart': 172,
  'werder bremen': 162,
  'sv werder bremen': 162,
  bremen: 162,
  'union berlin': 182,
  '1. fc union berlin': 182,
  '1 fc union berlin': 182,
  heidenheim: 180,
  '1. fc heidenheim': 180,
  bochum: 176,
  'vfl bochum': 176,
  'st pauli': 186,
  'fc st. pauli': 186,
  'fc st pauli': 186,
  'holstein kiel': 191,
  koln: 192,
  '1. fc koln': 192,
  '1 fc koln': 192,
  'fc koln': 192,
  cologne: 192,
  paderborn: 185,
  'sc paderborn': 185,
  'sc paderborn 07': 185,
  elversberg: 1357,
  'sv elversberg': 1357,
  schalke: 159,
  'fc schalke 04': 159,
  'schalke 04': 159,
  'hamburger sv': 174,
  hamburg: 174,
  hsv: 174,

  // —— Ligue 1 ——
  'paris saint germain': 85,
  'paris saint-germain': 85,
  'paris saint germain fc': 85,
  'paris saint-germain fc': 85,
  'paris sg': 85,
  'paris s g': 85,
  psg: 85,
  marseille: 81,
  'olympique marseille': 81,
  'olympique de marseille': 81,
  om: 81,
  lyon: 80,
  'olympique lyonnais': 80,
  monaco: 91,
  'as monaco': 91,
  lille: 79,
  'losc lille': 79,
  nice: 84,
  'ogc nice': 84,
  rennes: 94,
  'stade rennais': 94,
  lens: 116,
  'rc lens': 116,
  strasbourg: 95,
  'rc strasbourg': 95,
  'rc strasbourg alsace': 95,
  nantes: 83,
  'fc nantes': 83,
  toulouse: 96,
  'toulouse fc': 96,
  reims: 93,
  'stade de reims': 93,
  montpellier: 82,
  'montpellier hsc': 82,
  brest: 106,
  'stade brestois': 106,
  'stade brestois 29': 106,
  auxerre: 108,
  'aj auxerre': 108,
  angers: 77,
  'angers sco': 77,
  'le havre': 111,
  'le havre ac': 111,
  'havre athletic club': 111,
  'saint etienne': 1063,
  'as saint-etienne': 1063,
  'as saint etienne': 1063,
  'paris fc': 1113,
  'estac troyes': 110,
  troyes: 110,
  lorient: 97,
  'fc lorient': 97,
  'le mans': 129,
  'le mans fc': 129,

  // —— UEFA cups / FD short names ——
  'az alkmaar': 201,
  az: 201,
  anderlecht: 554,
  'rsc anderlecht': 554,
  'ararat armenia': 3424,
  'ararat-armenia': 3424,
  benfica: 211,
  'sl benfica': 211,
  besiktas: 549,
  'besiktas jk': 549,
  celtic: 247,
  'celtic fc': 247,
  'dinamo zagreb': 620,
  'gnk dinamo': 620,
  'gnk dinamo zagreb': 620,
  ferencvaros: 651,
  'ferencvarosi tc': 651,
  'hapoel beer sheva': 420,
  'h. beer-sheva': 420,
  'h beer sheva': 420,
  jagiellonia: 347,
  'jagiellonia bialystok': 347,
  'lech poznan': 339,
  'levski sofia': 565,
  lillestrom: 327,
  'lillestrom sk': 327,
  'nec nijmegen': 413,
  nec: 413,
  'n.e.c.': 413,
  'n e c': 413,
  celje: 696,
  'nk celje': 696,
  'ofi crete': 545,
  ofi: 545,
  olympiacos: 553,
  'olympiacos piraeus': 553,
  omonia: 558,
  'omonia nicosia': 558,
  salzburg: 571,
  'rb salzburg': 571,
  'red bull salzburg': 571,
  'fc salzburg': 571,
  'sparta prague': 570,
  'sparta praha': 570,
  'ac sparta praha': 570,
  'sturm graz': 568,
  'sk sturm graz': 568,
  torreense: 4758,
  'union st.gilloise': 1393,
  'union st gilloise': 1393,
  'union sg': 1393,
  'royale union sg': 1393,
  'viktoria plzen': 567,
  'fc viktoria plzen': 567,
  'club brugge': 569,
  brugge: 569,
  'bodo glimt': 311,
  'bod o glimt': 311,
  'fk bodo glimt': 311,
  atleti: 530,
  'b. dortmund': 165,
  'b dortmund': 165,
  feyenoord: 209,
  'feyenoord rotterdam': 209,
  fenerbahce: 611,
  galatasaray: 645,
  porto: 212,
  'fc porto': 212,
  'sporting cp': 228,
  sporting: 228,
  'sporting lisbon': 228,
  psv: 197,
  'psv eindhoven': 197,
  shakhtar: 556,
  'shakhtar donetsk': 556,
  'slavia praha': 560,
  'slavia prague': 560,
  'sk slavia praha': 560,
  's. bratislava': 572,
  'slovan bratislava': 572,
  'sk slovan bratislava': 572,
  lask: 652,
  'lask linz': 652,
  sabah: 13988,
  'aek athens': 557,
  aek: 557,
  viking: 320,
  'viking fk': 320,
  paris: 85,
};

/** Flagcdn ISO2 for national teams (keys = normalizeTeamName). */
const TEAM_FLAG_ISO = {
  spain: 'es',
  england: 'gb-eng',
  italy: 'it',
  germany: 'de',
  france: 'fr',
  portugal: 'pt',
  netherlands: 'nl',
  belgium: 'be',
  brazil: 'br',
  argentina: 'ar',
  mexico: 'mx',
  wales: 'gb-wls',
  scotland: 'gb-sct',
  'northern ireland': 'gb-nir',
  norway: 'no',
  sweden: 'se',
  denmark: 'dk',
  austria: 'at',
  switzerland: 'ch',
  poland: 'pl',
  croatia: 'hr',
  serbia: 'rs',
  greece: 'gr',
  turkey: 'tr',
  turkiye: 'tr',
  ukraine: 'ua',
  ireland: 'ie',
  'republic of ireland': 'ie',
  iceland: 'is',
  finland: 'fi',
  romania: 'ro',
  hungary: 'hu',
  czechia: 'cz',
  'czech republic': 'cz',
  slovakia: 'sk',
  slovenia: 'si',
  bulgaria: 'bg',
  albania: 'al',
  'north macedonia': 'mk',
  bosnia: 'ba',
  'bosnia and herzegovina': 'ba',
  montenegro: 'me',
  kosovo: 'xk',
  malta: 'mt',
  gibraltar: 'gi',
  liechtenstein: 'li',
  andorra: 'ad',
  'san marino': 'sm',
  luxembourg: 'lu',
  cyprus: 'cy',
  georgia: 'ge',
  armenia: 'am',
  azerbaijan: 'az',
  kazakhstan: 'kz',
  israel: 'il',
  russia: 'ru',
  moldova: 'md',
  belarus: 'by',
  latvia: 'lv',
  lithuania: 'lt',
  estonia: 'ee',
  'faroe islands': 'fo',
  japan: 'jp',
  'south korea': 'kr',
  korea: 'kr',
  australia: 'au',
  canada: 'ca',
  'united states': 'us',
  usa: 'us',
  colombia: 'co',
  chile: 'cl',
  uruguay: 'uy',
  peru: 'pe',
  ecuador: 'ec',
  paraguay: 'py',
  venezuela: 've',
  bolivia: 'bo',
  morocco: 'ma',
  egypt: 'eg',
  nigeria: 'ng',
  senegal: 'sn',
  ghana: 'gh',
  cameroon: 'cm',
  'ivory coast': 'ci',
  "cote d'ivoire": 'ci',
  'cote d ivoire': 'ci',
  algeria: 'dz',
  tunisia: 'tn',
  guinea: 'gn',
  kenya: 'ke',
  namibia: 'na',
  mali: 'ml',
  uganda: 'ug',
  angola: 'ao',
  benin: 'bj',
  'burkina faso': 'bf',
  comoros: 'km',
  gambia: 'gm',
  malawi: 'mw',
  niger: 'ne',
  'south africa': 'za',
  'dr congo': 'cd',
  congo: 'cg',
  'democratic republic of the congo': 'cd',
  jamaica: 'jm',
  'costa rica': 'cr',
  panama: 'pa',
  honduras: 'hn',
  'el salvador': 'sv',
  guatemala: 'gt',
  haiti: 'ht',
  nicaragua: 'ni',
  belize: 'bz',
  cuba: 'cu',
  bahamas: 'bs',
  aruba: 'aw',
  bonaire: 'bq',
  'dominican republic': 'do',
  'puerto rico': 'pr',
  'cayman islands': 'ky',
  'british virgin islands': 'vg',
  'u.s. virgin islands': 'vi',
  'us virgin islands': 'vi',
  anguilla: 'ai',
  montserrat: 'ms',
  'antigua and barbuda': 'ag',
  'saint martin': 'mf',
  'sint maarten': 'sx',
  'trinidad and tobago': 'tt',
  curacao: 'cw',
  suriname: 'sr',
  guyana: 'gy',
  dominica: 'dm',
  grenada: 'gd',
  barbados: 'bb',
  bermuda: 'bm',
  'saint lucia': 'lc',
  'st lucia': 'lc',
  'saint vincent and the grenadines': 'vc',
  'st. vincent and the grenadines': 'vc',
  'st vincent and the grenadines': 'vc',
  'st. kitts and nevis': 'kn',
  'saint kitts and nevis': 'kn',
  'st kitts and nevis': 'kn',
  martinique: 'mq',
  guadeloupe: 'gp',
  'french guiana': 'gf',
  'turks and caicos islands': 'tc',
  thailand: 'th',
  philippines: 'ph',
  vietnam: 'vn',
  china: 'cn',
  palestine: 'ps',
  pakistan: 'pk',
  india: 'in',
  indonesia: 'id',
  malaysia: 'my',
  cambodia: 'kh',
  'hong kong': 'hk',
  'new zealand': 'nz',
  fiji: 'fj',
  vanuatu: 'vu',
  uzbekistan: 'uz',
  kyrgyzstan: 'kg',
  lebanon: 'lb',
  jordan: 'jo',
  tajikistan: 'tj',
  mauritius: 'mu',
  'sri lanka': 'lk',
};

export function normalizeTeamName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/å/g, 'a')
    .replace(/ł/g, 'l')
    .replace(/đ/g, 'd')
    .replace(/&/g, ' and ')
    .replace(/\//g, ' ')
    .replace(/nott'?m\b/g, 'nottm')
    .replace(/[^a-z0-9.\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clubLookupKeys(key) {
  const keys = [key];
  const stripped = key
    .replace(/^\d+\.\s*/, '')
    .replace(/^\d+\s+/, '')
    .replace(
      /^(fc|cf|ac|as|ssc|rc|rcd|ca|ud|cd|sc|sv|vfl|vfb|tsg|ogc|losc|us|aj|estac|gnk|nk|sk|fk|rsc|sl|sport-club|sport club)\s+/i,
      ''
    )
    .replace(/\s+(fc|cf|ac|afc|sc|cf|sv|jk|tc)$/i, '')
    .replace(/\s+04$/, '')
    .trim();
  if (stripped && stripped !== key) keys.push(stripped);
  const no04 = key.replace(/\b04\b/g, '').replace(/\s+/g, ' ').trim();
  if (no04 && no04 !== key) keys.push(no04);
  const noDots = key.replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  if (noDots && noDots !== key) keys.push(noDots);
  return keys;
}

function isFotmobCrestUrl(url) {
  return /images\.fotmob\.com\/image_resources\/logo\/teamlogo\//i.test(String(url || ''));
}

function isFlagCdnUrl(url) {
  return /flagcdn\.com\//i.test(String(url || ''));
}

function apiSportsTeamIdFromUrl(url) {
  const m = String(url || '').match(/media\.api-sports\.io\/football\/teams\/(\d+)\.png/i);
  return m ? Number(m[1]) : null;
}

export function clubLogoUrl(name) {
  const key = normalizeTeamName(name);
  if (!key) return null;
  for (const k of clubLookupKeys(key)) {
    const fmId = FOTMOB_CLUB_IDS[k];
    if (fmId != null) return `${FOTMOB_MEDIA}/${fmId}.png`;
  }
  for (const k of clubLookupKeys(key)) {
    const id = CLUB_IDS[k];
    if (id == null || AF_BROKEN_LOGO_IDS.has(id)) continue;
    return `${MEDIA}/${id}.png`;
  }
  return null;
}

export function flagLogoForTeamName(name) {
  const key = normalizeTeamName(name);
  const iso = TEAM_FLAG_ISO[key];
  return iso ? 'https://flagcdn.com/w80/' + iso + '.png' : null;
}

function fotmobOverrideUrl(name) {
  const key = normalizeTeamName(name);
  if (!key) return null;
  for (const k of clubLookupKeys(key)) {
    const fmId = FOTMOB_CLUB_IDS[k];
    if (fmId != null) return `${FOTMOB_MEDIA}/${fmId}.png`;
  }
  return null;
}

/**
 * Resolve display crest: prefer synced FotMob logos, then static maps,
 * and replace known-broken API-Sports media URLs.
 */
export function resolveTeamLogoUrl(name, existingLogo = null) {
  const existing = existingLogo ? String(existingLogo).trim() : '';
  if (existing && isFotmobCrestUrl(existing)) return existing;

  // Explicit FotMob overrides always win over stored AF URLs (PSG, Elche, Deportivo…).
  const fotmobForced = fotmobOverrideUrl(name);
  if (fotmobForced) return fotmobForced;

  const mapped = clubLogoUrl(name);
  const afId = existing ? apiSportsTeamIdFromUrl(existing) : null;
  if (afId != null && AF_BROKEN_LOGO_IDS.has(afId) && mapped) return mapped;
  if (existing && /^https?:\/\//i.test(existing) && !isFlagCdnUrl(existing)) {
    return existing;
  }
  return mapped || flagLogoForTeamName(name) || (existing || null);
}

/** Canonical top-5 rosters for crest audit (display name → preferred lookup key). */
export const TOP5_CREST_ROSTERS = {
  39: {
    name: 'Premier League',
    teams: [
      'Arsenal',
      'Aston Villa',
      'Bournemouth',
      'Brentford',
      'Brighton',
      'Chelsea',
      'Crystal Palace',
      'Everton',
      'Fulham',
      'Ipswich',
      'Leicester',
      'Liverpool',
      'Manchester City',
      'Manchester United',
      'Newcastle',
      'Nottingham Forest',
      'Southampton',
      'Tottenham',
      'West Ham',
      'Wolves',
      'Burnley',
      'Leeds',
      'Sunderland',
    ],
  },
  140: {
    name: 'LaLiga',
    teams: [
      'Alaves',
      'Athletic Club',
      'Atletico Madrid',
      'Barcelona',
      'Celta Vigo',
      'Elche',
      'Espanyol',
      'Getafe',
      'Girona',
      'Levante',
      'Mallorca',
      'Osasuna',
      'Rayo Vallecano',
      'Real Betis',
      'Real Madrid',
      'Real Oviedo',
      'Real Sociedad',
      'Sevilla',
      'Valencia',
      'Villarreal',
      'RC Deportivo',
    ],
  },
  135: {
    name: 'Serie A',
    teams: [
      'AC Milan',
      'Inter',
      'Juventus',
      'Napoli',
      'Roma',
      'Lazio',
      'Atalanta',
      'Fiorentina',
      'Bologna',
      'Torino',
      'Udinese',
      'Genoa',
      'Cagliari',
      'Empoli',
      'Monza',
      'Lecce',
      'Hellas Verona',
      'Como',
      'Parma',
      'Venezia',
      'Sassuolo',
    ],
  },
  78: {
    name: 'Bundesliga',
    teams: [
      'Bayern Munich',
      'Borussia Dortmund',
      'RB Leipzig',
      'Bayer Leverkusen',
      'Eintracht Frankfurt',
      'Wolfsburg',
      'Borussia Monchengladbach',
      'Hoffenheim',
      'Freiburg',
      'Mainz 05',
      'Augsburg',
      'Stuttgart',
      'Werder Bremen',
      'Union Berlin',
      'Heidenheim',
      'St Pauli',
      'Holstein Kiel',
      'FC Koln',
      'Hamburger SV',
    ],
  },
  61: {
    name: 'Ligue 1',
    teams: [
      'Paris Saint Germain',
      'Marseille',
      'Lyon',
      'Monaco',
      'Lille',
      'Nice',
      'Rennes',
      'Lens',
      'Strasbourg',
      'Nantes',
      'Toulouse',
      'Reims',
      'Montpellier',
      'Brest',
      'Auxerre',
      'Angers',
      'Le Havre',
      'Saint Etienne',
      'Paris FC',
      'Lorient',
    ],
  },
};

/**
 * Audit one club crest against static maps (no pixel AI).
 * @returns {{ team, leagueApiId, logoUrl, referenceUrl, referenceSource, status, problem, action, evidence }}
 */
export function auditCrestForTeam(teamName, leagueApiId, existingLogo = null) {
  const name = String(teamName || '').trim();
  const key = normalizeTeamName(name);
  const resolved = resolveTeamLogoUrl(name, existingLogo);
  const mapped = clubLogoUrl(name);
  let fotmobId = null;
  let afId = null;
  for (const k of clubLookupKeys(key)) {
    if (FOTMOB_CLUB_IDS[k] != null) {
      fotmobId = FOTMOB_CLUB_IDS[k];
      break;
    }
  }
  for (const k of clubLookupKeys(key)) {
    if (CLUB_IDS[k] != null) {
      afId = CLUB_IDS[k];
      break;
    }
  }
  const existingAf = existingLogo ? apiSportsTeamIdFromUrl(existingLogo) : null;
  let status = 'pending';
  let problem = null;
  let action = null;
  const referenceUrl = mapped || resolved;
  const referenceSource = fotmobId
    ? 'fotmob'
    : afId != null && !AF_BROKEN_LOGO_IDS.has(afId)
      ? 'api-sports'
      : null;

  if (!key) {
    status = 'pending';
    problem = 'empty_name';
    action = 'skip';
  } else if (afId != null && AF_BROKEN_LOGO_IDS.has(afId)) {
    if (resolved && isFotmobCrestUrl(resolved)) {
      status = 'verified';
      problem = 'af_media_broken_overridden';
      action = 'use_fotmob';
    } else {
      status = 'broken';
      problem = 'af_media_broken';
      action = 'add_fotmob_override';
    }
  } else if (existingAf != null && afId != null && existingAf !== afId) {
    status = 'mismatch';
    problem = `stored_af_id_${existingAf}_expected_${afId}`;
    action = 'rewrite_logo_url';
  } else if (referenceUrl && resolved && referenceUrl === resolved) {
    status = 'verified';
    action = 'none';
  } else if (!mapped && !resolved) {
    status = 'pending';
    problem = 'no_map_entry';
    action = 'add_club_id_map';
  } else if (mapped && existingLogo && mapped !== existingLogo && !isFotmobCrestUrl(existingLogo)) {
    status = 'mismatch';
    problem = 'stored_differs_from_map';
    action = 'rewrite_via_resolve';
  } else if (resolved) {
    status = 'verified';
    action = 'none';
  }

  return {
    team: name,
    leagueApiId: Number(leagueApiId),
    teamApiId: afId,
    logoUrl: existingLogo || resolved,
    referenceUrl,
    referenceSource,
    status,
    problem,
    action,
    evidence: JSON.stringify({
      key,
      afId,
      fotmobId,
      existingAf,
      resolved,
      mapped,
    }),
  };
}

export function auditCrestsForLeague(leagueApiId) {
  const roster = TOP5_CREST_ROSTERS[Number(leagueApiId)];
  if (!roster) return { leagueApiId, name: null, rows: [] };
  const rows = roster.teams.map((t) => auditCrestForTeam(t, leagueApiId, null));
  return { leagueApiId: Number(leagueApiId), name: roster.name, rows };
}

export { AF_BROKEN_LOGO_IDS, FOTMOB_CLUB_IDS, CLUB_IDS, MEDIA, FOTMOB_MEDIA };
