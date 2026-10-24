const API = '';

const PRIVACY_KEY = 'houdini_privacy_v1';
const FILTERS_KEY = 'houdini_filters_v1';
const SEARCH_KEY = 'houdini_last_search_v1';

/** @type {{ analytics: boolean, saveSearch: boolean, rememberFilters: boolean }} */
let privacyPrefs = {
  analytics: false,
  saveSearch: false,
  rememberFilters: false,
};

function readJsonStore(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function writeJsonStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {
    /* quota / private mode */
  }
}

function loadPrivacyPrefs() {
  const saved = readJsonStore(PRIVACY_KEY);
  if (saved && typeof saved === 'object') {
    privacyPrefs = {
      analytics: !!saved.analytics,
      saveSearch: !!saved.saveSearch,
      rememberFilters: !!saved.rememberFilters,
    };
  }
  return privacyPrefs;
}

function savePrivacyPrefs() {
  writeJsonStore(PRIVACY_KEY, privacyPrefs);
}

/** No third-party telemetry yet — gated for future use. */
function trackEvent(name, payload) {
  if (!privacyPrefs.analytics) return;
  try {
    if (typeof console !== 'undefined' && console.debug) {
      console.debug('[houdini:analytics]', name, payload || null);
    }
  } catch (_) {
    /* ignore */
  }
}

function persistFiltersIfAllowed() {
  if (!privacyPrefs.rememberFilters) {
    try {
      localStorage.removeItem(FILTERS_KEY);
    } catch (_) {
      /* ignore */
    }
    return;
  }
  writeJsonStore(FILTERS_KEY, {
    windowMode,
    selectedDate,
    scopeFilter,
    statusFilter,
  });
}

function restoreFiltersIfAllowed() {
  if (!privacyPrefs.rememberFilters) return;
  const saved = readJsonStore(FILTERS_KEY);
  if (!saved || typeof saved !== 'object') return;
  if (['hoy', 'manana', 'ayer', 'date'].includes(saved.windowMode)) {
    windowMode = saved.windowMode;
  }
  if (typeof saved.selectedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved.selectedDate)) {
    selectedDate = saved.selectedDate;
  }
  if (['all', 'live', 'finished', 'upcoming'].includes(saved.statusFilter)) {
    statusFilter = saved.statusFilter;
  } else {
    statusFilter = 'all';
  }
  if (['all', 'clubs', 'intl'].includes(saved.scopeFilter)) {
    scopeFilter = saved.scopeFilter;
  }
}

function persistSearchIfAllowed(q) {
  const value = String(q || '').trim();
  if (!privacyPrefs.saveSearch || !value) {
    try {
      localStorage.removeItem(SEARCH_KEY);
    } catch (_) {
      /* ignore */
    }
    return;
  }
  try {
    localStorage.setItem(SEARCH_KEY, value);
  } catch (_) {
    /* ignore */
  }
}

function restoreSearchIfAllowed() {
  if (!privacyPrefs.saveSearch) return;
  try {
    const q = localStorage.getItem(SEARCH_KEY);
    const input = document.getElementById('team-search');
    if (q && input && !input.value) {
      input.value = q;
    }
  } catch (_) {
    /* ignore */
  }
}

function syncPrivacyToggles() {
  const analytics = document.getElementById('pref-analytics');
  const saveSearch = document.getElementById('pref-save-search');
  const remember = document.getElementById('pref-remember-filters');
  if (analytics) {
    analytics.checked = privacyPrefs.analytics;
    analytics.setAttribute('aria-checked', privacyPrefs.analytics ? 'true' : 'false');
  }
  if (saveSearch) {
    saveSearch.checked = privacyPrefs.saveSearch;
    saveSearch.setAttribute('aria-checked', privacyPrefs.saveSearch ? 'true' : 'false');
  }
  if (remember) {
    remember.checked = privacyPrefs.rememberFilters;
    remember.setAttribute('aria-checked', privacyPrefs.rememberFilters ? 'true' : 'false');
  }
}

function syncScopeChips() {
  document.querySelectorAll('.browse-chip[data-scope], .tb-chip[data-scope]').forEach((chip) => {
    const on = (chip.dataset.scope || 'all') === scopeFilter;
    chip.classList.toggle('is-active', on);
    chip.classList.toggle('active', on);
    chip.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

/** 'hoy' | 'manana' | 'ayer' | 'date' */
let windowMode = 'hoy';
let selectedDate = new Date().toISOString().slice(0, 10);
let scopeFilter = 'all'; // all | clubs | intl
let liveOnly = false;
let statusFilter = 'all';
let selectedMatchId = null;
let leagueFilterIds = new Set(); // empty = todas; otherwise selected league ids
let leaguesPanelOpen = true;
/** Ligas explorer: open folder key + active league api_id for table detail. */
let ligasOpenFolder = 'europeas';
let ligasActiveApiId = null;
let ligasActiveD1Id = null;
let ligasLeaguesByApiId = null;
let ligasLeaguesPromise = null;
const LIGAS_FOLDERS = [
  {
    key: 'europeas',
    label: 'Europeas',
    badge: 'UEFA',
    flagCountry: null,
    leagues: [
      { apiId: 2, name: 'UEFA Champions League', tag: 'UCL' },
      { apiId: 3, name: 'UEFA Europa League', tag: 'UEL' },
      { apiId: 5, name: 'UEFA Nations League', tag: 'UNL' },
    ],
  },
  {
    key: 'england',
    label: 'Inglaterra',
    badge: 'ENG',
    flagCountry: 'England',
    leagues: [{ apiId: 39, name: 'Premier League', tag: 'PL' }],
  },
  {
    key: 'spain',
    label: 'España',
    badge: 'ESP',
    flagCountry: 'Spain',
    leagues: [
      { apiId: 140, name: 'LaLiga', tag: '1ª' },
      { apiId: 141, name: 'LaLiga 2', tag: '2ª' },
    ],
  },
  {
    key: 'italy',
    label: 'Italia',
    badge: 'ITA',
    flagCountry: 'Italy',
    leagues: [{ apiId: 135, name: 'Serie A', tag: 'SA' }],
  },
  {
    key: 'germany',
    label: 'Alemania',
    badge: 'GER',
    flagCountry: 'Germany',
    leagues: [{ apiId: 78, name: 'Bundesliga', tag: 'BL' }],
  },
  {
    key: 'france',
    label: 'Francia',
    badge: 'FRA',
    flagCountry: 'France',
    leagues: [{ apiId: 61, name: 'Ligue 1', tag: 'L1' }],
  },
];
let cachedMatches = [];
let cachedMode = 'live';
let cachedBets = [];
let bestBetsLimit = 40;
let bestBetsHasMore = false;
let livePollTimer = null;
/** Match open in the analysis panel — used to refresh its live block in place. */
let panelLiveCtx = null;
/** Market tab on Hoy: top | 1x2 | ou25 | btts | valor */
let hoyMarketTab = 'top';
/** Soft-gate caps (ignored while PREMIUM_UNLOCKED). */
const FREE_TOP_CAP = 10;
const FREE_VALOR_CAP = 5;
/** Content unlocked; Premium tab still says “Pronto” / no payment. */
const PREMIUM_UNLOCKED = true;
/** Cached combos for Cuotas target calculator. */
let cachedOddsBandBets = [];
/** Target cuota for Cuotas calculator (default 3.0). */
let cuotasTargetOdds = 3;
/** Debounce + request generation for slider recalcs. */
let cuotasTargetTimer = null;
let cuotasLoadGen = 0;
/** Shared tip summary/perf cache for badge + Stats */
let cachedTipSummary = null;
let tipPerfCacheKey = '';
let tipPerfCache = null;

const COUNTRY_FLAG = {
  Spain: '🇪🇸',
  England: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  Italy: '🇮🇹',
  Germany: '🇩🇪',
  France: '🇫🇷',
  Portugal: '🇵🇹',
  Netherlands: '🇳🇱',
  Belgium: '🇧🇪',
  Brazil: '🇧🇷',
  Argentina: '🇦🇷',
  Mexico: '🇲🇽',
  USA: '🇺🇸',
  'United States': '🇺🇸',
  World: '🌍',
  Europe: '🇪🇺',
};

const COUNTRY_ES = {
  Spain: 'España',
  England: 'Inglaterra',
  Italy: 'Italia',
  Germany: 'Alemania',
  France: 'Francia',
  Portugal: 'Portugal',
  Netherlands: 'Países Bajos',
  Belgium: 'Bélgica',
  Brazil: 'Brasil',
  Argentina: 'Argentina',
  Mexico: 'México',
  USA: 'EE. UU.',
  'United States': 'EE. UU.',
  World: 'Internacional',
  Europe: 'Europa',
};

const BET_LABELS = {
  HOME_WIN: 'Victoria local',
  DRAW: 'Empate',
  AWAY_WIN: 'Victoria visitante',
  DC_1X: 'Doble oportunidad 1X',
  DC_X2: 'Doble oportunidad X2',
  DNB_HOME: 'Empate no válido · local',
  DNB_AWAY: 'Empate no válido · visitante',
  OVER_05: 'Más de 0,5 goles',
  UNDER_05: 'Menos de 0,5 goles',
  OVER_15: 'Más de 1,5 goles',
  UNDER_15: 'Menos de 1,5 goles',
  OVER_25: 'Más de 2,5 goles',
  UNDER_25: 'Menos de 2,5 goles',
  OVER_35: 'Más de 3,5 goles',
  UNDER_35: 'Menos de 3,5 goles',
  OVER_45: 'Más de 4,5 goles',
  UNDER_45: 'Menos de 4,5 goles',
  BTTS_YES: 'Ambos marcan — Sí',
  BTTS_NO: 'Ambos marcan — No',
  HOME_OVER_05: 'Local · Más de 0,5 goles',
  HOME_UNDER_05: 'Local · Menos de 0,5 goles',
  HOME_OVER_15: 'Local · Más de 1,5 goles',
  HOME_UNDER_15: 'Local · Menos de 1,5 goles',
  HOME_OVER_25: 'Local · Más de 2,5 goles',
  HOME_UNDER_25: 'Local · Menos de 2,5 goles',
  HOME_OVER_35: 'Local · Más de 3,5 goles',
  HOME_UNDER_35: 'Local · Menos de 3,5 goles',
  AWAY_OVER_05: 'Visitante · Más de 0,5 goles',
  AWAY_UNDER_05: 'Visitante · Menos de 0,5 goles',
  AWAY_OVER_15: 'Visitante · Más de 1,5 goles',
  AWAY_UNDER_15: 'Visitante · Menos de 1,5 goles',
  AWAY_OVER_25: 'Visitante · Más de 2,5 goles',
  AWAY_UNDER_25: 'Visitante · Menos de 2,5 goles',
  AWAY_OVER_35: 'Visitante · Más de 3,5 goles',
  AWAY_UNDER_35: 'Visitante · Menos de 3,5 goles',
  CORNERS_OVER_85: 'Más de 8,5 córners',
  CORNERS_UNDER_85: 'Menos de 8,5 córners',
  CORNERS_OVER_95: 'Más de 9,5 córners',
  CORNERS_UNDER_95: 'Menos de 9,5 córners',
  CORNERS_OVER_105: 'Más de 10,5 córners',
  CORNERS_UNDER_105: 'Menos de 10,5 córners',
  SHOTS_OVER_225: 'Más de 22,5 tiros',
  SHOTS_UNDER_225: 'Menos de 22,5 tiros',
  SHOTS_OVER_255: 'Más de 25,5 tiros',
  SHOTS_UNDER_255: 'Menos de 25,5 tiros',
  SOT_OVER_75: 'Más de 7,5 tiros a puerta',
  SOT_UNDER_75: 'Menos de 7,5 tiros a puerta',
  SOT_OVER_85: 'Más de 8,5 tiros a puerta',
  SOT_UNDER_85: 'Menos de 8,5 tiros a puerta',
  SOT_OVER_95: 'Más de 9,5 tiros a puerta',
  SOT_UNDER_95: 'Menos de 9,5 tiros a puerta',
  CARDS_OVER_35: 'Más de 3,5 amarillas',
  CARDS_UNDER_35: 'Menos de 3,5 amarillas',
  CARDS_OVER_45: 'Más de 4,5 amarillas',
  CARDS_UNDER_45: 'Menos de 4,5 amarillas',
};

const FAMILY_LABELS = {
  '1X2': '1X2',
  ou: 'Más/Menos',
  btts: 'Ambos marcan',
  goles: 'Goles',
  corners: 'Córners',
  cards: 'Amarillas',
  shots: 'Tiros',
  shots_on_target: 'Tiros a puerta',
  otros: 'Otros',
};

/** Align with predictionService MIN_VALUE (5% edge vs fair book). */
const MIN_VALUE_EDGE = 0.05;

/** "15" → "1,5" ; "105" → "10,5" */
function lineFromSuffix(suffix) {
  const s = String(suffix || '');
  if (!/^\d+$/.test(s)) return s.replace('.', ',');
  if (s.length === 1) return s;
  return `${s.slice(0, -1)},${s.slice(-1)}`;
}

function labelBetFallback(code, homeName, awayName) {
  const raw = String(code || '').toUpperCase();
  if (!raw) return '—';
  const home = String(homeName || '').trim();
  const away = String(awayName || '').trim();
  if (raw === 'HOME_WIN') return home ? `Victoria ${home}` : 'Victoria local';
  if (raw === 'AWAY_WIN') return away ? `Victoria ${away}` : 'Victoria visitante';
  if (raw === 'DRAW') return 'Empate';
  if (raw === 'BTTS_YES') return 'Ambos marcan — Sí';
  if (raw === 'BTTS_NO') return 'Ambos marcan — No';

  const m = raw.match(/^(HOME_|AWAY_|CORNERS_|CARDS_|SHOTS_|SOT_)?(OVER|UNDER)_(\d+)$/);
  if (!m) return code;
  const scope = m[1] || '';
  const side = m[2] === 'OVER' ? 'Más de' : 'Menos de';
  const line = lineFromSuffix(m[3]);
  let unit = 'goles';
  let who = '';
  if (scope === 'HOME_') who = home ? `${home} · ` : 'Local · ';
  else if (scope === 'AWAY_') who = away ? `${away} · ` : 'Visitante · ';
  else if (scope === 'CORNERS_') unit = 'córners';
  else if (scope === 'CARDS_') unit = 'amarillas';
  else if (scope === 'SHOTS_') unit = 'tiros';
  else if (scope === 'SOT_') unit = 'tiros a puerta';
  return `${who}${side} ${line} ${unit}`;
}

/** ISO2 for flagcdn when team looks like a national side */
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
  'ivory coast': "ci",
  "côte d'ivoire": 'ci',
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
  'trinidad and tobago': 'tt',
  curacao: 'cw',
  'curaçao': 'cw',
  suriname: 'sr',
  guyana: 'gy',
  dominica: 'dm',
  grenada: 'gd',
  barbados: 'bb',
  bermuda: 'bm',
  'cayman virgin islands': 'vg',
  'u.s. virgin islands': 'vi',
  'us virgin islands': 'vi',
  anguilla: 'ai',
  montserrat: 'ms',
  'antigua and barbuda': 'ag',
  'saint martin': 'mf',
  'sint maarten': 'sx',
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

const INTL_NAME_RE =
  /^(Friendlies|UEFA Nations League|Champions League|Europa League|UEFA Champions League|UEFA Europa League)/i;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Human tip label. Pass home/away so HOME_/AWAY_ markets use team names
 * instead of «Local/Visitante».
 */
function labelBet(code, homeName, awayName) {
  if (!code) return '—';
  const home = String(homeName || '').trim();
  const away = String(awayName || '').trim();
  const raw = String(code).toUpperCase();
  if (raw === 'HOME_WIN') return home ? `Victoria ${home}` : BET_LABELS.HOME_WIN;
  if (raw === 'AWAY_WIN') return away ? `Victoria ${away}` : BET_LABELS.AWAY_WIN;
  if (raw.startsWith('HOME_') && home) {
    return labelBetFallback(raw, home, away);
  }
  if (raw.startsWith('AWAY_') && away) {
    return labelBetFallback(raw, home, away);
  }
  return BET_LABELS[code] || labelBetFallback(code, home, away);
}

function labelFamily(family) {
  return FAMILY_LABELS[family] || family || '—';
}

function teamInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function flagUrlForTeam(name) {
  const key = String(name || '')
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
  const iso = TEAM_FLAG_ISO[key];
  if (!iso) return null;
  return `https://flagcdn.com/w80/${iso}.png`;
}

const CLUB_CREST_IDS = {
  'az alkmaar': 201,
  anderlecht: 554,
  'ararat armenia': 3424,
  'ararat-armenia': 3424,
  benfica: 211,
  besiktas: 549,
  celtic: 247,
  'dinamo zagreb': 620,
  'gnk dinamo': 620,
  ferencvaros: 651,
  'hapoel beer sheva': 420,
  'h. beer-sheva': 420,
  jagiellonia: 347,
  'jagiellonia bialystok': 347,
  'lech poznan': 339,
  'levski sofia': 565,
  lillestrom: 327,
  'nec nijmegen': 413,
  'n.e.c.': 413,
  celje: 696,
  'nk celje': 696,
  'ofi crete': 545,
  olympiacos: 553,
  omonia: 558,
  'omonia nicosia': 558,
  salzburg: 571,
  'rb salzburg': 571,
  'sparta prague': 570,
  'sparta praha': 570,
  'sturm graz': 568,
  torreense: 4758,
  'union st.gilloise': 1393,
  'union st gilloise': 1393,
  'union sg': 1393,
  'viktoria plzen': 567,
  'club brugge': 569,
  'bodo glimt': 311,
  atleti: 530,
  'atletico madrid': 530,
  'b. dortmund': 165,
  'borussia dortmund': 165,
  feyenoord: 209,
  fenerbahce: 611,
  galatasaray: 645,
  porto: 212,
  'sporting cp': 228,
  psv: 197,
  shakhtar: 556,
  'shakhtar donetsk': 556,
  'slavia praha': 560,
  'slavia prague': 560,
  's. bratislava': 572,
  'slovan bratislava': 572,
  lask: 652,
  'aek athens': 557,
  viking: 320,
  'paris saint germain': 85,
  'paris saint-germain': 85,
  'paris saint germain fc': 85,
  'paris sg': 85,
  psg: 85,
  elche: 3751,
  'elche cf': 3751,
  arsenal: 42,
  barcelona: 529,
  'real madrid': 541,
  liverpool: 40,
  'manchester city': 50,
  'man city': 50,
  'manchester united': 33,
  'man utd': 33,
  'man united': 33,
  inter: 505,
  milan: 489,
  'ac milan': 489,
  juventus: 496,
  napoli: 492,
  roma: 497,
  bayern: 157,
  'bayern munich': 157,
  'bayern munchen': 157,
  chelsea: 49,
  tottenham: 47,
  villarreal: 533,
  'real sociedad': 548,
  'real betis': 543,
  celta: 538,
  lens: 116,
  lille: 79,
  lyon: 80,
  marseille: 81,
  rennes: 94,
  leverkusen: 168,
  'bayer leverkusen': 168,
  'bayer 04 leverkusen': 168,
  'bayer 04': 168,
  'bayer leverkusen fc': 168,
  leipzig: 173,
  stuttgart: 172,
  hoffenheim: 167,
  como: 895,
  sunderland: 746,
  bournemouth: 35,
  'crystal palace': 52,
  'aston villa': 66,
};

const FOTMOB_CREST_IDS = {
  'paris saint germain': 9847,
  'paris saint-germain': 9847,
  'paris saint germain fc': 9847,
  'paris saint-germain fc': 9847,
  'paris sg': 9847,
  'paris s g': 9847,
  psg: 9847,
  elche: 10268,
  'elche cf': 10268,
  'rc deportivo': 9783,
  deportivo: 9783,
  'bayer leverkusen': 8178,
  'bayer 04 leverkusen': 8178,
  'bayer 04': 8178,
  leverkusen: 8178,
  'bayer leverkusen fc': 8178,
};
const AF_BROKEN_CREST_IDS = new Set([1102, 85, 3751, 168]);

function normalizeCrestKey(name) {
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
    .replace(/[^a-z0-9.\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clubCrestUrl(name) {
  const key = normalizeCrestKey(name);
  if (!key) return null;
  const fm = FOTMOB_CREST_IDS[key];
  if (fm != null) return `https://images.fotmob.com/image_resources/logo/teamlogo/${fm}.png`;
  const id = CLUB_CREST_IDS[key];
  if (id != null) return `https://media.api-sports.io/football/teams/${id}.png`;
  const stripped = key
    .replace(/^(fc|cf|ac|as|ssc|rc|rcd|gnk|nk|sk|fk|rsc|sl)\s+/, '')
    .replace(/\s+(fc|cf|ac|afc|sc|sv|jk)$/, '')
    .trim();
  if (stripped && FOTMOB_CREST_IDS[stripped] != null) {
    return `https://images.fotmob.com/image_resources/logo/teamlogo/${FOTMOB_CREST_IDS[stripped]}.png`;
  }
  if (stripped && CLUB_CREST_IDS[stripped] != null) {
    return `https://media.api-sports.io/football/teams/${CLUB_CREST_IDS[stripped]}.png`;
  }
  return null;
}

function resolveCrestUrl(logo, name) {
  const existing = logo ? String(logo).trim() : '';
  const forced = (() => {
    const key = normalizeCrestKey(name);
    if (!key) return null;
    if (FOTMOB_CREST_IDS[key] != null) {
      return `https://images.fotmob.com/image_resources/logo/teamlogo/${FOTMOB_CREST_IDS[key]}.png`;
    }
    const stripped = key
      .replace(/^(fc|cf|ac|as|ssc|rc|rcd|gnk|nk|sk|fk|rsc|sl)\s+/, '')
      .replace(/\s+(fc|cf|ac|afc|sc|sv|jk)$/, '')
      .trim();
    if (stripped && FOTMOB_CREST_IDS[stripped] != null) {
      return `https://images.fotmob.com/image_resources/logo/teamlogo/${FOTMOB_CREST_IDS[stripped]}.png`;
    }
    return null;
  })();
  if (forced) return forced;
  if (existing && /^https?:\/\//i.test(existing)) {
    const m = existing.match(/media\.api-sports\.io\/football\/teams\/(\d+)\.png/i);
    if (m && AF_BROKEN_CREST_IDS.has(Number(m[1]))) {
      return clubCrestUrl(name) || existing;
    }
    return existing;
  }
  return clubCrestUrl(name) || flagUrlForTeam(name);
}

function crestHtml(name, logo, size = 'md') {
  const src = resolveCrestUrl(logo, name);
  const initials = escapeHtml(teamInitials(name));
  const alt = escapeHtml(name || 'Equipo');
  if (src) {
    return `<span class="crest-wrap crest-wrap--${size}">
      <img class="crest crest--${size}" src="${escapeHtml(src)}" alt="${alt}" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'" />
      <span class="crest crest--fallback crest--${size}" style="display:none" aria-hidden="true">${initials}</span>
    </span>`;
  }
  return `<span class="crest crest--fallback crest--${size}" aria-hidden="true">${initials}</span>`;
}

function crestsRowHtml(homeName, homeLogo, awayName, awayLogo) {
  return `
    <div class="crests-row" aria-hidden="true">
      ${crestHtml(homeName, homeLogo)}
      <span class="crests-row__vs">vs</span>
      ${crestHtml(awayName, awayLogo)}
    </div>`;
}

function formatMatchTimeShort(value) {
  const d = parseMatchDate(value);
  if (!d) return '';
  return d.toLocaleTimeString('es-ES', {
    timeZone: 'Europe/Madrid',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function matchStatusPill(m) {
  const time = formatMatchTimeShort(m.matchDate);
  if (m.status === 'live') {
    const min = m.elapsedMinute != null ? `${Number(m.elapsedMinute)}'` : 'LIVE';
    return `${min} · EN VIVO`;
  }
  if (m.status === 'finished') {
    if (m.homeGoals != null && m.awayGoals != null) {
      return `${Number(m.homeGoals)}-${Number(m.awayGoals)} · FT`;
    }
    return 'FT';
  }
  return time ? `${time} · NS` : 'NS';
}

function eventIconSvg(type) {
  if (type === 'red') {
    return `<svg class="ev-icon ev-icon--red" viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="2" width="7" height="12" rx="1.2" fill="currentColor"/></svg>`;
  }
  if (type === 'missed_pen') {
    return `<svg class="ev-icon ev-icon--miss" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.2 5.2l5.6 5.6M10.8 5.2L5.2 10.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  }
  return `<svg class="ev-icon ev-icon--goal" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 2.5v11M2.5 8h11M4.2 4.2l7.6 7.6M11.8 4.2L4.2 11.8" stroke="currentColor" stroke-width="1" opacity="0.7"/></svg>`;
}

function eventChipHtml(e) {
  const min = e.minute != null ? `${Number(e.minute)}'` : '';
  const name = e.player || (e.type === 'red' ? 'Roja' : e.type === 'missed_pen' ? 'Pen. fallado' : 'Gol');
  const side = e.isHome ? 'L' : 'V';
  return `<span class="ev-chip" title="${escapeHtml(side)}">
    ${eventIconSvg(e.type)}
    <span class="ev-chip__min">${escapeHtml(min)}</span>
    <span class="ev-chip__name">${escapeHtml(name)}</span>
  </span>`;
}

function matchEventsHtml(events, { stack = false, split = false } = {}) {
  const list = Array.isArray(events) ? events : [];
  const focus = list.filter((e) => e && (e.type === 'goal' || e.type === 'red' || e.type === 'missed_pen'));
  if (!focus.length) return '';
  if (split) {
    const home = focus.filter((e) => e.isHome);
    const away = focus.filter((e) => !e.isHome);
    // Three grid cells for .mp-teams (1fr auto 1fr) — home | spacer | away
    return `<div class="mp-live-events__col mp-live-events__col--home" aria-label="Eventos local">${home.map(eventChipHtml).join('')}</div>
      <div class="mp-live-events__mid" aria-hidden="true"></div>
      <div class="mp-live-events__col mp-live-events__col--away" aria-label="Eventos visitante">${away.map(eventChipHtml).join('')}</div>`;
  }
  const stackClass = stack ? ' league-match__events--stack' : '';
  return `<div class="league-match__events${stackClass}">${focus.map(eventChipHtml).join('')}</div>`;
}

const LIVE_TIP_META = {
  secured: { label: 'SEGURO', cls: 'live-tip--secured' },
  alive: { label: 'VIVO', cls: 'live-tip--alive' },
  fading: { label: 'DIFÍCIL', cls: 'live-tip--fading' },
  dead: { label: 'FALLADO', cls: 'live-tip--dead' },
  unknown: { label: 'EN CURSO', cls: 'live-tip--unknown' },
};

function liveTipChip(tip) {
  if (!tip || !tip.label) return '';
  const meta = LIVE_TIP_META[tip.status] || LIVE_TIP_META.unknown;
  const prob = tip.prob != null ? ` · ${Math.round(Number(tip.prob) * 100)}%` : '';
  return `<span class="live-tip ${meta.cls}">${escapeHtml(meta.label)}${escapeHtml(prob)}</span>`;
}

function liveProbsRow(live) {
  if (!live) return '';
  const h = Math.round(Number(live.homeWin || 0) * 100);
  const d = Math.round(Number(live.draw || 0) * 100);
  const a = Math.round(Number(live.awayWin || 0) * 100);
  return `<span class="live-probs" aria-label="Probabilidades en vivo: local ${h}%, empate ${d}%, visitante ${a}%">
    <span class="live-probs__p live-probs__p--home">${h}%</span>
    <span class="live-probs__p live-probs__p--draw">${d}%</span>
    <span class="live-probs__p live-probs__p--away">${a}%</span>
  </span>`;
}

/** Compact live strip for the match list row. */
function liveStripHtml(m) {
  const live = m?.live;
  if (!live) return '';
  return `<span class="live-strip">${liveProbsRow(live)}${liveTipChip(live.tip)}</span>`;
}

/** Live block of the analysis panel: probabilities now vs. before kickoff. */
function livePanelHtml(live, homeName, awayName) {
  if (!live) return '';
  const h = Math.round(Number(live.homeWin || 0) * 100);
  const d = Math.round(Number(live.draw || 0) * 100);
  const a = Math.round(Number(live.awayWin || 0) * 100);
  const pre = live.preMatch || {};
  const score =
    live.homeGoals != null && live.awayGoals != null
      ? `${live.homeGoals}-${live.awayGoals}`
      : null;
  const minute = live.minute != null ? `${live.minute}'` : 'LIVE';
  const reds = live.redCards || {};
  const redChip =
    Number(reds.home) > 0 || Number(reds.away) > 0
      ? `<span class="mp-live__red" title="Roja(s) en vivo: la proyección ya las ajusta">${11 -
        Math.min(Number(reds.home) || 0, 4)}v${11 - Math.min(Number(reds.away) || 0, 4)}</span>`
      : '';
  const delta = (now, before) => {
    if (before == null) return '';
    const diff = Math.round((Number(now) - Number(before)) * 100);
    if (!diff) return '';
    return `${diff > 0 ? '+' : ''}${diff}`;
  };
  const rows = [
    { key: 'Local', now: h, before: pre.homeWin, cls: 'home' },
    { key: 'Empate', now: d, before: pre.draw, cls: 'draw' },
    { key: 'Visit.', now: a, before: pre.awayWin, cls: 'away' },
  ];
  return `
    <section class="mp-live">
      <div class="mp-live__head">
        <span class="mp-live__badge"><span class="league-match__live-dot"></span>EN VIVO · ${escapeHtml(
          minute
        )}</span>
        ${score ? `<span class="mp-live__score">${escapeHtml(score)}</span>` : ''}
        ${redChip}
        <span class="mp-live__left">Quedan ~${Number(live.remaining || 0)}′</span>
      </div>
      <div class="mp-live__bar" role="img" aria-label="Probabilidades en vivo: local ${h}%, empate ${d}%, visitante ${a}%">
        <span class="mp-live__seg mp-live__seg--home" style="flex:${Math.max(h, 1)}"></span>
        <span class="mp-live__seg mp-live__seg--draw" style="flex:${Math.max(d, 1)}"></span>
        <span class="mp-live__seg mp-live__seg--away" style="flex:${Math.max(a, 1)}"></span>
      </div>
      <div class="mp-live__rows">
        ${rows
          .map(
            (r) => `<span class="mp-live__row mp-live__row--${r.cls}">
          <span class="mp-live__key">${escapeHtml(r.key)}</span>
          <span class="mp-live__now">${r.now}%</span>
          <span class="mp-live__delta">${escapeHtml(delta(r.now / 100, r.before))}</span>
        </span>`
          )
          .join('')}
      </div>
      ${
        live.tip
          ? `<div class="mp-live__tip">
              <span class="mp-live__tip-key">Tip · ${escapeHtml(
                labelBet(live.tip.label, homeName, awayName)
              )}</span>
              ${liveTipChip(live.tip)}
            </div>`
          : ''
      }
    </section>`;
}

function browseMidHtml(m) {
  if (m.status === 'live') {
    const score =
      m.homeGoals != null && m.awayGoals != null
        ? `${Number(m.homeGoals)}-${Number(m.awayGoals)}`
        : '0-0';
    const min = m.elapsedMinute != null ? `${Number(m.elapsedMinute)}'` : 'LIVE';
    return `
      <span class="league-match__live"><span class="league-match__live-dot"></span>En vivo</span>
      <span class="league-match__score league-match__score--live">${escapeHtml(score)}</span>
      <span class="league-match__minute">${escapeHtml(min)}</span>`;
  }
  if (m.status === 'finished') {
    const score =
      m.homeGoals != null && m.awayGoals != null
        ? `${Number(m.homeGoals)}-${Number(m.awayGoals)}`
        : '—';
    return `
      <span class="league-match__score">${escapeHtml(score)}</span>
      <span class="league-match__kickoff">FT</span>`;
  }
  const time = formatMatchTimeShort(m.matchDate) || '—';
  return `<span class="league-match__kickoff">${escapeHtml(time)}</span>`;
}

function sumRecentAvg(recentAvgs, key) {
  const h = recentAvgs?.home?.[key];
  const a = recentAvgs?.away?.[key];
  if (h == null && a == null) return null;
  return Number(((Number(h) || 0) + (Number(a) || 0)).toFixed(2));
}

function keyStatCard({ title, valueHtml, barPct, tone = 'accent', sub = '' }) {
  const width = Math.max(0, Math.min(100, Math.round(Number(barPct) || 0)));
  return `
    <article class="mp-stat">
      <div class="mp-stat__head">
        <span class="mp-stat__title">${escapeHtml(title)}</span>
      </div>
      <div class="mp-stat__value">${valueHtml}</div>
      <div class="mp-stat__track" aria-hidden="true">
        <span class="mp-stat__fill mp-stat__fill--${tone}" data-bar-to="${width}" style="width:0%"></span>
      </div>
      ${sub ? `<div class="mp-stat__sub">${sub}</div>` : ''}
    </article>`;
}

function pctStatCard(title, prob) {
  const p = pct(prob);
  if (p == null) return '';
  const n = Math.round(p * 100);
  return keyStatCard({
    title,
    valueHtml: `<span class="mp-stat__num" data-count-to="${n}" data-count-suffix="%">0%</span>`,
    barPct: n,
    tone: n >= 60 ? 'accent' : n >= 45 ? 'warn' : 'muted',
  });
}

function avgStatCard(title, value, scale, leagueAvg = null) {
  if (value == null || Number.isNaN(Number(value))) return '';
  const n = Number(value);
  const ref = leagueAvg != null && Number(leagueAvg) > 0 ? Number(leagueAvg) : scale;
  const bar = ref > 0 ? (n / ref) * 100 : 0;
  const ratio = ref > 0 ? n / ref : 1;
  let tone = 'warn';
  if (ratio >= 0.9 && ratio <= 1.1) tone = 'accent';
  else if (ratio < 0.9) tone = 'muted';
  else tone = 'accent';
  const sub =
    leagueAvg != null
      ? `<span class="muted">Media liga ${Number(leagueAvg).toFixed(1)}</span>`
      : '';
  return keyStatCard({
    title,
    valueHtml: `<span class="mp-stat__num">${n.toFixed(2)}</span>`,
    barPct: bar,
    tone,
    sub,
  });
}

function expectedCardHtml({ title, homeName, awayName, homeLogo, awayLogo, homeExp, awayExp, matchExp }) {
  if (homeExp == null && awayExp == null && matchExp == null) return '';
  const pill = (v) => {
    if (v == null) return '<span class="ladder-pill ladder-pill--muted">—</span>';
    return `<span class="ladder-pill ladder-pill--hi">${Number(v).toFixed(1)}</span>`;
  };
  return `
    <div class="ladder-expected">
      <div class="ladder-expected__eyebrow">Expected</div>
      <h3 class="ladder-expected__title">${escapeHtml(title)}</h3>
      <div class="ladder-expected__teams">
        <div class="ladder-expected__side">
          ${crestHtml(homeName, homeLogo, 'sm')}
          ${pill(homeExp)}
        </div>
        <div class="ladder-expected__mid muted">Partido<br/><strong>${
          matchExp != null ? Number(matchExp).toFixed(1) : '—'
        }</strong></div>
        <div class="ladder-expected__side ladder-expected__side--away">
          ${crestHtml(awayName, awayLogo, 'sm')}
          ${pill(awayExp)}
        </div>
      </div>
    </div>`;
}

/** Map<line, over> from a ladder side ([{ line, over }]). */
function ladderProbsMap(side) {
  const map = new Map();
  (Array.isArray(side) ? side : []).forEach((r) => {
    if (!r || r.line == null || r.over == null) return;
    const line = Number(r.line);
    const over = Number(r.over);
    if (!Number.isFinite(line) || !Number.isFinite(over)) return;
    map.set(line, Math.max(0, Math.min(1, over)));
  });
  return map;
}

/** Market line label with es-ES decimals (8.5 -> "8,5"). */
function marketLineLabel(line) {
  if (line == null || line === '') return '';
  const n = Number(line);
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
}

/** "Más de X" / "Menos de X" rows for one ladder side, filtered by the wanted lines. */
function ladderProbRows(side, lines) {
  const map = ladderProbsMap(side);
  const rows = [];
  (Array.isArray(lines) ? lines : []).forEach((line) => {
    const over = map.get(Number(line));
    if (over == null) return;
    const label = marketLineLabel(line);
    rows.push(probBar(`Más de ${label}`, over));
    rows.push(probBar(`Menos de ${label}`, 1 - over));
  });
  return rows.join('');
}

function marketAveragesHtml({
  unit,
  homeName,
  awayName,
  recentAvgs,
  leagueAverage,
  leagueProxy = false,
}) {
  const home = recentAvgs?.home;
  const away = recentAvgs?.away;
  const hasTeamAvgs =
    (home != null && Number.isFinite(Number(home))) ||
    (away != null && Number.isFinite(Number(away)));
  const leaguePerTeam =
    leagueAverage != null && Number.isFinite(Number(leagueAverage))
      ? Number(leagueAverage) / 2
      : null;
  const format = (value) => {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return Number(value).toFixed(1).replace('.', ',');
  };
  const leagueLabel = leagueProxy
    ? 'Media proxy (sin muestra liga)'
    : 'Media liga / equipo';
  let caption = `${unit} por partido (últimos partidos)`;
  if (!hasTeamAvgs && leagueProxy) {
    caption = `Sin muestras de equipo · media proxy de referencia`;
  } else if (leagueProxy) {
    caption = `${unit} por partido · liga sin muestra → proxy`;
  }
  return `
    <section class="market-averages" aria-label="Promedios recientes de ${escapeHtml(unit)}">
      <h3 class="market-averages__title">Promedios recientes · ${escapeHtml(unit)}</h3>
      <div class="market-averages__grid">
        <div class="market-averages__item">
          <span class="market-averages__label">${escapeHtml(homeName || 'Local')}</span>
          <strong class="market-averages__value">${format(home)}</strong>
        </div>
        <div class="market-averages__item">
          <span class="market-averages__label">${escapeHtml(awayName || 'Visitante')}</span>
          <strong class="market-averages__value">${format(away)}</strong>
        </div>
        <div class="market-averages__item market-averages__item--league">
          <span class="market-averages__label">${escapeHtml(leagueLabel)}</span>
          <strong class="market-averages__value">${format(leaguePerTeam)}</strong>
        </div>
      </div>
      <p class="market-averages__caption">${escapeHtml(caption)}</p>
    </section>`;
}

/**
 * Market tab (tiros a puerta / córners / tarjetas) with the same shape as the
 * "Goles" tab: an Expected card plus one Market Section per scope.
 */
function extrasPanel({
  label,
  unit,
  expected,
  ladders,
  matchLines,
  teamLines,
  homeName,
  awayName,
  homeLogo,
  awayLogo,
  recentAvgs,
  leagueAverage,
  leagueProxy = false,
  fallbackHtml,
}) {
  const matchRows = ladderProbRows(ladders?.match, matchLines);
  const homeRows = ladderProbRows(ladders?.home, teamLines);
  const awayRows = ladderProbRows(ladders?.away, teamLines);
  const hasRows = Boolean(matchRows || homeRows || awayRows);
  const homeN = Number(ladders?.samples?.home) || 0;
  const awayN = Number(ladders?.samples?.away) || 0;
  const leagueOnly = Boolean(ladders?.degraded) && homeN === 0 && awayN === 0;
  const oneSided =
    Boolean(ladders?.degraded) && !leagueOnly && (homeN === 0 || awayN === 0);
  let degradedNote = '';
  if (leagueOnly || (leagueProxy && !ladders?.degraded && !hasRows)) {
    degradedNote = `<div class="market-estimate-note" role="status">Estimación con media de liga${leagueProxy ? ' (proxy)' : ''} · sin muestras de equipo · no es tip</div>`;
  } else if (oneSided) {
    degradedNote = `<div class="market-estimate-note" role="status">Estimación parcial · ${homeN} local / ${awayN} visitante (lado sin datos = media liga) · tip exige ≥4 por lado · no es tip</div>`;
  } else if (ladders?.degraded) {
    // EXTRA_MARKET_MIN_N = 4: stronger wording only when a side has <2 games.
    const veryThin = homeN < 2 || awayN < 2;
    degradedNote = veryThin
      ? `<div class="market-estimate-note" role="status">Muestras muy escasas · ${homeN} local / ${awayN} visitante · tip exige ≥4 por lado · no es tip</div>`
      : `<div class="market-estimate-note" role="status">Datos limitados · ${homeN} local / ${awayN} visitante (tip exige ≥4 por lado) · estimación orientativa, no es tip</div>`;
  } else if (leagueProxy) {
    degradedNote = `<div class="market-estimate-note" role="status">Media de liga proxy (sin stats reales de liga) · probabilidades del modelo Poisson</div>`;
  } else if (hasRows) {
    degradedNote = `<div class="market-estimate-note market-estimate-note--ok muted" role="status">Probabilidades Poisson del modelo · medias = últimos partidos</div>`;
  }
  const averages = marketAveragesHtml({
    unit,
    homeName,
    awayName,
    recentAvgs,
    leagueAverage,
    leagueProxy,
  });
  const header = `${expectedCardHtml({
    title: label,
    homeName,
    awayName,
    homeLogo,
    awayLogo,
    homeExp: expected?.home,
    awayExp: expected?.away,
    matchExp: expected?.match,
  })}${degradedNote}${averages}`;
  if (!hasRows) return `${header}${fallbackHtml || ''}`;
  return `
    ${header}
    ${marketSection(`${unit} del partido`, matchRows)}
    ${marketSection(`${unit} de ${homeName || 'local'}`, homeRows)}
    ${marketSection(
      `${unit} de ${awayName || 'visitante'}`,
      awayRows
    )}
  `;
}

/** Exact-score grid (5x5) with the most likely scorelines. */
function scoreGridHtml(grid, topScores, homeName, awayName) {
  if (!Array.isArray(grid) || !grid.length) return '';
  const max = Math.max(...grid.flat().map((v) => Number(v) || 0), 0.01);
  const top = (topScores || [])[0];
  const cells = grid
    .map(
      (row, h) =>
        `<div class="mp-score__row">${row
          .map((v, a) => {
            const p = Number(v) || 0;
            const intensity = Math.round((p / max) * 100);
            return `<div class="mp-score__cell" style="--heat:${intensity}%" title="${h}-${a}: ${(
              p * 100
            ).toFixed(1)}%"><span>${(p * 100).toFixed(0)}%</span></div>`;
          })
          .join('')}</div>`
    )
    .join('');
  const list = (topScores || [])
    .slice(0, 4)
    .map(
      (s) =>
        `<span class="mp-score__chip"><strong>${s.home}-${s.away}</strong> ${(s.prob * 100).toFixed(1)}%</span>`
    )
    .join('');
  return `
    <section class="mp-score">
      <div class="mp-score__title">Marcadores exactos</div>
      <div class="mp-score__grid" role="img" aria-label="Probabilidad de cada marcador exacto, del 0 al ${grid.length - 1} goles por equipo">
        ${cells}
      </div>
      <div class="mp-score__top">${list}</div>
      ${
        top
          ? `<p class="mp-score__caption">Más probable: <strong>${top.home}-${top.away}</strong> (${(top.prob * 100).toFixed(1)}%)</p>`
          : ''
      }
      <p class="mp-score__axis muted">Filas: ${escapeHtml(homeName || 'local')} · Columnas: ${escapeHtml(
        awayName || 'visitante'
      )}</p>
    </section>`;
}

/** Previous meetings between the two teams. */
function h2hHtml(h2h, homeName) {
  const rows = h2h || [];
  if (!rows.length) return '';
  const list = rows
    .map((r) => {
      const homeWon = r.homeWon ? 'win' : r.draw ? 'draw' : 'loss';
      return `<li class="mp-h2h__row mp-h2h__row--${homeWon}">
        <span class="mp-h2h__date muted">${escapeHtml(String(r.date || '').slice(0, 10))}</span>
        <span class="mp-h2h__teams">${escapeHtml(r.homeName || '')} ${Number(r.homeGoals)}-${Number(
        r.awayGoals
      )} ${escapeHtml(r.awayName || '')}</span>
        <span class="mp-h2h__league muted">${escapeHtml(r.leagueName || '')}</span>
      </li>`;
    })
    .join('');
  return `
    <section class="mp-h2h">
      <div class="mp-section-title">Últimos enfrentamientos</div>
      <ul class="mp-h2h__list">${list}</ul>
    </section>`;
}

/** Mini league table with the two teams of the match highlighted. */
function leagueTableHtml(table, homeName, awayName) {
  const rows = table || [];
  if (!rows.length) return '';
  const body = rows
    .map((r) => {
      const mine =
        (homeName && r.team === homeName) || (awayName && r.team === awayName) ? ' is-mine' : '';
      const gd = Number(r.goalDiff || 0);
      const gdTxt = gd > 0 ? `+${gd}` : String(gd);
      return `<tr class="mp-table__row${mine}">
        <td class="mp-table__pos">${Number(r.position)}</td>
        <td class="mp-table__team">${escapeHtml(r.team || '')}</td>
        <td>${Number(r.played)}</td>
        <td>${Number(r.points)}</td>
        <td class="mp-table__gd">${escapeHtml(gdTxt)}</td>
      </tr>`;
    })
    .join('');
  return `
    <section class="mp-table">
      <div class="mp-section-title">Clasificación</div>
      <div class="mp-table__wrap">
        <table class="mp-table__grid">
          <thead><tr><th>#</th><th>Equipo</th><th>PJ</th><th>Pts</th><th>DG</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>`;
}

function winProbBar(p) {
  const h = pct(p.home_win_prob);
  const d = pct(p.draw_prob);
  const a = pct(p.away_win_prob);
  if (h == null && d == null && a == null) return '';
  const hp = Math.round((h || 0) * 100);
  const dp = Math.round((d || 0) * 100);
  const ap = Math.round((a || 0) * 100);
  return `
    <section class="mp-win">
      <div class="mp-win__labels">
        <span>Local <strong data-count-to="${hp}" data-count-suffix="%">0%</strong></span>
        <span>Empate <strong data-count-to="${dp}" data-count-suffix="%">0%</strong></span>
        <span>Visit. <strong data-count-to="${ap}" data-count-suffix="%">0%</strong></span>
      </div>
      <div class="mp-win__bar" role="img" aria-label="Probabilidad 1X2: local ${hp}%, empate ${dp}%, visitante ${ap}%">
        <span class="mp-win__seg mp-win__seg--home" data-flex-to="${Math.max(hp, 1)}" style="flex:1"></span>
        <span class="mp-win__seg mp-win__seg--draw" data-flex-to="${Math.max(dp, 1)}" style="flex:1"></span>
        <span class="mp-win__seg mp-win__seg--away" data-flex-to="${Math.max(ap, 1)}" style="flex:1"></span>
      </div>
    </section>`;
}

function mpTeamCol(name, logo, side, form) {
  const label = side === 'home' ? 'Local' : 'Visitante';
  return `
    <div class="mp-team mp-team--${side}">
      ${crestHtml(name, logo, 'lg')}
      <div class="mp-team__name">${escapeHtml(name || '—')}</div>
      <div class="mp-team__side">${label}</div>
      <div class="mp-team__form">${formHtml(form)}</div>
    </div>`;
}

function wireMatchPanelTabs(root) {
  if (!root) return;
  const tabs = [...root.querySelectorAll('[data-mp-tab]')];
  const panels = [...root.querySelectorAll('[data-mp-panel]')];
  if (!tabs.length) return;
  const activate = (id, { animate = false } = {}) => {
    tabs.forEach((t) => {
      const on = t.dataset.mpTab === id;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    panels.forEach((p) => {
      p.classList.toggle('is-active', p.dataset.mpPanel === id);
      p.hidden = p.dataset.mpPanel !== id;
    });
    // Tab clicks re-run count/bar entrance; initial open leaves this to runPanelEntrance.
    if (animate) {
      const panel = panels.find((p) => p.dataset.mpPanel === id);
      if (panel) animateCountUps(panel);
    }
  };
  tabs.forEach((t) => {
    t.addEventListener('click', () => activate(t.dataset.mpTab, { animate: true }));
  });
  activate(tabs[0].dataset.mpTab);
}

function confClass(score) {
  const n = Number(score);
  if (n >= 60) return 'conf-hi';
  if (n >= 45) return 'conf-mid';
  return 'conf-lo';
}

function pct(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Number(n);
}

function pctLabel(n) {
  const p = pct(n);
  if (p == null) return '—';
  return `${(p * 100).toFixed(0)}%`;
}

function probBar(label, prob) {
  const p = pct(prob);
  if (p == null) return '';
  const n = Math.round(p * 100);
  const width = Math.max(4, Math.min(100, n));
  return `
    <div class="prob-row">
      <div class="prob-row__label">${escapeHtml(label)}</div>
      <div class="prob-row__track" aria-hidden="true"><span class="prob-row__fill" data-bar-to="${width}" style="width:0%"></span></div>
      <div class="prob-row__pct" data-count-to="${n}" data-count-suffix="%">0%</div>
    </div>`;
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

function animateCountUps(root) {
  if (!root) return;
  const reduce = prefersReducedMotion();
  root.querySelectorAll('[data-count-to]').forEach((el) => {
    const to = Number(el.dataset.countTo);
    const suffix = el.dataset.countSuffix ?? '';
    if (!Number.isFinite(to)) return;
    if (reduce) {
      el.textContent = `${Math.round(to)}${suffix}`;
      return;
    }
    el.textContent = `0${suffix}`;
    const dur = 780;
    const start = performance.now();
    const from = 0;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = `${Math.round(from + (to - from) * eased)}${suffix}`;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  root.querySelectorAll('[data-bar-to]').forEach((el) => {
    const to = Number(el.dataset.barTo);
    if (!Number.isFinite(to)) return;
    if (reduce) {
      el.style.transition = 'none';
      el.style.width = `${to}%`;
      return;
    }
    // Snap to 0 so tab re-activate can replay the bar fill.
    el.style.transition = 'none';
    el.style.width = '0%';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transition = 'width 0.78s cubic-bezier(0.22, 1, 0.36, 1)';
        el.style.width = `${to}%`;
      });
    });
  });
  root.querySelectorAll('[data-flex-to]').forEach((el) => {
    const to = Number(el.dataset.flexTo);
    if (!Number.isFinite(to)) return;
    el.style.flex = String(Math.max(to, 1));
  });
}

function runPanelEntrance(root) {
  if (!root) return;
  root.classList.remove('mp--enter');
  // reflow so re-open retriggers
  void root.offsetWidth;
  root.classList.add('mp--enter');
  animateCountUps(root);
}

function marketSection(title, rowsHtml) {
  if (!rowsHtml || !String(rowsHtml).trim()) return '';
  return `
    <div class="market-block">
      <div class="market-block__title">${escapeHtml(title)}</div>
      ${rowsHtml}
    </div>`;
}

function parseMatchDate(value) {
  if (!value) return null;
  const raw = String(value).trim().replace(' ', 'T');
  const iso = /Z|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function matchDateMs(value) {
  const d = parseMatchDate(value);
  return d ? d.getTime() : Number.POSITIVE_INFINITY;
}

/** Chronological board order: soonest kickoff first; optional numeric tie-break. */
function sortByMatchDateAsc(rows, tieBreak) {
  return rows.slice().sort((a, b) => {
    const da = matchDateMs(a.matchDate);
    const db = matchDateMs(b.matchDate);
    if (da !== db) return da - db;
    if (typeof tieBreak === 'function') {
      const t = tieBreak(a, b);
      if (t) return t;
    }
    return 0;
  });
}

function formatMatchDate(value) {
  if (!value) return 'Fecha no disponible';
  const d = parseMatchDate(value);
  if (!d) return String(value);
  const opts = { timeZone: 'Europe/Madrid' };
  const weekday = d.toLocaleDateString('es-ES', { ...opts, weekday: 'short' });
  const datePart = d.toLocaleDateString('es-ES', {
    ...opts,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const timePart = d.toLocaleTimeString('es-ES', {
    ...opts,
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${weekday} ${datePart} · ${timePart}`;
}

const FORM_BADGE = {
  W: { letter: 'V', cls: 'V', title: 'Victoria' },
  D: { letter: 'E', cls: 'E', title: 'Empate' },
  L: { letter: 'D', cls: 'D', title: 'Derrota' },
  V: { letter: 'V', cls: 'V', title: 'Victoria' },
  E: { letter: 'E', cls: 'E', title: 'Empate' },
};

function formHtml(form) {
  if (!form || !form.length) {
    return `<span class="muted">Sin historial suficiente</span>`;
  }
  return form
    .map((f) => {
      const raw = String(f || '').toUpperCase();
      const mapped = FORM_BADGE[raw] || { letter: raw || '—', cls: raw || 'E', title: raw || '—' };
      return `<span class="badge ${escapeHtml(mapped.cls)}" title="${escapeHtml(mapped.title)}">${escapeHtml(mapped.letter)}</span>`;
    })
    .join('');
}

function isInternationalMatch(item) {
  const country = String(item.leagueCountry || item.country || '');
  const name = String(item.leagueName || item.league || '');
  if (/Club Friendlies/i.test(name)) return false;
  if (country === 'World') return true;
  return INTL_NAME_RE.test(name);
}

function filterByScope(items) {
  let list = items || [];
  if (scopeFilter === 'clubs') list = list.filter((x) => !isInternationalMatch(x));
  if (scopeFilter === 'intl') list = list.filter((x) => isInternationalMatch(x));
  if (liveOnly) list = list.filter((x) => x.status === 'live');
  if (leagueFilterIds.size > 0) {
    list = list.filter((x) => leagueFilterIds.has(Number(x.leagueId)));
  }
  return list;
}

function selectedLeagueCount() {
  return leagueFilterIds.size;
}

function pruneLeagueSelection(leagues) {
  if (!leagueFilterIds.size) return;
  const valid = new Set((leagues || []).map((l) => Number(l.id)));
  for (const id of [...leagueFilterIds]) {
    if (!valid.has(id)) leagueFilterIds.delete(id);
  }
}

function shortLeagueName(name) {
  const n = String(name || '').trim();
  if (!n) return 'Liga';
  return n
    .replace(/^UEFA\s+/i, '')
    .replace(/\s+Grp\.\s*.+$/i, '')
    .replace(/\s+\d{4}.*$/i, '')
    .slice(0, 28);
}

function countryFlag(country) {
  const c = String(country || '').trim();
  return COUNTRY_FLAG[c] || '🏳️';
}

function countryLabel(country) {
  const c = String(country || '').trim();
  return COUNTRY_ES[c] || c || '—';
}

function collectLeagues(matches, scope) {
  let list = matches || [];
  if (scope === 'clubs') list = list.filter((x) => !isInternationalMatch(x));
  if (scope === 'intl') list = list.filter((x) => isInternationalMatch(x));
  const map = new Map();
  for (const m of list) {
    const id = m.leagueId;
    if (id == null) continue;
    const prev = map.get(id);
    if (prev) {
      prev.count += 1;
      continue;
    }
    map.set(id, {
      id,
      name: m.leagueName || m.league || 'Liga',
      country: m.leagueCountry || m.country || '',
      count: 1,
    });
  }
  return [...map.values()].sort((a, b) => {
    const ca = countryLabel(a.country);
    const cb = countryLabel(b.country);
    const cCmp = String(ca).localeCompare(String(cb), 'es');
    if (cCmp !== 0) return cCmp;
    const nCmp = String(a.name).localeCompare(String(b.name), 'es');
    if (nCmp !== 0) return nCmp;
    return b.count - a.count;
  });
}

/** Group flat league list into [{ country, label, flag, leagues, matchCount }]. */
function groupLeaguesByCountry(leagues) {
  const map = new Map();
  for (const l of leagues) {
    const key = String(l.country || '').trim() || '_';
    if (!map.has(key)) {
      map.set(key, {
        country: key === '_' ? '' : key,
        label: countryLabel(key === '_' ? '' : key),
        flag: countryFlag(key === '_' ? '' : key),
        leagues: [],
        matchCount: 0,
      });
    }
    const g = map.get(key);
    g.leagues.push(l);
    g.matchCount += l.count;
  }
  return [...map.values()].sort((a, b) => String(a.label).localeCompare(String(b.label), 'es'));
}

function parseLigasApiIdFromHash(hash = location.hash) {
  const m = String(hash || '').match(/^#ligas\/(\d+)/i);
  return m ? Number(m[1]) : null;
}

async function ensureLigasCatalog() {
  if (ligasLeaguesByApiId) return ligasLeaguesByApiId;
  if (ligasLeaguesPromise) return ligasLeaguesPromise;
  ligasLeaguesPromise = api('/api/v1/leagues')
    .then((data) => {
      const map = new Map();
      for (const row of data.leagues || []) {
        const apiId = Number(row.api_id ?? row.apiId);
        if (!Number.isFinite(apiId) || apiId <= 0) continue;
        map.set(apiId, {
          id: Number(row.id),
          apiId,
          name: row.name || '',
          country: row.country || null,
        });
      }
      ligasLeaguesByApiId = map;
      return map;
    })
    .catch((err) => {
      ligasLeaguesPromise = null;
      throw err;
    });
  return ligasLeaguesPromise;
}

function setLigasSelectionVisible(hasSelection) {
  document.body.classList.toggle('has-ligas-selection', !!hasSelection);
  const empty = document.getElementById('ligas-panel-empty');
  const detail = document.getElementById('ligas-detail');
  if (empty) empty.hidden = !!hasSelection;
  if (detail) detail.hidden = !hasSelection;
}

function ligasStandingsHtml(table) {
  const rows = table || [];
  if (!rows.length) {
    return `<p class="ligas-standings__empty">Sin clasificatorio aún</p>`;
  }
  const body = rows
    .map((r) => {
      const gd = Number(r.goalDiff || 0);
      const gdTxt = gd > 0 ? `+${gd}` : String(gd);
      const team = r.team || '';
      return `<tr class="ligas-standings__row" tabindex="0" role="button" data-team-id="${Number(
        r.teamId
      )}" aria-label="Ver próximo partido de ${escapeHtml(team)}">
        <td class="ligas-standings__pos">${Number(r.position)}</td>
        <td>
          <span class="ligas-standings__team">
            ${crestHtml(team, r.logoUrl, 'sm')}
            <span class="ligas-standings__team-name">${escapeHtml(team)}</span>
          </span>
        </td>
        <td>${Number(r.played || 0)}</td>
        <td class="ligas-standings__gd">${escapeHtml(gdTxt)}</td>
        <td class="ligas-standings__pts">${Number(r.points || 0)}</td>
      </tr>`;
    })
    .join('');
  return `<div class="ligas-standings__wrap">
    <table class="ligas-standings">
      <thead><tr><th>#</th><th>Equipo</th><th>PJ</th><th>DG</th><th>Pts</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}

function bindLigasStandingsRows(root) {
  root?.querySelectorAll('[data-team-id]').forEach((row) => {
    const open = async () => {
      const teamId = Number(row.getAttribute('data-team-id'));
      if (!Number.isFinite(teamId) || teamId <= 0) return;
      try {
        showBanner('Buscando próximo partido…', 'info');
        const insight = await api(`/api/v1/teams/${teamId}`);
        const nextId = Number(insight?.nextMatch?.id);
        if (!Number.isFinite(nextId) || nextId <= 0) {
          showBanner('Sin partido próximo en la ventana', 'info');
          return;
        }
        showBanner('');
        setActiveNav('#partidos');
        selectedMatchId = nextId;
        openPrediction(nextId).catch((err) => showBanner(err.message || 'Error al abrir', 'error'));
      } catch (err) {
        showBanner(err.message || 'No se pudo cargar el equipo', 'error');
      }
    };
    row.addEventListener('click', () => {
      open().catch(() => {});
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open().catch(() => {});
      }
    });
  });
}

async function showLigasTable(apiId, { pushHash = true } = {}) {
  const aid = Number(apiId);
  if (!Number.isFinite(aid) || aid <= 0) return;
  const nameEl = document.getElementById('ligas-detail-name');
  const metaEl = document.getElementById('ligas-detail-meta');
  const tableEl = document.getElementById('ligas-table');
  if (!tableEl) return;

  ligasActiveApiId = aid;
  setLigasSelectionVisible(true);
  if (pushHash) {
    const want = `#ligas/${aid}`;
    if (location.hash !== want) history.replaceState(null, '', want);
  }

  const folderLeague = LIGAS_FOLDERS.flatMap((f) => f.leagues).find((l) => l.apiId === aid);
  if (nameEl) nameEl.textContent = folderLeague?.name || `Liga ${aid}`;
  if (metaEl) metaEl.textContent = 'Cargando clasificación…';
  tableEl.innerHTML = Array.from({ length: 6 }, () => `<div class="skeleton" aria-hidden="true"></div>`).join('');

  try {
    const catalog = await ensureLigasCatalog();
    const known = catalog.get(aid);
    if (!known) {
      ligasActiveD1Id = null;
      if (metaEl) metaEl.textContent = 'No disponible en datos';
      tableEl.innerHTML = `<p class="ligas-standings__empty">Sin clasificatorio aún</p>`;
      return;
    }
    ligasActiveD1Id = known.id;
    const data = await api(`/api/v1/leagues/${aid}/table`);
    const league = data.league || known;
    ligasActiveD1Id = Number(league.id) || known.id;
    if (nameEl) nameEl.textContent = league.name || folderLeague?.name || `Liga ${aid}`;
    if (metaEl) {
      const bits = [league.country, folderLeague?.tag].filter(Boolean);
      metaEl.textContent = bits.length ? bits.join(' · ') : 'Clasificación (D1)';
    }
    tableEl.innerHTML = ligasStandingsHtml(data.table || []);
    bindLigasStandingsRows(tableEl);
  } catch (err) {
    if (metaEl) metaEl.textContent = '';
    tableEl.innerHTML = `<p class="ligas-standings__error">${escapeHtml(
      err.message || 'Error al cargar la tabla'
    )}</p>`;
  } finally {
    const panel = document.getElementById('ligasBrowsePanel');
    if (panel) panel.scrollTop = 0;
    const view = document.getElementById('ligas');
    if (view && typeof view.scrollIntoView === 'function') {
      view.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }
}

function hideLigasTable({ pushHash = true } = {}) {
  ligasActiveApiId = null;
  ligasActiveD1Id = null;
  setLigasSelectionVisible(false);
  if (pushHash && location.hash !== '#ligas') history.replaceState(null, '', '#ligas');
  const tableEl = document.getElementById('ligas-table');
  if (tableEl) tableEl.innerHTML = '';
}

function renderLigasFolders(catalog) {
  const listEl = document.getElementById('ligas-list');
  if (!listEl) return;

  const folders = LIGAS_FOLDERS.map((folder) => {
    const leagues = folder.leagues
      .map((l) => {
        const hit = catalog.get(l.apiId);
        if (!hit) return null;
        return { ...l, d1Id: hit.id, dbName: hit.name || l.name };
      })
      .filter(Boolean);
    return { ...folder, leagues };
  }).filter((f) => f.leagues.length > 0);

  if (!folders.length) {
    listEl.innerHTML = `<p class="ligas-standings__empty">No hay ligas disponibles todavía.</p>`;
    return;
  }

  if (!folders.some((f) => f.key === ligasOpenFolder)) {
    ligasOpenFolder = folders[0].key;
  }

  listEl.innerHTML = folders
    .map((folder) => {
      const open = folder.key === ligasOpenFolder;
      const flagHtml = folder.flagCountry
        ? `<span class="ligas-folder__flag" aria-hidden="true">${countryFlag(folder.flagCountry)}</span>`
        : `<span class="ligas-folder__uefa" aria-hidden="true">★</span>`;
      return `<section class="ligas-folder${open ? ' is-open' : ''}" data-folder="${escapeHtml(folder.key)}">
        <button type="button" class="ligas-folder__head" data-folder-toggle="${escapeHtml(
          folder.key
        )}" aria-expanded="${open ? 'true' : 'false'}">
          <span class="ligas-folder__chevron" aria-hidden="true"></span>
          ${flagHtml}
          <span class="ligas-folder__label">${escapeHtml(folder.label)}</span>
          <span class="ligas-folder__badge">${escapeHtml(folder.badge)}</span>
        </button>
        <div class="ligas-folder__body" role="group" aria-label="${escapeHtml(folder.label)}">
          <div class="ligas-folder__body-inner">
          ${folder.leagues
            .map(
              (l) => `<button type="button" class="ligas-league-row" data-liga-api="${l.apiId}">
            <span class="ligas-league-row__name">${escapeHtml(l.dbName || l.name)}</span>
            <span class="ligas-league-row__tag">${escapeHtml(l.tag)}</span>
          </button>`
            )
            .join('')}
          </div>
        </div>
      </section>`;
    })
    .join('');

  listEl.querySelectorAll('[data-folder-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-folder-toggle') || '';
      ligasOpenFolder = ligasOpenFolder === key ? '' : key;
      renderLigasFolders(catalog);
    });
  });

  listEl.querySelectorAll('[data-liga-api]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const apiId = Number(btn.getAttribute('data-liga-api'));
      if (!Number.isFinite(apiId)) return;
      const parent = LIGAS_FOLDERS.find((f) => f.leagues.some((l) => l.apiId === apiId));
      if (parent) ligasOpenFolder = parent.key;
      showLigasTable(apiId).catch((err) => showBanner(err.message || 'Error', 'error'));
    });
  });
}

function renderLigasView() {
  const deepApiId = parseLigasApiIdFromHash();
  if (Number.isFinite(deepApiId) && deepApiId > 0) {
    showLigasTable(deepApiId, { pushHash: false }).catch((err) =>
      showBanner(err.message || 'Error', 'error')
    );
    return;
  }

  hideLigasTable({ pushHash: false });
  const listEl = document.getElementById('ligas-list');
  if (listEl && !ligasLeaguesByApiId) {
    listEl.innerHTML = Array.from({ length: 4 }, () => `<div class="skeleton" aria-hidden="true"></div>`).join('');
  }

  ensureLigasCatalog()
    .then((catalog) => {
      if (parseLigasApiIdFromHash()) return;
      renderLigasFolders(catalog);
    })
    .catch((err) => {
      if (listEl) {
        listEl.innerHTML = `<p class="ligas-standings__error">${escapeHtml(
          err.message || 'No se pudieron cargar las ligas'
        )}</p>`;
      }
    });
}

function renderLeagueCategories(matches) {
  const block = document.getElementById('league-block');
  const cats = document.getElementById('league-cats');
  const label = document.getElementById('league-block-label');
  const toggle = document.getElementById('league-toggle');
  if (!block || !cats) return;

  const showCats = scopeFilter === 'clubs' || scopeFilter === 'intl';
  block.hidden = !showCats;
  if (!showCats) {
    leagueFilterIds.clear();
    cats.innerHTML = '';
    return;
  }

  const leagues = collectLeagues(matches, scopeFilter);
  pruneLeagueSelection(leagues);

  const nSel = selectedLeagueCount();
  if (label) {
    const base = scopeFilter === 'intl' ? 'Competiciones' : 'Ligas';
    label.textContent = nSel ? `${base} · ${nSel} seleccionada${nSel === 1 ? '' : 's'}` : `${base} · todas`;
  }
  block.classList.toggle('is-collapsed', !leaguesPanelOpen);
  if (toggle) toggle.setAttribute('aria-expanded', leaguesPanelOpen ? 'true' : 'false');

  if (!leagues.length) {
    cats.innerHTML = `<p class="league-cats__empty">No hay categorías en esta ventana.</p>`;
    return;
  }

  const allActive = nSel === 0;
  const totalMatches = leagues.reduce((n, l) => n + l.count, 0);
  cats.innerHTML = [
    `<div class="league-cats__toolbar">
      <button type="button" class="league-cat league-cat--all${allActive ? ' active' : ''}" data-league-action="all" aria-pressed="${allActive}">
        <span class="league-cat__check" aria-hidden="true"></span>
        <span class="league-cat__flag" aria-hidden="true">🏟️</span>
        <span class="league-cat__body">
          <span class="league-cat__name">${scopeFilter === 'intl' ? 'Todas las competiciones' : 'Todas las ligas'}</span>
          <span class="league-cat__meta">${totalMatches} partidos</span>
        </span>
      </button>
      ${
        nSel
          ? `<button type="button" class="league-cats__clear" data-league-action="clear">Limpiar</button>`
          : ''
      }
    </div>`,
    ...leagues.map((l) => {
      const id = Number(l.id);
      const active = leagueFilterIds.has(id);
      return `<button type="button" class="league-cat${active ? ' active' : ''}" role="option" aria-selected="${active}" data-league="${id}">
        <span class="league-cat__check" aria-hidden="true"></span>
        <span class="league-cat__flag" aria-hidden="true">${countryFlag(l.country)}</span>
        <span class="league-cat__body">
          <span class="league-cat__name">${escapeHtml(shortLeagueName(l.name))}</span>
          <span class="league-cat__meta">${escapeHtml(countryLabel(l.country))} · ${l.count} partido${l.count === 1 ? '' : 's'}</span>
        </span>
      </button>`;
    }),
  ].join('');

  cats.querySelectorAll('[data-league-action="all"], [data-league-action="clear"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      leagueFilterIds.clear();
      applyFilters();
    });
  });
  cats.querySelectorAll('.league-cat[data-league]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.getAttribute('data-league'));
      if (!Number.isFinite(id)) return;
      if (leagueFilterIds.has(id)) leagueFilterIds.delete(id);
      else leagueFilterIds.add(id);
      applyFilters();
    });
  });
}

function showBanner(message, kind = 'info') {
  const el = document.getElementById('global-banner');
  if (!message) {
    el.className = 'banner hidden';
    el.textContent = '';
    return;
  }
  el.className = `banner banner-${kind}`;
  el.textContent = message;
}

function setLoading(containerId, rows = 3) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = Array.from({ length: rows }, () => `<div class="skeleton" aria-hidden="true"></div>`).join('');
}

/* ------------------------------------------------------------------ *
 * Premium (F8): guest cookie + Stripe checkout. No accounts.
 * ------------------------------------------------------------------ */

const premiumState = {
  loaded: false,
  premium: false,
  premiumUntil: null,
  stripeConfigured: false,
};

async function loadPremiumState() {
  try {
    const data = await api(`/api/v1/premium/status`);
    premiumState.premium = Boolean(data.premium);
    premiumState.premiumUntil = data.premiumUntil || null;
    premiumState.stripeConfigured = Boolean(data.stripeConfigured);
  } catch (_) {
    premiumState.stripeConfigured = false;
  }
  premiumState.loaded = true;
  return premiumState;
}

async function startPremiumCheckout() {
  if (!premiumState.loaded) await loadPremiumState();
  if (!premiumState.stripeConfigured) {
    showBanner('El pago premium todavia no esta configurado. Prueba mas tarde.', 'info');
    return;
  }
  try {
    const data = await api(`/api/v1/premium/session`, { method: 'POST' });
    if (data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
    } else {
      showBanner('No se pudo abrir el pago. Intenta de nuevo en unos segundos.', 'error');
    }
  } catch (err) {
    showBanner(`No se pudo iniciar el pago premium: ${err.message}`, 'error');
  }
}

function premiumUpsellHtml(source) {
  // No paywall while PREMIUM_UNLOCKED (no login yet).
  if (PREMIUM_UNLOCKED) return '';
  return `
    <div class="premium-upsell" data-premium-source="${escapeHtml(source)}">
      <span class="premium-upsell__lock" aria-hidden="true">🔒</span>
      <div class="premium-upsell__text">
        <strong>Premium</strong>
        <span>Las combinadas, la rentabilidad y el detalle de tips van con el plan de pago.</span>
      </div>
      <button type="button" class="btn premium-upsell__btn" data-premium-activate>${premiumState.stripeConfigured ? 'Activar con Stripe' : 'Premium'}</button>
    </div>`;
}

function bindPremiumActivate(root = document) {
  root.querySelectorAll('[data-premium-activate]').forEach((btn) => {
    if (btn.dataset.premiumBound) return;
    btn.dataset.premiumBound = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      startPremiumCheckout();
    });
  });
}

/** ?premium=ok|cancel after Stripe (success_url) — banner once, then clean URL. */
async function handlePremiumReturn() {
  const sp = new URLSearchParams(window.location.search);
  const ret = sp.get('premium');
  if (!ret) return;
  if (ret === 'ok') showBanner('Pago confirmado: premium activado. Sera visible en unos segundos.', 'info');
  else showBanner('Pago cancelado sin cargos.', 'info');
  sp.delete('premium');
  const rest = sp.toString();
  window.history.replaceState({}, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
}

/** Keep the #premium view as Pronto teaser (no gate while unlocked). */
function syncPremiumView() {
  const cta = document.getElementById('premium-cta');
  const note = document.querySelector('#premium .premium-note');
  if (!cta) return;
  if (PREMIUM_UNLOCKED) {
    cta.disabled = true;
    cta.textContent = 'Pronto';
    if (note) {
      note.textContent =
        'Todas las funciones están abiertas por ahora. Premium (pago) llegará más adelante.';
    }
    return;
  }
  bindPremiumActivate(cta.closest('#premium') || document);
  if (premiumState.premium) {
    const until = premiumState.premiumUntil ? String(premiumState.premiumUntil).slice(0, 10) : null;
    cta.disabled = true;
    cta.textContent = until ? `Activo hasta ${until}` : 'Premium activo';
    if (note) note.textContent = 'Acceso premium activo, gracias por apoyar el proyecto.';
  } else if (premiumState.stripeConfigured) {
    cta.disabled = false;
    cta.textContent = 'Activar 30 días con Stripe';
    if (note) note.textContent = 'Pago único · activa 30 días de funciones premium.';
  } else {
    cta.disabled = true;
    cta.textContent = 'Sin pago configurado';
    if (note) note.textContent = 'El pago via Stripe se configura en el servidor (STRIPE_* secrets).';
  }
}

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, opts);
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || res.statusText || 'Error de red');
    if (data && data.errorCode) err.code = data.errorCode;
    else err.code = String(res.status);
    throw err;
  }
  return data || {};
}

function setModeBadge(status) {
  const el = document.getElementById('mode-badge');
  if (!el) return;
  el.classList.remove('hidden', 'demo', 'live');
  // Solo avisar en demo; en datos reales no ensuciamos el header
  if (status?.demo) {
    el.textContent = 'DEMO';
    el.classList.add('demo');
    el.title = status.message || 'Modo demo — actualiza el calendario';
    el.hidden = false;
  } else {
    el.textContent = '';
    el.classList.add('hidden');
    el.hidden = true;
    el.title = status?.message || '';
  }
}

function setHitBadge(perf) {
  const badge = document.getElementById('hit-badge');
  if (!badge) return;
  const valueEl = badge.querySelector('.hit-badge__value');
  const hintEl = badge.querySelector('.hit-badge__hint');
  const prev = valueEl?.textContent;
  badge.classList.remove('hidden', 'is-empty');
  let next = '—';
  if (perf?.hitRate != null && perf.decided > 0) {
    const pct = (Number(perf.hitRate) * 100).toFixed(0);
    next = `${pct}%`;
    if (hintEl) hintEl.textContent = 'Aciertos';
    badge.title = `Aciertos históricos ${pct}% (${perf.hits}/${perf.decided}) · no es confianza del modelo`;
  } else if (perf?.pending > 0) {
    next = String(perf.pending);
    if (hintEl) hintEl.textContent = 'Pend.';
    badge.title = 'Tips pendientes de liquidar';
    badge.classList.add('is-empty');
  } else {
    if (hintEl) hintEl.textContent = 'Aciertos';
    badge.title = 'Sin tips cerrados todavía';
    badge.classList.add('is-empty');
  }
  if (valueEl) {
    valueEl.textContent = next;
    if (next !== prev) {
      valueEl.classList.remove('is-reveal');
      void valueEl.offsetWidth;
      valueEl.classList.add('is-reveal');
    }
  } else {
    badge.textContent = next;
  }
}

function formatAgo(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `hace ${hrs} h`;
  return String(iso).slice(0, 10);
}

function renderAdminStatus(status) {
  const el = document.getElementById('admin-status');
  if (!el) return;
  if (!status) {
    el.textContent = 'Sin estado.';
    return;
  }
  const lines = [];
  lines.push(
    status.oddsEnabled
      ? 'API-Football: activa'
      : 'API-Football: sin key → sin cuotas; stats FotMob activas'
  );
  const cov =
    status.oddsCoveragePct != null
      ? `${status.upcomingWithOdds ?? 0}/${status.upcomingCount ?? 0} con cuota (${status.oddsCoveragePct}%)`
      : `${status.oddsMatchCount ?? 0} filas odds`;
  lines.push(`Cobertura: ${cov}`);
  lines.push(
    `Córners ${status.cornersMatchCount ?? 0} · amarillas ${status.yellowsMatchCount ?? 0} · SOT ${status.shotsOnTargetMatchCount ?? 0}`
  );
  const syncAgo = formatAgo(status.lastSyncAt);
  const enrichAgo = formatAgo(status.lastEnrichAt);
  lines.push(`Sync ${syncAgo || '—'}${enrichAgo ? ` · enrich ${enrichAgo}` : ''}`);
  const es = status.lastEnrichSummary;
  if (es && typeof es === 'object') {
    lines.push(
      `Último enrich: odds ${es.oddsSynced ?? 0}/${es.queued ?? '—'} · miss ${es.nameMiss ?? 0} · vacío ${es.emptyOdds ?? 0} · direct ${es.directHits ?? 0}`
    );
  }
  if (status.calibrationDecided != null) {
    lines.push(`Calibración: ${status.calibrationDecided} tips`);
  }
  if (status.message) lines.push(status.message);
  el.innerHTML = lines.map((l) => `<div>${escapeHtml(l)}</div>`).join('');
}

function setSyncLabel(status) {
  const el = document.getElementById('sync-label');
  const dateEl = document.getElementById('today-label');
  if (!el) return;
  renderAdminStatus(status);
  const raw = status?.lastSyncAt;
  if (!raw) {
    el.hidden = true;
    el.textContent = '';
    if (dateEl) dateEl.removeAttribute('title');
    return;
  }
  const t = Date.parse(raw);
  if (Number.isNaN(t)) {
    el.hidden = true;
    return;
  }
  const hours = Math.max(0, Math.round((Date.now() - t) / 36e5));
  const short =
    hours <= 0 ? 'Sync hace un momento' : hours === 1 ? 'Sync hace 1 h' : `Sync hace ${hours} h`;
  const full = `Última sincronización: ${new Date(t).toLocaleString('es-ES')}`;
  el.hidden = false;
  el.textContent = short;
  el.title = full;
  if (dateEl) dateEl.title = full;
}

function updateTitles() {
  /* Window is shown by the active chip; no redundant H2. */
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowYmd() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function yesterdayYmd() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function ymdAddDays(ymd, delta) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function formatDateCenter(ymd) {
  const [y, m, d] = String(ymd).split('-');
  if (!y || !m || !d) return ymd;
  return `${d}.${m}.${y}`;
}

function resolveSelectedDate() {
  if (windowMode === 'hoy') return todayYmd();
  if (windowMode === 'manana') return tomorrowYmd();
  if (windowMode === 'ayer') return yesterdayYmd();
  return selectedDate || todayYmd();
}

/** D1 leagueId last requested to matches/today (null = all leagues for the date). */
let matchesFetchLeagueId = null;
let matchesReloadQueued = false;

function matchListQuery() {
  const d = resolveSelectedDate();
  selectedDate = d;
  let q = `date=${encodeURIComponent(d)}`;
  // Single D1 league selection → server-side filter (multi stays client-side)
  if (leagueFilterIds.size === 1) {
    const lid = [...leagueFilterIds][0];
    if (Number.isFinite(Number(lid))) q += `&leagueId=${encodeURIComponent(String(lid))}`;
  }
  return q;
}

function desiredMatchesFetchLeagueId() {
  if (leagueFilterIds.size !== 1) return null;
  const lid = Number([...leagueFilterIds][0]);
  return Number.isFinite(lid) ? lid : null;
}

/** Aciertos + hit-badge: always full tip history (ignore Pronósticos window). */
const TIPS_PERF_GLOBAL_Q = 'all=1';

function syncWindowChips() {
  selectedDate = resolveSelectedDate();
  const label = document.getElementById('dateCenterLabel');
  if (label) label.textContent = formatDateCenter(selectedDate);
  const dateInput = document.getElementById('match-date');
  if (dateInput) dateInput.value = selectedDate;

  const map = {
    yesterdayBtn: windowMode === 'ayer' || selectedDate === yesterdayYmd(),
    todayBtn: windowMode === 'hoy' || selectedDate === todayYmd(),
    tomorrowBtn: windowMode === 'manana' || selectedDate === tomorrowYmd(),
  };
  // Prefer exact date match for pressed state
  const y = yesterdayYmd();
  const t = todayYmd();
  const n = tomorrowYmd();
  document.getElementById('yesterdayBtn')?.classList.toggle('is-active', selectedDate === y);
  document.getElementById('yesterdayBtn')?.setAttribute('aria-pressed', selectedDate === y ? 'true' : 'false');
  document.getElementById('todayBtn')?.classList.toggle('is-active', selectedDate === t);
  document.getElementById('todayBtn')?.setAttribute('aria-pressed', selectedDate === t ? 'true' : 'false');
  document.getElementById('tomorrowBtn')?.classList.toggle('is-active', selectedDate === n);
  document.getElementById('tomorrowBtn')?.setAttribute('aria-pressed', selectedDate === n ? 'true' : 'false');
  void map;
}

function syncLiveChip() {
  /* live is a status chip now */
}

function shiftDay(delta) {
  selectedDate = ymdAddDays(resolveSelectedDate(), delta);
  const t = todayYmd();
  if (selectedDate === t) windowMode = 'hoy';
  else if (selectedDate === tomorrowYmd()) windowMode = 'manana';
  else if (selectedDate === yesterdayYmd()) windowMode = 'ayer';
  else windowMode = 'date';
  selectedMatchId = null;
  syncWindowChips();
  persistFiltersIfAllowed();
  load().catch((err) => showBanner(err.message, 'error'));
}

function setDayPreset(kind) {
  if (kind === 'yesterday') {
    windowMode = 'ayer';
    selectedDate = yesterdayYmd();
  } else if (kind === 'tomorrow') {
    windowMode = 'manana';
    selectedDate = tomorrowYmd();
  } else {
    windowMode = 'hoy';
    selectedDate = todayYmd();
  }
  selectedMatchId = null;
  syncWindowChips();
  persistFiltersIfAllowed();
  load().catch((err) => showBanner(err.message, 'error'));
}

function matchBrowseBucket(m) {
  const st = String(m.status || '');
  if (st === 'live') return 'live';
  if (st === 'finished') return 'finished';
  if (st === 'scheduled') return 'upcoming';
  return null;
}

function statusCounts(list) {
  const c = { all: list.length, live: 0, finished: 0, upcoming: 0 };
  for (const m of list) {
    const b = matchBrowseBucket(m);
    if (b && c[b] != null) c[b] += 1;
  }
  return c;
}

function renderStatusFilters(list) {
  const el = document.getElementById('matchStatusFilters');
  if (!el) return;
  if (!['all', 'live', 'finished', 'upcoming'].includes(statusFilter)) {
    statusFilter = 'all';
  }
  const c = statusCounts(list);
  const items = [
    ['all', 'Todos', c.all],
    ['live', 'En vivo', c.live],
    ['finished', 'Finalizados', c.finished],
    ['upcoming', 'Próximos', c.upcoming],
  ];
  el.innerHTML = items
    .map(([id, lab, n]) => {
      const on = statusFilter === id;
      return `<button type="button" class="browse-chip${on ? ' is-active' : ''}" data-status="${id}" aria-label="${escapeHtml(
        lab
      )} (${n})" aria-pressed="${on ? 'true' : 'false'}"><span class="browse-chip__label">${escapeHtml(
        lab
      )}</span><span class="browse-chip__count">${n}</span></button>`;
    })
    .join('');
  el.querySelectorAll('[data-status]').forEach((btn) => {
    btn.addEventListener('click', () => {
      statusFilter = btn.dataset.status || 'all';
      persistFiltersIfAllowed();
      renderPartidosList();
      renderStatusFilters(scopedMatches());
    });
  });
}

function scopedMatches() {
  let list = cachedMatches.slice();
  if (scopeFilter === 'clubs') {
    list = list.filter((m) => !isInternationalMatch(m));
  } else if (scopeFilter === 'intl') {
    list = list.filter((m) => isInternationalMatch(m));
  }
  if (leagueFilterIds.size) {
    list = list.filter((m) => leagueFilterIds.has(Number(m.leagueId)));
  }
  return list;
}

function filteredBrowseMatches() {
  const list = scopedMatches();
  if (statusFilter === 'all') return list;
  return list.filter((m) => matchBrowseBucket(m) === statusFilter);
}

function leagueKey(m) {
  const country = m.leagueCountry || m.country || '';
  const name = m.leagueName || m.league || 'Liga';
  return [country, name].filter(Boolean).join(' · ') || 'Liga';
}

function browseRowHtml(m) {
  const id = Number(m.id);
  const home = m.homeTeam?.name || '';
  const away = m.awayTeam?.name || '';
  const homeLogo = m.homeTeam?.logo;
  const awayLogo = m.awayTeam?.logo;
  const sel = selectedMatchId === id ? ' is-selected' : '';
  const liveCls = m.status === 'live' ? ' league-match--live' : '';
  const showEvents = m.status === 'live' || m.status === 'finished';
  const liveStrip = m.status === 'live' ? liveStripHtml(m) : '';
  return `
    <button type="button" class="league-match${liveCls}${sel}" data-analyze="${id}" role="listitem">
      <span class="league-match__main">
        <span class="league-match__home">
          ${crestHtml(home, homeLogo, 'sm')}
          <span class="league-match__name">${escapeHtml(home)}</span>
        </span>
        <span class="league-match__mid">${browseMidHtml(m)}</span>
        <span class="league-match__away">
          <span class="league-match__name">${escapeHtml(away)}</span>
          ${crestHtml(away, awayLogo, 'sm')}
        </span>
      </span>
      ${showEvents ? matchEventsHtml(m.events) : ''}
      ${liveStrip}
    </button>`;
}

function renderPartidosList() {
  const el = document.getElementById('matches');
  const countEl = document.getElementById('match-count');
  if (!el) return;
  const rows = filteredBrowseMatches();
  if (countEl) countEl.textContent = `${rows.length} partidos`;
  if (!rows.length) {
    el.innerHTML = `<div class="empty-board">Sin partidos para ${escapeHtml(
      formatDateCenter(resolveSelectedDate())
    )} con estos filtros.</div>`;
    return;
  }
  const groups = new Map();
  for (const m of rows) {
    const k = leagueKey(m);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  el.innerHTML = [...groups.entries()]
    .map(
      ([title, matches]) => `
      <section class="league" role="group" aria-label="${escapeHtml(title)}">
        <h3 class="league__title">${escapeHtml(title)}</h3>
        <div class="league__list">${matches.map(browseRowHtml).join('')}</div>
      </section>`
    )
    .join('');
  bindAnalyze(el);
}

const TOP10_MIN_PROB = 69;
const TOP10_MIN_ODDS = 1.3;
const TOP10_MAX_ODDS = 3.5;

function tipValueScore(m) {
  const edge = m.valueEdge != null ? Number(m.valueEdge) : null;
  const hasBook =
    m.oddsSource === 'book' ||
    (m.tipOdds != null && Number(m.tipOdds) > 1 && edge != null);
  if (hasBook && edge != null && Number.isFinite(edge)) return { score: edge, kind: 'value' };
  const conf = Number(m.confidenceScore);
  if (Number.isFinite(conf)) return { score: conf / 100, kind: 'conf' };
  return { score: -Infinity, kind: 'none' };
}

/** Top 10 rank: P≥69% and cuota 1.30–3.50 → score prob * ln(odds) (+ edge boost). */
function tipPlayableScore(m) {
  const prob = tipProbPct(m);
  if (prob == null || !Number.isFinite(Number(prob)) || Number(prob) < TOP10_MIN_PROB) {
    return null;
  }
  const bookOdds = m.tipOdds != null ? Number(m.tipOdds) : null;
  const hasBook =
    Number.isFinite(bookOdds) && bookOdds > 1 && (m.oddsSource === 'book' || bookOdds != null);
  let odds = hasBook ? bookOdds : null;
  if (odds == null) {
    const p = Number(prob) / 100;
    if (p > 0.01 && p < 0.99) odds = 1 / p;
  }
  if (odds == null || !Number.isFinite(odds) || odds < TOP10_MIN_ODDS || odds > TOP10_MAX_ODDS) {
    return null;
  }
  let score = (Number(prob) / 100) * Math.log(Math.max(odds, 1.01));
  const edge = m.valueEdge != null ? Number(m.valueEdge) : null;
  if (edge != null && Number.isFinite(edge)) score += Math.max(0, edge) * 0.15;
  if (!(hasBook && m.oddsSource === 'book')) score -= 0.05;
  return {
    score,
    kind: hasBook && m.oddsSource === 'book' ? 'book' : 'est',
  };
}

const TOP10_MAX_PER_FAMILY = 3;

function tipFamilyUi(code) {
  const b = String(code || '').toUpperCase();
  if (b === 'HOME_WIN' || b === 'DRAW' || b === 'AWAY_WIN') return '1x2';
  if (b.startsWith('DC_') || b.startsWith('DNB_')) return 'dc';
  if (b === 'BTTS_YES' || b === 'BTTS_NO') return 'btts';
  if (
    b.startsWith('OVER_') ||
    b.startsWith('UNDER_') ||
    b.startsWith('HOME_OVER') ||
    b.startsWith('HOME_UNDER') ||
    b.startsWith('AWAY_OVER') ||
    b.startsWith('AWAY_UNDER')
  ) {
    return 'ou';
  }
  if (b.startsWith('CORNERS_')) return 'corners';
  if (b.startsWith('CARDS_')) return 'cards';
  if (b.startsWith('SHOTS_')) return 'shots';
  if (b.startsWith('SOT_')) return 'shots_on_target';
  return 'other';
}

/**
 * Top 10 diversity: max 1 per exact label, max 3 per family (pass 1).
 * Pass 2 fills remaining slots with maxPerLabel only (still no inventing).
 * At most one tip per matchId when present.
 */
function selectDiverseTips(sortedTips, limit = 3, maxPerLabel = 1, maxPerFamily = TOP10_MAX_PER_FAMILY) {
  const selected = [];
  const usedLabels = new Map();
  const usedFamilies = new Map();
  const usedMatches = new Set();
  const maxLabel = Math.max(1, Number(maxPerLabel) || 1);
  const maxFam = Math.max(1, Number(maxPerFamily) || TOP10_MAX_PER_FAMILY);
  const items = [...(sortedTips || [])];

  const labelOf = (item) =>
    item?.tipLabel || item?.m?.suggestedBet || item?.suggestedBet || '';
  const matchIdOf = (item) => {
    const id = item?.matchId ?? item?.m?.id ?? item?.id;
    return id != null ? Number(id) : null;
  };

  const tryPick = (enforceFamilyCap) => {
    while (selected.length < limit) {
      let best = null;
      let bestIdx = Infinity;
      let bestFamMalus = Infinity;
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (selected.includes(item)) continue;
        const label = labelOf(item);
        if (!label || (usedLabels.get(label) || 0) >= maxLabel) continue;
        const mid = matchIdOf(item);
        if (mid != null && usedMatches.has(mid)) continue;
        const fam = tipFamilyUi(label);
        const famCount = usedFamilies.get(fam) || 0;
        if (enforceFamilyCap && famCount >= maxFam) continue;
        if (famCount < bestFamMalus || (famCount === bestFamMalus && i < bestIdx)) {
          best = item;
          bestIdx = i;
          bestFamMalus = famCount;
        }
      }
      if (!best) break;
      const label = labelOf(best);
      const fam = tipFamilyUi(label);
      const mid = matchIdOf(best);
      selected.push(best);
      usedLabels.set(label, (usedLabels.get(label) || 0) + 1);
      usedFamilies.set(fam, (usedFamilies.get(fam) || 0) + 1);
      if (mid != null) usedMatches.add(mid);
    }
  };

  tryPick(true);
  if (selected.length < limit) tryPick(false);
  return selected;
}

/** Primary + secondary candidates (same match may appear twice until select dedupes). */
function buildTop10Pool(matches) {
  const pool = [];
  const isBannedShots = (lab) => String(lab || '').startsWith('SHOTS_');
  for (const raw of matches || []) {
    if (!raw?.suggestedBet || isBannedShots(raw.suggestedBet)) continue;
    const primaryView = {
      ...raw,
      suggestedBet: raw.suggestedBet,
      tipOdds: raw.tipOdds,
      oddsSource: raw.oddsSource,
      confidenceScore: raw.confidenceScore,
    };
    const primaryMeta = tipPlayableScore(primaryView);
    if (primaryMeta) {
      pool.push({
        m: primaryView,
        tipLabel: raw.suggestedBet,
        matchId: raw.id,
        isSecondary: false,
        meta: primaryMeta,
      });
    }
    const sec = raw.secondaryBet;
    if (!sec || isBannedShots(sec) || tipFamilyUi(sec) === tipFamilyUi(raw.suggestedBet)) {
      continue;
    }
    const secView = {
      ...raw,
      suggestedBet: sec,
      tipOdds: raw.secondaryTipOdds != null ? raw.secondaryTipOdds : raw.tipOdds,
      oddsSource: raw.secondaryOddsSource || raw.oddsSource,
      confidenceScore:
        raw.secondaryConfidence != null ? raw.secondaryConfidence : raw.confidenceScore,
      valueEdge: null,
    };
    const secMeta = tipPlayableScore(secView);
    if (secMeta) {
      // Prefer primary rank slightly when both exist.
      secMeta.score -= 0.01;
      pool.push({
        m: secView,
        tipLabel: sec,
        matchId: raw.id,
        isSecondary: true,
        meta: secMeta,
      });
    }
  }
  return pool.sort((a, b) => {
    if (a.meta.kind === 'book' && b.meta.kind !== 'book') return -1;
    if (b.meta.kind === 'book' && a.meta.kind !== 'book') return 1;
    return b.meta.score - a.meta.score;
  });
}

let top3LoadSeq = 0;

/** Top 10 from server best-bets (same pool as API count), not a stricter client-only filter. */
async function renderTop3() {
  const el = document.getElementById('top3-list');
  if (!el) return;
  const seq = ++top3LoadSeq;
  const dayLabel = formatDateCenter(resolveSelectedDate());
  el.innerHTML = Array.from({ length: 4 }, () => `<div class="skeleton" aria-hidden="true"></div>`).join('');
  try {
    const date = resolveSelectedDate();
    const data = await api(
      `/api/v1/matches/best-bets?date=${encodeURIComponent(date)}&limit=10`
    );
    if (seq !== top3LoadSeq) return;
    const bets = (data.bets || []).slice(0, 10);
    if (!bets.length) {
      el.innerHTML = `<div class="empty-board">Sin tips P≥69% con cuota 1.30–3.50 para ${escapeHtml(
        dayLabel
      )}.</div>`;
      return;
    }
    el.innerHTML = bets
      .map((bet, i) => {
        const home = bet.homeTeam?.name || '';
        const away = bet.awayTeam?.name || '';
        const tip = bet.suggestedBet;
        const tipLabel = tip ? labelBet(tip, home, away) : 'Sin tip';
        const m = {
          ...bet,
          id: bet.matchId,
          leagueName: bet.league,
          suggestedBet: tip,
        };
        const prob = tipProbPct(m);
        const oddsTxt = tipOddsDisplay(bet.tipOdds);
        const edge = bet.valueEdge != null ? Number(bet.valueEdge) : null;
        const valueTxt =
          edge != null && Number.isFinite(edge) && bet.oddsSource === 'book'
            ? `Valor +${(edge * 100).toFixed(0)}%`
            : edge != null && Number.isFinite(edge)
              ? `Edge ${(edge * 100).toFixed(0)}%`
              : '';
        const rank = i + 1;
        const matchId = Number(bet.matchId);
        const liveStrip = bet.status === 'live' ? liveStripHtml(m) : '';
        return `
      <article class="card card--tip card--row card--top3" data-analyze="${matchId}">
        <div class="card-tip__body">
          <div class="top3-rank">#${rank}</div>
          <div class="card-tip__primary">
            <span class="card-tip__bet tip-accent">${escapeHtml(tipLabel)}</span>
            ${
              prob != null
                ? `<span class="${confClass(prob)} card-tip__conf">${Math.round(Number(prob))}%</span>`
                : ''
            }
          </div>
          ${liveStrip}
          <div class="top3-metrics">
            ${prob != null ? `<span class="top3-metrics__item"><em>Prob</em> ${Math.round(Number(prob))}%</span>` : ''}
            ${oddsTxt ? `<span class="top3-metrics__item"><em>Cuota</em> ${escapeHtml(oddsTxt)}</span>` : '<span class="top3-metrics__item muted"><em>Cuota</em> sin book</span>'}
            ${valueTxt ? `<span class="top3-metrics__item top3-metrics__item--value">${escapeHtml(valueTxt)}</span>` : ''}
          </div>
          ${crestsRowHtml(home, bet.homeTeam?.logo, away, bet.awayTeam?.logo)}
          <p class="card-tip__match">${escapeHtml(home)} vs ${escapeHtml(away)}</p>
          <p class="card-tip__league muted">${escapeHtml(leagueKey(m))} · ${escapeHtml(
            formatMatchDate(bet.matchDate)
          )}</p>
        </div>
        <button class="primary card-tip__action" data-analyze="${matchId}" type="button">Analizar</button>
      </article>`;
      })
      .join('');
    bindAnalyze(el);
  } catch (err) {
    if (seq !== top3LoadSeq) return;
    el.innerHTML = `<div class="empty-board">No se pudo cargar el Top 10: ${escapeHtml(
      err.message || 'error'
    )}</div>`;
  }
}

function isDesktopSplit() {
  const onPartidos = document.getElementById('views')?.dataset.view === 'partidos';
  return onPartidos && window.matchMedia('(min-width: 900px)').matches;
}

function formatOdds(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Number(n).toFixed(2);
}

function tipOddsFromBundle(suggestedBet, oddsRow) {
  if (!oddsRow || !suggestedBet) return null;
  const map = {
    HOME_WIN: oddsRow.home_odds,
    DRAW: oddsRow.draw_odds,
    AWAY_WIN: oddsRow.away_odds,
    OVER_15: oddsRow.over15_odds,
    UNDER_15: oddsRow.under15_odds,
    OVER_25: oddsRow.over25_odds,
    UNDER_25: oddsRow.under25_odds,
    OVER_35: oddsRow.over35_odds,
    UNDER_35: oddsRow.under35_odds,
    BTTS_YES: oddsRow.btts_yes_odds,
    BTTS_NO: oddsRow.btts_no_odds,
    SOT_OVER_75: oddsRow.sot_over75_odds,
    SOT_UNDER_75: oddsRow.sot_under75_odds,
    SOT_OVER_85: oddsRow.sot_over85_odds,
    SOT_UNDER_85: oddsRow.sot_under85_odds,
    SOT_OVER_95: oddsRow.sot_over95_odds,
    SOT_UNDER_95: oddsRow.sot_under95_odds,
    CORNERS_OVER_85: oddsRow.corners_over85_odds,
    CORNERS_UNDER_85: oddsRow.corners_under85_odds,
    CORNERS_OVER_95: oddsRow.corners_over95_odds,
    CORNERS_UNDER_95: oddsRow.corners_under95_odds,
    CORNERS_OVER_105: oddsRow.corners_over105_odds,
    CORNERS_UNDER_105: oddsRow.corners_under105_odds,
    CARDS_OVER_35: oddsRow.cards_over35_odds,
    CARDS_UNDER_35: oddsRow.cards_under35_odds,
    CARDS_OVER_45: oddsRow.cards_over45_odds,
    CARDS_UNDER_45: oddsRow.cards_under45_odds,
  };
  return formatOdds(map[suggestedBet]);
}

/** Book tip odds for UI: `1.85 €` or empty (no @ / — / lone €). */
function tipOddsDisplay(tipOdds) {
  if (tipOdds == null || Number.isNaN(Number(tipOdds))) return '';
  const n = formatOdds(tipOdds);
  return n ? `${n} €` : '';
}

function tipMetaHtml({
  tipOdds,
  valueEdge,
  valueMarket,
  home,
  away,
  oddsSource,
  dataQuality,
  tipTier = null,
  conf = null,
}) {
  const bits = [];
  const oddsTxt = tipOddsDisplay(tipOdds);
  if (oddsTxt) {
    const srcLab =
      oddsSource && oddsSource !== 'book'
        ? ` <span class="muted">(${escapeHtml(oddsSourceLabel(oddsSource))})</span>`
        : '';
    bits.push(`<span class="tip-odds">${oddsTxt}${srcLab}</span>`);
  } else if (oddsSource && oddsSource !== 'book') {
    bits.push(`<span class="muted">sin cuota de casa</span>`);
  }
  if (dataQuality === 'low') bits.push('<span class="data-q data-q--low">muestra baja</span>');
  if (valueEdge != null && valueEdge >= MIN_VALUE_EDGE && oddsSource === 'book') {
    bits.push(
      `<span class="value">Valor +${(Number(valueEdge) * 100).toFixed(0)}%${
        valueMarket ? ` · ${escapeHtml(labelBet(valueMarket, home, away))}` : ''
      }</span>`
    );
  }
  if (tipTier === 'fallback') {
    bits.push('<span class="muted">sin tip ≥69%</span>');
  } else if (tipTier === 'playable' && conf != null && Number(conf) >= 80) {
    bits.push('<span class="muted">tip seguro</span>');
  }
  return bits.length ? `<div class="tip-meta">${bits.join(' · ')}</div>` : '';
}

function tipCardHtml({
  matchId,
  home,
  away,
  homeLogo,
  awayLogo,
  league,
  when,
  tip,
  conf,
  secondary,
  tipOdds,
  valueEdge,
  valueMarket,
  oddsSource = null,
  dataQuality = null,
  tipTier = null,
  liveHtml = '',
  clickable = false,
  analyzeBtn = false,
}) {
  const tipLabel = tip ? escapeHtml(labelBet(tip, home, away)) : 'Sin tip';
  const confLabel =
    tip && conf != null && !Number.isNaN(Number(conf)) ? `${Math.round(Number(conf))}%` : '';
  const classes = [
    'card',
    'card--tip',
    clickable ? 'card--clickable' : '',
    analyzeBtn ? 'card--row' : '',
    dataQuality === 'low' ? 'card--low-sample' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const attrs = clickable
    ? ` data-analyze="${Number(matchId)}" role="button" tabindex="0"`
    : '';
  return `
    <article class="${classes}"${attrs}>
      <div class="card-tip__body">
        <div class="card-tip__primary">
          <span class="card-tip__bet tip-accent">${tipLabel}</span>
          ${confLabel ? `<span class="${confClass(conf)} card-tip__conf">${confLabel}</span>` : ''}
        </div>
        ${tipMetaHtml({
          tipOdds,
          valueEdge,
          valueMarket,
          home,
          away,
          oddsSource,
          dataQuality,
          tipTier,
          conf,
        })}
        ${crestsRowHtml(home, homeLogo, away, awayLogo)}
        <p class="card-tip__match">${escapeHtml(home)} vs ${escapeHtml(away)}</p>
        <p class="card-tip__league muted">${escapeHtml(league)}${liveHtml ? ` · ${liveHtml}` : ''}</p>
        <p class="card-tip__when match-date">${escapeHtml(when)}</p>
        ${
          secondary
            ? `<p class="card-tip__sec muted">Secundaria · ${escapeHtml(
                labelBet(secondary, home, away)
              )}</p>`
            : ''
        }
      </div>
      ${
        analyzeBtn
          ? `<button class="primary card-tip__action" data-analyze="${Number(matchId)}" type="button">Analizar</button>`
          : ''
      }
    </article>`;
}

function bindAnalyze(root) {
  root.querySelectorAll('[data-analyze]').forEach((node) => {
    const open = () => {
      const id = Number(node.dataset.analyze);
      selectedMatchId = id;
      document.querySelectorAll('.league-match.is-selected').forEach((el) => el.classList.remove('is-selected'));
      if (node.classList.contains('league-match')) node.classList.add('is-selected');
      const view = document.getElementById('views')?.dataset.view;
      // From Top 3 on desktop → Partidos split so Generales/Goles/Tiros… are visible
      if (view === 'top3' && window.matchMedia('(min-width: 900px)').matches) {
        setActiveNav('#partidos');
        requestAnimationFrame(() => {
          document.querySelector(`.league-match[data-analyze="${id}"]`)?.classList.add('is-selected');
          openPrediction(id);
        });
        return;
      }
      openPrediction(id);
    };
    if (node.tagName === 'BUTTON') {
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        open();
      });
      return;
    }
    node.addEventListener('click', open);
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
  });
}

function updateFilterChip() {
  const el = document.getElementById('filter-chip');
  if (!el) return;
  const parts = [];
  if (windowMode === '5d') parts.push('5 días');
  else if (windowMode === 'manana') parts.push('Mañana');
  else if (windowMode === 'date') parts.push(selectedDate);
  else parts.push('Hoy');
  if (scopeFilter === 'clubs') parts.push('Ligas de clubes');
  else if (scopeFilter === 'intl') parts.push('Internacionales');
  if (leagueFilterIds.size === 1) parts.push('1 liga');
  else if (leagueFilterIds.size > 1) parts.push(`${leagueFilterIds.size} ligas`);
  el.textContent = parts.join(' · ');
}

function resolveMarkets(m) {
  if (m.markets) return m.markets;
  const toPct = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return n <= 1 ? Number((n * 100).toFixed(1)) : Number(n.toFixed(1));
  };
  return {
    home: toPct(m.homeWinProb),
    draw: toPct(m.drawProb),
    away: toPct(m.awayWinProb),
    over25: toPct(m.over25Prob),
    under25: toPct(m.under25Prob),
    bttsYes: toPct(m.bttsYesProb),
    bttsNo: toPct(m.bttsNoProb),
  };
}

function tipProbPct(raw) {
  const tip = String(raw.suggestedBet || raw.tip || '');
  const markets = resolveMarkets(raw) || {};
  const map = {
    HOME_WIN: markets.home,
    DRAW: markets.draw,
    AWAY_WIN: markets.away,
    OVER_25: markets.over25,
    UNDER_25: markets.under25,
    BTTS_YES: markets.bttsYes,
    BTTS_NO: markets.bttsNo,
  };
  if (map[tip] != null) return map[tip];
  const conf = raw.confidenceScore ?? raw.conf;
  return conf != null && !Number.isNaN(Number(conf)) ? Number(conf) : null;
}

function matchBoardHeaderHtml() {
  return `<div class="sheet__head" aria-hidden="true">
    <span>Partido</span>
    <span>Prob</span>
    <span>Tip</span>
    <span>Cuota</span>
  </div>`;
}

function matchBoardRowHtml(raw) {
  const id = raw.id ?? raw.matchId;
  const home = raw.homeTeam?.name || raw.home || '';
  const away = raw.awayTeam?.name || raw.away || '';
  const homeLogo = raw.homeTeam?.logo || raw.homeLogo;
  const awayLogo = raw.awayTeam?.logo || raw.awayLogo;
  const league = raw.leagueName || raw.league || '';
  const tip = raw.suggestedBet || raw.tip;
  const tipOdds = raw.tipOdds;
  const prob = tipProbPct(raw);
  const liveBadge =
    raw.status === 'live' ? '<span class="badge live">EN VIVO</span>' : '';
  const score =
    raw.homeGoals != null && raw.awayGoals != null
      ? `<span class="match-score">${Number(raw.homeGoals)}-${Number(raw.awayGoals)}</span>`
      : '';
  const minute =
    raw.status === 'live' && raw.elapsedMinute != null
      ? `<span class="match-minute">${Number(raw.elapsedMinute)}'</span>`
      : '';
  const liveBits = [liveBadge, score, minute].filter(Boolean).join(' ');
  const tipLabel = tip ? escapeHtml(labelBet(tip, home, away)) : '—';
  const oddsTxt = tipOddsDisplay(tipOdds);
  const tipTier =
    raw.tipTier ||
    (prob != null && Number(prob) >= 69 ? 'playable' : tip ? 'fallback' : null);
  const valueBit =
    raw.valueEdge != null &&
    Number(raw.valueEdge) >= MIN_VALUE_EDGE &&
    raw.oddsSource === 'book'
      ? `<span class="sheet__edge">+${(Number(raw.valueEdge) * 100).toFixed(0)}%</span>`
      : '';
  const oddsSrcBit =
    oddsTxt && raw.oddsSource && raw.oddsSource !== 'book'
      ? `<span class="muted sheet__odd-src">${escapeHtml(oddsSourceLabel(raw.oddsSource))}</span>`
      : '';
  const tierBit =
    tipTier === 'fallback'
      ? '<span class="muted sheet__odd-src">sin tip ≥69%</span>'
      : tipTier === 'playable' && prob != null && Number(prob) >= 80
        ? '<span class="muted sheet__odd-src">tip seguro</span>'
        : '';

  return `
    <button type="button" class="sheet__row" data-analyze="${Number(id)}" role="listitem">
      <span class="sheet__match">
        <span class="sheet__crests" aria-hidden="true">
          ${crestHtml(home, homeLogo, 'sm')}
          ${crestHtml(away, awayLogo, 'sm')}
        </span>
        <span class="sheet__names">
          <span class="sheet__vs">${escapeHtml(home)} – ${escapeHtml(away)}</span>
          <span class="sheet__meta">${escapeHtml(league)} · ${escapeHtml(
            formatMatchDate(raw.matchDate)
          )}${liveBits ? ` · ${liveBits}` : ''}</span>
        </span>
      </span>
      <span class="sheet__prob ${confClass(prob)}">${
        prob != null ? `${Math.round(Number(prob))}%` : '—'
      }</span>
      <span class="sheet__tip">
        <span class="sheet__tip-bet">${tipLabel}</span>
        ${valueBit}
        ${tierBit}
      </span>
      <span class="sheet__odd">
        <span class="sheet__odd-v">${oddsTxt || '—'}</span>
        ${oddsSrcBit}
      </span>
    </button>`;
}

function premiumLockHtml(extraCount, kind) {
  if (PREMIUM_UNLOCKED) return '';
  const label =
    kind === 'valor'
      ? `+${extraCount} valor · Premium`
      : `+${extraCount} tips · Premium`;
  return `<button type="button" class="sheet__lock" data-goto-premium="1">
    <span>
      <span class="sheet__lock-title">${escapeHtml(label)}</span>
      <span class="sheet__lock-meta">Desbloquea en Premium</span>
    </span>
    <span class="muted">Premium →</span>
  </button>`;
}

function betFamily(code) {
  const b = String(code || '').toUpperCase();
  if (b === 'HOME_WIN' || b === 'DRAW' || b === 'AWAY_WIN') return '1x2';
  if (b === 'OVER_25' || b === 'UNDER_25') return 'ou25';
  if (b === 'BTTS_YES' || b === 'BTTS_NO') return 'btts';
  return 'other';
}

function rowsForHoyTab() {
  const tab = hoyMarketTab;
  const source =
    tab === 'top' || tab === 'valor'
      ? cachedBets
      : cachedMatches.length
        ? cachedMatches
        : cachedBets;
  const filtered = filterByScope(source).filter((m) => m.suggestedBet);
  let rows = filtered;
  if (tab === '1x2') rows = filtered.filter((m) => betFamily(m.suggestedBet) === '1x2');
  else if (tab === 'ou25') rows = filtered.filter((m) => betFamily(m.suggestedBet) === 'ou25');
  else if (tab === 'btts') rows = filtered.filter((m) => betFamily(m.suggestedBet) === 'btts');
  else if (tab === 'valor') {
    rows = filtered.filter(
      (m) =>
        m.valueEdge != null && Number(m.valueEdge) >= MIN_VALUE_EDGE && m.oddsSource === 'book'
    );
  }
  // All market tabs: kickoff fecha+hora ascending (not prob/cuota/edge rank).
  return sortByMatchDateAsc(rows, (a, b) => {
    if (tab === 'valor') return Number(b.valueEdge || 0) - Number(a.valueEdge || 0);
    return Number(b.confidenceScore || 0) - Number(a.confidenceScore || 0);
  });
}

function applyFreeCap(rows) {
  if (PREMIUM_UNLOCKED) return { visible: rows, locked: 0 };
  if (hoyMarketTab === 'valor') {
    if (rows.length <= FREE_VALOR_CAP) return { visible: rows, locked: 0 };
    return { visible: rows.slice(0, FREE_VALOR_CAP), locked: rows.length - FREE_VALOR_CAP };
  }
  if (hoyMarketTab === 'top') {
    if (rows.length <= FREE_TOP_CAP) return { visible: rows, locked: 0 };
    return { visible: rows.slice(0, FREE_TOP_CAP), locked: rows.length - FREE_TOP_CAP };
  }
  return { visible: rows, locked: 0 };
}

function renderMatchBoard(el, rows, emptyHtml, { locked = 0, lockKind = 'top' } = {}) {
  if (!el) return;
  if (!rows.length && !locked) {
    el.className = 'sheet';
    el.innerHTML = emptyHtml;
    return;
  }
  el.className = 'sheet';
  const lock = locked > 0 ? premiumLockHtml(locked, lockKind) : '';
  el.innerHTML = matchBoardHeaderHtml() + rows.map(matchBoardRowHtml).join('') + lock;
  bindAnalyze(el);
  el.querySelectorAll('[data-goto-premium]').forEach((btn) => {
    btn.addEventListener('click', () => setActiveNav('#premium'));
  });
}

function renderHoyBoard() {
  renderStatusFilters(scopedMatches());
  renderPartidosList();
  renderTop3().catch(() => {});
  updateFilterChip();
}

function syncMarketTabs() {
  document.querySelectorAll('.market-tabs__btn').forEach((btn) => {
    const on = btn.dataset.market === hoyMarketTab;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

function applyFilters() {
  renderLeagueCategories(cachedMatches);
  renderHoyBoard();
  // Semanal has its own selects; do not touch it here.
  // Refetch Partidos when the server league param should change (0↔1 liga).
  const want = desiredMatchesFetchLeagueId();
  if (want !== matchesFetchLeagueId && !matchesReloadQueued) {
    matchesReloadQueued = true;
    load()
      .catch((err) => showBanner(err.message, 'error'))
      .finally(() => {
        matchesReloadQueued = false;
      });
  }
}

function outcomeBadge(outcome) {
  if (outcome === 'hit') return '<span class="outcome outcome--hit">Acertó</span>';
  if (outcome === 'miss') return '<span class="outcome outcome--miss">Falló</span>';
  return `<span class="outcome">${escapeHtml(outcome || '—')}</span>`;
}

function perfStatCell(label, value) {
  return `<div class="perf-stat">
    <span class="perf-stat__v">${escapeHtml(String(value))}</span>
    <span class="perf-stat__k">${escapeHtml(label)}</span>
  </div>`;
}

/** Signed percentage for a yield/ROI value (null when not measurable). */
function roiLabel(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const pct = Number(value) * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

function roiTone(value) {
  if (value == null || !Number.isFinite(Number(value))) return 'muted';
  if (Number(value) > 0.02) return 'roi--up';
  if (Number(value) < -0.02) return 'roi--down';
  return 'roi--flat';
}

/** Profitability block: meaningful with real bookmaker prices. */
function perfRoiHtml(perf) {
  const roi = perf?.roi || null;
  const staked = Number(roi?.staked || 0);
  if (!PREMIUM_UNLOCKED && perf?.premiumRequired && !premiumState.premium && !staked) {
    return `<div class="perf-roi perf-roi--empty perf-roi--premium">
      <span class="perf-roi__label">Rentabilidad</span>
      <span class="perf-roi__premium">${premiumUpsellHtml('perf-roi')}</span>
    </div>`;
  }
  if (!staked) {
    const modelPriced = Number(roi?.modelPriced || 0);
    return `<div class="perf-roi perf-roi--empty">
      <span class="perf-roi__label">Rentabilidad</span>
      <span class="perf-roi__value muted">Sin cuota de casa${
        modelPriced ? ` · ${modelPriced} tips con precio del modelo` : ''
      }</span>
    </div>`;
  }
  const value = roiLabel(roi.yield);
  const profit = Number(roi.profit || 0);
  return `<div class="perf-roi ${roiTone(roi.yield)}">
    <span class="perf-roi__label">Rentabilidad</span>
    <span class="perf-roi__value">${escapeHtml(value ?? '—')}</span>
    <span class="perf-roi__meta">${staked} apostadas · ${roi.hits}✔ ${roi.misses}✘ · ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} uds${
      roi.avgOdds ? ` · cuota media ${Number(roi.avgOdds).toFixed(2)}` : ''
    }</span>
  </div>`;
}

function recentTipRowHtml(r) {
  const tip = escapeHtml(labelBet(r.suggestedBet, r.homeName, r.awayName));
  const score =
    r.homeGoals != null && r.awayGoals != null
      ? `${Number(r.homeGoals)}-${Number(r.awayGoals)}`
      : '—';
  const odds = tipOddsDisplay(r.tipOdds);
  return `
    <article class="perf-row" role="listitem">
      <span class="perf-row__crests" aria-hidden="true">
        ${crestHtml(r.homeName, r.homeLogo, 'sm')}
        ${crestHtml(r.awayName, r.awayLogo, 'sm')}
      </span>
      <span class="perf-row__main">
        <span class="perf-row__match">${escapeHtml(r.homeName || '')} – ${escapeHtml(r.awayName || '')}</span>
        <span class="perf-row__tip tip-accent">${tip}</span>
        <span class="perf-row__meta muted">${escapeHtml(r.leagueName || '—')} · ${escapeHtml(
          formatMatchDate(r.matchDate)
        )} · ${score}${odds ? ` · ${odds}` : ''}</span>
      </span>
      <span class="perf-row__out">${outcomeBadge(r.outcome)}</span>
    </article>`;
}

function renderPerformance(perf) {
  const summary = document.getElementById('perf-summary');
  const recent = document.getElementById('perf-recent');
  if (!summary || !recent) return;

  const hits = Number(perf?.hits || 0);
  const misses = Number(perf?.misses || 0);
  const pending = Number(perf?.pending || 0);
  const decided = Number(perf?.decided || hits + misses);
  const rate =
    perf?.hitRate != null && decided > 0
      ? `${(Number(perf.hitRate) * 100).toFixed(0)}%`
      : decided > 0
        ? `${Math.round((hits / decided) * 100)}%`
        : '—';

  summary.innerHTML = `
    <div class="perf-board">
      <div class="perf-board__hero">
        <div class="perf-board__rate">${rate}</div>
        <div class="perf-board__label">Aciertos</div>
      </div>
      <div class="perf-board__stats">
        ${perfStatCell('Aciertos', hits)}
        ${perfStatCell('Fallos', misses)}
        ${perfStatCell('Pendientes', pending)}
      </div>
    </div>`;

  const rows = (perf?.recent || []).slice(0, 8);
  if (!rows.length) {
    const gated =
      !PREMIUM_UNLOCKED && perf?.premiumRequired && !premiumState.premium;
    recent.innerHTML = gated
      ? premiumUpsellHtml('perf-recent')
      : `<div class="perf-empty muted">Sin tips cerrados aún</div>`;
    if (gated) bindPremiumActivate(recent);
    return;
  }
  recent.innerHTML = `<div class="perf-list" role="list">${rows
    .map(recentTipRowHtml)
    .join('')}</div>`;
}

async function fetchTipPerformance(q) {
  if (tipPerfCache && tipPerfCacheKey === q) return tipPerfCache;
  const perf = await api(`/api/v1/tips/performance?${q}`);
  tipPerfCacheKey = q;
  tipPerfCache = perf;
  return perf;
}

async function loadPerformance() {
  const summary = document.getElementById('perf-summary');
  const recent = document.getElementById('perf-recent');
  if (summary && !summary.querySelector('.perf-hero')) setLoading('perf-summary', 1);
  try {
    const perf = await fetchTipPerformance(TIPS_PERF_GLOBAL_Q);
    renderPerformance(perf);
    setHitBadge(perf);
    cachedTipSummary = perf;
  } catch (err) {
    if (summary) {
      summary.innerHTML = `<div class="empty-board conf-lo">${escapeHtml(err.message)}</div>`;
    }
    if (recent) recent.innerHTML = '';
  }
}

function openPanel(html) {
  const browseBody = document.getElementById('browsePanelBody');
  if (isDesktopSplit() && browseBody) {
    browseBody.innerHTML = html;
    document.body.classList.add('has-browse-selection');
    return;
  }
  const panel = document.getElementById('panel');
  const backdrop = document.getElementById('panel-backdrop');
  document.getElementById('panel-body').innerHTML = html;
  panel.classList.add('is-open');
  panel.setAttribute('aria-hidden', 'false');
  backdrop.classList.add('is-open');
  backdrop.setAttribute('aria-hidden', 'false');
  document.body.classList.add('panel-open');
  document.getElementById('close-panel')?.focus({ preventScroll: true });
}

function closePanel() {
  const panel = document.getElementById('panel');
  const backdrop = document.getElementById('panel-backdrop');
  panel.classList.remove('is-open');
  panel.setAttribute('aria-hidden', 'true');
  backdrop.classList.remove('is-open');
  backdrop.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('panel-open');
  panelLiveCtx = null;
}

function normalizeViewHash(hash) {
  const raw = (hash || '').replace('#', '');
  const id = raw.split('/')[0];
  if (id === 'mejores' || id === 'hoy' || id === '') return 'partidos';
  if (id === 'aciertos') return 'stats';
  if (id === 'cuotas') return 'bandas';
  if (
    id === 'partidos' ||
    id === 'top3' ||
    id === 'stats' ||
    id === 'ligas' ||
    id === 'bandas' ||
    id === 'premium' ||
    id === 'ajustes'
  ) {
    return id;
  }
  return 'partidos';
}

function setActiveNav(hash, { pushHash = true } = {}) {
  const incoming = String(hash || '');
  const view = normalizeViewHash(incoming);
  const views = document.getElementById('views');
  if (views) views.dataset.view = view;
  const track = document.getElementById('views-track');
  if (track) track.style.transform = '';
  if (views) views.classList.remove('views--dragging');
  document.querySelectorAll('.v2-nav__link, .dock__link').forEach((link) => {
    const target = normalizeViewHash(link.getAttribute('href') || '');
    const href = link.getAttribute('href') || '';
    const active =
      target === view ||
      (view === 'bandas' && (href === '#cuotas' || href === '#bandas')) ||
      (view === 'premium' && false);
    link.classList.toggle('is-active', active);
  });
  if (pushHash) {
    let want = view === 'bandas' ? '#cuotas' : `#${view}`;
    const deep = incoming.replace(/^#/, '');
    if (view === 'ligas' && /^ligas\/\d+/.test(deep)) want = `#${deep}`;
    if (location.hash !== want) history.replaceState(null, '', want);
  }
  window.scrollTo(0, 0);
  if (view !== 'ligas') document.body.classList.remove('has-ligas-selection');
  if (view === 'stats' || view === 'aciertos') loadPerformance().catch(() => {});
  if (view === 'top3') renderTop3().catch(() => {});
  if (view === 'ligas') renderLigasView();
  if (view === 'bandas') loadCuotasTarget().catch(() => {});
  if (view === 'ajustes') syncPrivacyToggles();
}

function pricingLabel(pricing) {
  if (pricing === 'book') return 'Cuotas de casa';
  if (pricing === 'mixed') return 'Mixto (casa + estimado)';
  if (pricing === 'model') return 'Estimado (sin cuota de casa)';
  return pricing ? String(pricing) : '—';
}

function oddsSourceLabel(src) {
  const map = {
    book: 'casa',
    model: 'estimado',
    derived_1x2: 'deriv. 1X2',
    stale: 'cuota antigua',
  };
  return map[src] || (src ? String(src) : '—');
}

function formatValorEdge(leg) {
  if (leg?.oddsSource !== 'book' || leg.valueEdge == null) return '—';
  const edge = Number(leg.valueEdge);
  if (!Number.isFinite(edge) || Math.abs(edge) < 0.005) return '—';
  const pct = edge * 100;
  const rounded = Math.abs(pct) >= 0.5 ? pct.toFixed(0) : pct.toFixed(1);
  return `${edge >= 0 ? '+' : ''}${rounded}%`;
}

function comboPricingBadge(pricing) {
  if (pricing === 'book') return '';
  if (pricing === 'mixed') {
    return `<span class="combo-card__badge" title="Mezcla cuotas de casa y estimadas">${escapeHtml(
      pricingLabel('mixed')
    )}</span>`;
  }
  if (pricing === 'model') {
    return `<span class="combo-card__badge" title="Sin cuotas de casa: 1/P del modelo">${escapeHtml(
      pricingLabel('model')
    )}</span>`;
  }
  return '';
}

function comboCardHtml(combo) {
  const legs = combo.legs || [];
  const nLegs = combo.nLegs != null ? Number(combo.nLegs) : legs.length;
  const total =
    combo.combinedOdds != null ? Number(combo.combinedOdds).toFixed(2) : '—';
  const jointPct =
    combo.jointProb != null && Number.isFinite(Number(combo.jointProb))
      ? Number(combo.jointProb) * 100
      : null;
  const jointLabel =
    jointPct != null ? `${jointPct.toFixed(1).replace('.', ',')}%` : null;
  const legsHtml = legs
    .map((leg) => {
      const home = leg.homeTeam?.name || '';
      const away = leg.awayTeam?.name || '';
      const legP =
        leg.prob != null && Number.isFinite(Number(leg.prob))
          ? `${(Number(leg.prob) * 100).toFixed(0)}%`
          : leg.confidenceScore != null && !Number.isNaN(Number(leg.confidenceScore))
            ? `${Math.round(Number(leg.confidenceScore))}%`
            : null;
      return `
      <button type="button" class="combo-leg" data-analyze="${Number(leg.matchId)}">
        <span class="combo-leg__crests" aria-hidden="true">
          ${crestHtml(home, leg.homeTeam?.logo, 'sm')}
          ${crestHtml(away, leg.awayTeam?.logo, 'sm')}
        </span>
        <span class="combo-leg__body">
          <span class="combo-leg__match">${escapeHtml(home)} · ${escapeHtml(away)}</span>
          <span class="combo-leg__meta muted">${escapeHtml(leg.league || '')} · ${escapeHtml(
            formatMatchDate(leg.matchDate)
          )}</span>
          <span class="combo-leg__tip tip-accent">${escapeHtml(
            labelBet(leg.suggestedBet, home, away)
          )}</span>
        </span>
        <span class="combo-leg__odds">${legP ? `${legP} · ` : ''}${
          leg.tipOdds != null ? Number(leg.tipOdds).toFixed(2) : '—'
        }</span>
      </button>`;
    })
    .join('');

  return `
    <article class="combo-card" role="listitem">
      <div class="combo-card__head">
        <div>
          <div class="combo-card__label">${nLegs} partidos · cuota ${total}</div>
          ${comboPricingBadge(combo.pricing || combo.oddsSource)}
        </div>
        <div class="combo-card__side">
          ${
            jointLabel
              ? `<span class="combo-card__prob ${confClass(jointPct)}">${jointLabel}</span><span class="combo-card__prob-lab">Probabilidad de acierto</span>`
              : ''
          }
        </div>
      </div>
      <div class="combo-card__legs">${legsHtml}</div>
    </article>`;
}

function filterCombosByScope(combos) {
  return (combos || []).filter((c) => {
    const legs = c.legs || [];
    if (!legs.length) return false;
    return legs.every((leg) => filterByScope([leg]).length === 1);
  });
}

function syncCuotasTargetUi() {
  /* Semanal cuota 10: no slider */
}

function weeklyLegRowHtml(leg, idx) {
  const home = leg.homeTeam?.name || '';
  const away = leg.awayTeam?.name || '';
  const pModel =
    leg.prob != null ? `${(Number(leg.prob) * 100).toFixed(0)}%` : '—';
  const pCasa =
    leg.oddsSource === 'book'
      ? leg.impliedProb != null
        ? `${(Number(leg.impliedProb) * 100).toFixed(0)}%`
        : leg.tipOdds
          ? `${((1 / Number(leg.tipOdds)) * 100).toFixed(0)}%`
          : '—'
      : '—';
  const valor = formatValorEdge(leg);
  const src = escapeHtml(oddsSourceLabel(leg.oddsSource));
  const fam = escapeHtml(leg.marketFamily || '—');
  const homeLogo = leg.homeTeam?.logo || null;
  const awayLogo = leg.awayTeam?.logo || null;
  return `<tr class="weekly-table__row" data-analyze="${Number(leg.matchId)}" data-league="${Number(
    leg.leagueApiId || 0
  )}" data-family="${escapeHtml(leg.marketFamily || '')}">
    <td>${idx + 1}</td>
    <td>${escapeHtml(leg.league || '—')}</td>
    <td>
      <div class="weekly-table__teams">
        ${crestHtml(home, homeLogo, 'sm')}
        ${crestHtml(away, awayLogo, 'sm')}
        <button type="button" class="weekly-table__match" data-analyze="${Number(leg.matchId)}">
          ${escapeHtml(home)} – ${escapeHtml(away)}
        </button>
      </div>
      <div class="muted weekly-table__when">${escapeHtml(formatMatchDate(leg.matchDate))}</div>
    </td>
    <td class="tip-accent">${escapeHtml(labelBet(leg.suggestedBet, home, away))}
      <div class="muted weekly-table__when">${fam}</div>
    </td>
    <td>${leg.tipOdds != null ? Number(leg.tipOdds).toFixed(2) : '—'}</td>
    <td>${pCasa}</td>
    <td class="${confClass(Number(leg.prob) * 100)}">${pModel}</td>
    <td>${valor}</td>
    <td class="muted">${src}</td>
  </tr>`;
}

function renderWeeklySummary(primary, meta = {}, why = null) {
  const box = document.getElementById('cuotas-summary');
  const whyEl = document.getElementById('weekly-why');
  const badge = document.getElementById('weekly-filters-badge');
  if (badge) {
    badge.hidden = true;
    badge.textContent = '';
  }
  if (whyEl) {
    whyEl.hidden = true;
    whyEl.innerHTML = '';
  }
  if (!box) return;
  if (!primary) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const pAdj =
    primary.jointProbAdj != null
      ? `${(Number(primary.jointProbAdj) * 100).toFixed(1).replace('.', ',')}%`
      : primary.jointProb != null
        ? `${(Number(primary.jointProb) * 100).toFixed(1).replace('.', ',')}%`
        : '—';
  const pricing = primary.pricing || meta.pricing;
  const pricingTxt = pricingLabel(pricing);
  const noBook =
    pricing === 'model' ||
    (primary.bookRatio != null && Number(primary.bookRatio) < 0.15);
  const metaBits = [
    primary.leagueCount != null ? `Ligas ${primary.leagueCount}` : null,
    pricingTxt ? pricingTxt : null,
    noBook ? 'Sin book' : null,
  ].filter(Boolean);
  box.hidden = false;
  box.innerHTML = `
    <div class="weekly-summary__hero">
      <div><span class="muted">Cuota 10</span><strong>${Number(
        primary.combinedOdds
      ).toFixed(2)}</strong></div>
      <div><span class="muted">Prob. combinada</span><strong class="${confClass(
        Number(primary.jointProbAdj ?? primary.jointProb) * 100
      )}">${pAdj}</strong></div>
      <div><span class="muted">Selecciones</span><strong>${primary.nLegs}</strong></div>
    </div>
    ${
      metaBits.length
        ? `<div class="weekly-summary__meta"><span>${metaBits
            .map((b) => escapeHtml(b))
            .join(' · ')}</span></div>`
        : ''
    }`;
}

let cachedWeeklyPayload = null;
let weeklyPickIndex = 0;
let weeklySeenIds = [];


const WEEKLY_LEAGUE_LABELS = {
  39: 'Premier League',
  140: 'LaLiga',
  135: 'Serie A',
  78: 'Bundesliga',
  61: 'Ligue 1',
};

const WEEKLY_FAMILY_LABELS = {
  result: 'resultado',
  goals: 'goles',
  corners: 'córners',
  cards: 'tarjetas',
  shots: 'tiros / SOT',
};

const WEEKLY_WINDOW_LABELS = {
  weekend: 'Fin de semana',
  this_week: 'Esta semana',
  next7: 'Próximos 7 días',
  next14: 'Próximos 14 días',
};


function weeklyAggressivePicks(data) {
  const list = [];
  const seen = new Set();
  const push = (c) => {
    if (!c) return;
    const id = c.id != null ? String(c.id) : null;
    if (id && seen.has(id)) return;
    if (id) seen.add(id);
    list.push(c);
  };
  push(data?.primary || null);
  for (const a of data?.alternatives || []) push(a);
  if (!list.length) {
    for (const c of data?.combos || []) push(c);
  }
  return list;
}

function markWeeklyPickSeen(pick) {
  if (!pick?.id) return;
  const id = String(pick.id);
  if (!weeklySeenIds.includes(id)) weeklySeenIds.push(id);
}

function syncWeeklyOtraButton(data) {
  const btn = document.getElementById('cuotas-calc-btn');
  if (!btn) return;
  const picks = weeklyAggressivePicks(data || cachedWeeklyPayload);
  const hasLocal = weeklyPickIndex + 1 < picks.length;
  const canExclude = weeklySeenIds.length > 0;
  const emptyAfter =
    data?.emptyReason === 'no_more_after_exclude' && !picks.length;
  btn.disabled = Boolean(emptyAfter);
  btn.title = emptyAfter
    ? 'No hay más combinaciones con estos filtros'
    : hasLocal || canExclude
      ? 'Otra combinación cuota 10'
      : 'Otra combinación';
}

function readWeeklyFilterParams() {
  const leagueRaw = document.getElementById('weekly-filter-league')?.value || '';
  const familyRaw = document.getElementById('weekly-filter-family')?.value || '';
  const windowRaw =
    document.getElementById('weekly-filter-window')?.value || 'next14';
  const leagueApiId = leagueRaw ? Number(leagueRaw) : null;
  const family = familyRaw || null;
  return {
    leagueApiId: Number.isFinite(leagueApiId) ? leagueApiId : null,
    family,
    window: windowRaw || 'next14',
  };
}

function weeklyFilterQuery() {
  const { leagueApiId, family, window: win } = readWeeklyFilterParams();
  let q = `window=${encodeURIComponent(win || 'next14')}`;
  if (leagueApiId != null) q += `&leagueApiId=${encodeURIComponent(String(leagueApiId))}`;
  if (family) q += `&family=${encodeURIComponent(family)}`;
  return q;
}

function weeklyEmptyMessage(data) {
  const { leagueApiId, family, window: win } =
    data?.meta?.activeFilters || readWeeklyFilterParams();
  const liga =
    leagueApiId != null
      ? WEEKLY_LEAGUE_LABELS[leagueApiId] || `liga ${leagueApiId}`
      : 'las cinco grandes';
  const fam = family ? WEEKLY_FAMILY_LABELS[family] || family : null;
  const jornada = win ? WEEKLY_WINDOW_LABELS[win] || win : null;
  if (data?.emptyReason === 'no_legs_filtered') {
    const scope = [jornada, liga, fam].filter(Boolean).join(' · ');
    return `No hay selecciones válidas (${scope}) con cuota ≥1,20. Sin inventar mercados.`;
  }
  if (data?.emptyReason === 'no_legs') {
    return 'No hay suficientes selecciones con cuota verificada o modelo etiquetado (≥1,20) en las cinco grandes. Sin inventar cuotas de casa.';
  }
  if (data?.emptyReason === 'no_more_after_exclude') {
    return 'No hay más combinadas distintas con estos filtros. Cambia jornada/liga/mercado o vuelve más tarde.';
  }
  return 'No se encontró una combinada cerca de cuota 10 con criterios de calidad. Prueba más tarde tras el enrich de odds.';
}

function conservativeBlockHtml(combo, meta = {}) {
  if (!combo) {
    return `<div class="weekly-profile">
      <div class="weekly-profile__head">
        <h3 class="weekly-profile__title">Conservadora · cuota 5</h3>
      </div>
      <p class="muted">Sin combinada conservadora con los filtros actuales.</p>
    </div>`;
  }
  const pAdj =
    combo.jointProbAdj != null
      ? `${(Number(combo.jointProbAdj) * 100).toFixed(1).replace('.', ',')}%`
      : '—';
  const warn =
    combo.belowTarget || meta.conservative?.belowTarget
      ? `<p class="weekly-profile__warn muted">${escapeHtml(
          meta.conservative?.belowReason ||
            'No alcanza P conjunta ajustada ≥75%; mejor estimación del modelo.'
        )}</p>`
      : '';
  return `<div class="weekly-profile">
    <div class="weekly-profile__head">
      <h3 class="weekly-profile__title">Conservadora · cuota 5</h3>
      <span class="muted">estimación del modelo · mín. 1,20 por selección</span>
    </div>
    <div class="weekly-profile__stats">
      <span>Cuota <strong>${Number(combo.combinedOdds).toFixed(2)}</strong></span>
      <span>Prob. combinada <strong class="${confClass(
        Number(combo.jointProbAdj) * 100
      )}">${pAdj}</strong></span>
      <span>Selecciones <strong>${combo.nLegs}</strong></span>
      <span>Origen cuotas <strong>${escapeHtml(pricingLabel(combo.pricing))}</strong></span>
    </div>
    ${warn}
    <div class="weekly-table-wrap" style="margin-top:0.65rem">
      <table class="weekly-table">
        <thead>
          <tr>
            <th>#</th><th>Liga</th><th>Partido</th><th>Mercado</th>
            <th>Cuota</th><th>P modelo</th><th>Fuente</th>
          </tr>
        </thead>
        <tbody>${(combo.legs || [])
          .map((leg, idx) => {
            const home = leg.homeTeam?.name || '';
            const away = leg.awayTeam?.name || '';
            const src = escapeHtml(oddsSourceLabel(leg.oddsSource));
            return `<tr class="weekly-table__row" data-analyze="${Number(leg.matchId)}">
              <td>${idx + 1}</td>
              <td>${escapeHtml(leg.league || '—')}</td>
              <td>
                <div class="weekly-table__teams">
                  ${crestHtml(home, leg.homeTeam?.logo, 'sm')}
                  ${crestHtml(away, leg.awayTeam?.logo, 'sm')}
                  <button type="button" class="weekly-table__match" data-analyze="${Number(
                    leg.matchId
                  )}">${escapeHtml(home)} – ${escapeHtml(away)}</button>
                </div>
              </td>
              <td class="tip-accent">${escapeHtml(labelBet(leg.suggestedBet, home, away))}</td>
              <td>${leg.tipOdds != null ? Number(leg.tipOdds).toFixed(2) : '—'}</td>
              <td>${leg.prob != null ? `${(Number(leg.prob) * 100).toFixed(0)}%` : '—'}</td>
              <td class="muted">${src}</td>
            </tr>`;
          })
          .join('')}</tbody>
      </table>
    </div>
  </div>`;
}

async function loadWeeklySourcesPanel() {
  const el = document.getElementById('weekly-sources');
  if (!el) return;
  el.hidden = true;
  el.innerHTML = '';
}

async function loadCrestAuditPanel() {
  const panel = document.getElementById('crest-audit-panel');
  const body = document.getElementById('crest-audit-body');
  if (!panel || !body) return;
  const params = new URLSearchParams(location.search);
  if (params.get('admin') !== '1') {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  try {
    const data = await api('/api/v1/crests/audit');
    const blocks = (data.reports || [])
      .map((rep) => {
        const counts = (rep.rows || []).reduce((acc, r) => {
          acc[r.status] = (acc[r.status] || 0) + 1;
          return acc;
        }, {});
        const issues = (rep.rows || []).filter(
          (r) => r.status === 'broken' || r.status === 'mismatch' || r.status === 'pending'
        );
        return `<div class="crest-audit__league"><strong>${escapeHtml(
          rep.name || String(rep.leagueApiId)
        )}</strong> · ${JSON.stringify(counts)}
          ${
            issues.length
              ? `<ul>${issues
                  .slice(0, 8)
                  .map(
                    (r) =>
                      `<li>${escapeHtml(r.team)} · ${escapeHtml(r.status)}${
                        r.problem ? ` · ${escapeHtml(r.problem)}` : ''
                      }</li>`
                  )
                  .join('')}</ul>`
              : '<p class="muted">Sin incidencias en mapa estático.</p>'
          }
        </div>`;
      })
      .join('');
    body.innerHTML = blocks || 'Sin datos';
  } catch (err) {
    body.innerHTML = `<span class="conf-lo">${escapeHtml(err.message)}</span>`;
  }
}

function renderWeeklyCombos(data) {
  const el = document.getElementById('cuotas-results');
  const hint = document.getElementById('cuotas-hint');
  const wrap = document.getElementById('cuotas-results-wrap');
  if (!el) return;
  cachedWeeklyPayload = data;
  const picks = weeklyAggressivePicks(data);
  if (weeklyPickIndex >= picks.length) weeklyPickIndex = 0;
  const primary = picks[weeklyPickIndex] || null;
  markWeeklyPickSeen(primary);
  const conservative = data?.conservative || null;
  const meta = data?.meta || {};
  renderWeeklySummary(primary, meta, data?.whyPreferred || null);
  syncWeeklyOtraButton(data);

  if (hint) {
    if (primary) {
      const inRange =
        Number(primary.combinedOdds) >= 9 && Number(primary.combinedOdds) <= 11;
      const divMeta =
        primary.familyCount != null
          ? ` · ${primary.familyCount} familias`
          : '';
      hint.innerHTML = `<span class="odds-board__top-title">${
        inRange ? 'Semanal · cuota 10' : 'Mejor alternativa · cuota 10'
      }</span><span class="odds-board__top-meta">${
        inRange
          ? `objetivo 9–11${divMeta}`
          : `no hay cuota 10 limpia · mejor cuota ${Number(primary.combinedOdds).toFixed(2)}${divMeta}`
      }</span>`;
    } else {
      const why =
        data?.emptyReason === 'no_legs_filtered'
          ? 'Sin selecciones con los filtros activos'
          : data?.emptyReason === 'no_legs'
            ? 'Faltan selecciones válidas en top 5 (revisa enrich AF / predicciones)'
            : data?.emptyReason === 'no_more_after_exclude'
              ? 'Sin más alternativas distintas'
              : 'Sin combinada en rango 9–11';
      hint.innerHTML = `<span class="odds-board__top-title">Sin combinada cuota 10</span><span class="odds-board__top-meta">${escapeHtml(
        why
      )}</span>`;
    }
  }
  if (wrap) wrap.hidden = false;

  const safeHtml = conservativeBlockHtml(conservative, meta);

  if (!primary) {
    el.className = 'weekly-results';
    el.innerHTML = `<div class="empty-board">${escapeHtml(
      weeklyEmptyMessage(data)
    )}</div>${safeHtml}`;
    bindWeeklyAnalyze(el);
    return;
  }

  const af = data?.meta?.activeFilters || {};
  const filterBadge = [
    af.window ? WEEKLY_WINDOW_LABELS[af.window] || af.window : null,
    af.leagueApiId != null
      ? WEEKLY_LEAGUE_LABELS[af.leagueApiId] || `AF ${af.leagueApiId}`
      : null,
    af.family ? WEEKLY_FAMILY_LABELS[af.family] || af.family : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const table = `
    <div class="weekly-block">
      <h3 class="weekly-block__title">Semanal · cuota 10${
        filterBadge
          ? ` <span class="muted">· ${escapeHtml(filterBadge)}</span>`
          : ''
      }</h3>
      <div class="weekly-table-wrap">
        <table class="weekly-table">
          <thead>
            <tr>
              <th>#</th><th>Liga</th><th>Partido</th><th>Mercado</th>
              <th>Cuota</th><th>P casa</th><th>P modelo</th><th>Valor</th><th>Fuente</th>
            </tr>
          </thead>
          <tbody>${(primary.legs || []).map(weeklyLegRowHtml).join('')}</tbody>
        </table>
      </div>
    </div>`;

  const noBookBanner =
    (primary.pricing || meta.pricing) === 'model'
      ? `<p class="muted weekly-summary__note">Sin cuotas de casa (falta enrich AF).</p>`
      : '';

  el.className = 'weekly-results';
  el.innerHTML = noBookBanner + table + safeHtml;
  bindWeeklyAnalyze(el);
}

function bindWeeklyAnalyze(el) {
  if (!el) return;
  bindAnalyze(el);
  el.querySelectorAll('[data-analyze]').forEach((node) => {
    if (node.dataset.weeklyBound) return;
    node.dataset.weeklyBound = '1';
    node.addEventListener('click', (e) => {
      e.preventDefault();
      const id = Number(node.getAttribute('data-analyze'));
      if (id) openPrediction(id).catch(() => {});
    });
  });
}

async function loadCuotasTarget({ excludeIds = null, resetCycle = true } = {}) {
  const el = document.getElementById('cuotas-results');
  const hint = document.getElementById('cuotas-hint');
  const gen = ++cuotasLoadGen;
  const { leagueApiId, family, window: win } = readWeeklyFilterParams();
  if (resetCycle && !excludeIds?.length) {
    weeklyPickIndex = 0;
    weeklySeenIds = [];
  }
  loadWeeklySourcesPanel().catch(() => {});
  loadCrestAuditPanel().catch(() => {});
  const scopeHint = [
    WEEKLY_WINDOW_LABELS[win] || win || '14 días',
    leagueApiId != null ? WEEKLY_LEAGUE_LABELS[leagueApiId] || String(leagueApiId) : 'top 5',
    family ? WEEKLY_FAMILY_LABELS[family] || family : null,
  ]
    .filter(Boolean)
    .join(' · ');
  if (el) {
    el.className = 'combo-board';
    el.innerHTML = `<div class="muted odds-board__loading">Calculando Semanal cuota 10 + Conservadora cuota 5 (${escapeHtml(
      scopeHint
    )})…</div>`;
  }
  if (hint) {
    hint.innerHTML = `<span class="odds-board__top-title">Calculando…</span><span class="odds-board__top-meta">${escapeHtml(
      scopeHint
    )}</span>`;
  }
  const summary = document.getElementById('cuotas-summary');
  if (summary) {
    summary.hidden = true;
    summary.innerHTML = '';
  }
  const whyEl = document.getElementById('weekly-why');
  if (whyEl) {
    whyEl.hidden = true;
    whyEl.innerHTML = '';
  }
  const badge = document.getElementById('weekly-filters-badge');
  if (badge) {
    badge.hidden = true;
    badge.textContent = '';
  }
  try {
    let q = weeklyFilterQuery();
    if (excludeIds?.length) {
      q += `&excludeIds=${encodeURIComponent(excludeIds.join(','))}`;
    }
    const data = await api(`/api/v1/combos/weekly?${q}`);
    if (gen !== cuotasLoadGen) return;
    weeklyPickIndex = 0;
    cachedOddsBandBets = data.combos || [];
    renderWeeklyCombos(data);
  } catch (err) {
    if (gen !== cuotasLoadGen) return;
    cachedOddsBandBets = [];
    if (hint) {
      hint.innerHTML =
        '<span class="odds-board__top-title">Error</span><span class="odds-board__top-meta">no se pudo calcular</span>';
    }
    if (el) {
      el.innerHTML = `<div class="empty-board conf-lo">${escapeHtml(err.message)}</div>`;
    }
  }
}

function cycleWeeklyAggressive() {
  const data = cachedWeeklyPayload;
  if (!data) {
    loadCuotasTarget().catch(() => {});
    return;
  }
  const picks = weeklyAggressivePicks(data);
  if (weeklyPickIndex + 1 < picks.length) {
    weeklyPickIndex += 1;
    markWeeklyPickSeen(picks[weeklyPickIndex]);
    renderWeeklyCombos(data);
    return;
  }
  if (!weeklySeenIds.length && picks[0]?.id) {
    markWeeklyPickSeen(picks[0]);
  }
  loadCuotasTarget({ excludeIds: [...weeklySeenIds], resetCycle: false }).catch(
    () => {}
  );
}

function bindCuotasTargetControls() {
  const btn = document.getElementById('cuotas-calc-btn');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.textContent = 'Otra';
    btn.addEventListener('click', () => {
      cycleWeeklyAggressive();
    });
  }
  ['weekly-filter-window', 'weekly-filter-league', 'weekly-filter-family'].forEach(
    (id) => {
      const el = document.getElementById(id);
      if (el && !el.dataset.bound) {
        el.dataset.bound = '1';
        el.addEventListener('change', () => {
          weeklyPickIndex = 0;
          weeklySeenIds = [];
          loadCuotasTarget({ resetCycle: true }).catch(() => {});
        });
      }
    }
  );
}

async function openPrediction(id) {
  openPanel(`<div class="muted">Cargando análisis…</div>`);
  try {
    const bundle = await api(`/api/v1/matches/${id}/prediction`);
    const p = bundle.prediction || {};
    const m = bundle.match || {};
    const homeName = m.homeTeam?.name || '';
    const awayName = m.awayTeam?.name || '';
    panelLiveCtx = { id: Number(id), homeName, awayName };
    const home = escapeHtml(homeName);
    const away = escapeHtml(awayName);
    const leagueLine = [m.leagueCountry, m.leagueName].filter(Boolean).join(' · ');
    const tipOdds =
      bundle.tipOdds != null
        ? Number(bundle.tipOdds).toFixed(2)
        : tipOddsFromBundle(p.suggested_bet, bundle.odds);
    const tipProb = tipProbPct({
      suggestedBet: p.suggested_bet,
      homeWinProb: p.home_win_prob,
      drawProb: p.draw_prob,
      awayWinProb: p.away_win_prob,
      over25Prob: p.over25_prob,
      under25Prob: p.under25_prob,
      bttsYesProb: p.btts_yes_prob,
      bttsNoProb: p.btts_no_prob,
      confidenceScore: p.confidence_score,
    });
    const goalsAvg =
      bundle.xg?.home != null && bundle.xg?.away != null
        ? Number((Number(bundle.xg.home) + Number(bundle.xg.away)).toFixed(2))
        : null;
    const cornersAvg =
      bundle.expected?.corners?.match ?? sumRecentAvg(bundle.recentAvgs, 'corners');
    const cardsAvg =
      bundle.expected?.cards?.match ?? sumRecentAvg(bundle.recentAvgs, 'yellows');
    const shotsAvg =
      bundle.expected?.shotsOnTarget?.match ??
      bundle.expected?.shots?.match ??
      sumRecentAvg(bundle.recentAvgs, 'shotsOnTarget');
    const la = bundle.leagueAvgs || {};
    const keyCards = [
      pctStatCard('Más de 2,5 goles', p.over25_prob),
      pctStatCard('Más de 1,5 goles', p.over15_prob),
      pctStatCard('Ambos marcan', p.btts_yes_prob),
      avgStatCard('Promedio goles', goalsAvg, 5, la.goals),
      cardsAvg != null ? avgStatCard('Promedio tarjetas', cardsAvg, 6, la.cards) : '',
      cornersAvg != null ? avgStatCard('Promedio córners', cornersAvg, 12, la.corners) : '',
      shotsAvg != null
        ? avgStatCard('Promedio tiros a puerta', shotsAvg, 12, la.shotsOnTarget)
        : '',
      p.sot_over85_prob != null
        ? pctStatCard('Más de 8,5 tiros a puerta', p.sot_over85_prob)
        : '',
    ]
      .filter(Boolean)
      .join('');

    const tabBtns = [
      ['general', 'General'],
      ['goles', 'Goles'],
      ['tiros', 'Tiros a puerta'],
      ['corners', 'Córners'],
      ['tarjetas', 'Tarjetas'],
    ].map(
        ([id, lab], i) =>
          `<button type="button" class="mp-tabs__btn${i === 0 ? ' is-active' : ''}" role="tab" data-mp-tab="${id}" aria-selected="${i === 0 ? 'true' : 'false'}">${lab}</button>`
      )
      .join('');

    const goalsPanel = `
      ${marketSection(
        'Goles del partido',
        [
          probBar('Más de 1,5 goles', p.over15_prob),
          probBar('Menos de 1,5 goles', p.under15_prob),
          probBar('Más de 2,5 goles', p.over25_prob),
          probBar('Menos de 2,5 goles', p.under25_prob),
          probBar('Más de 3,5 goles', p.over35_prob),
          probBar('Menos de 3,5 goles', p.under35_prob),
          probBar('Ambos marcan — Sí', p.btts_yes_prob),
          probBar('Ambos marcan — No', p.btts_no_prob),
        ].join('')
      )}
      ${marketSection(
        `Goles de ${homeName || 'local'}`,
        [
          probBar('Marca (0,5+)', p.home_over05_prob),
          probBar('No marca', p.home_under05_prob),
          probBar('Más de 1,5', p.home_over15_prob),
          probBar('Menos de 1,5', p.home_under15_prob),
          probBar('Más de 2,5', p.home_over25_prob),
          probBar('Menos de 2,5', p.home_under25_prob),
        ].join('')
      )}
      ${marketSection(
        `Goles de ${awayName || 'visitante'}`,
        [
          probBar('Marca (0,5+)', p.away_over05_prob),
          probBar('No marca', p.away_under05_prob),
          probBar('Más de 1,5', p.away_over15_prob),
          probBar('Menos de 1,5', p.away_under15_prob),
          probBar('Más de 2,5', p.away_over25_prob),
          probBar('Menos de 2,5', p.away_under25_prob),
        ].join('')
      )}
      ${scoreGridHtml(bundle.scoreGrid, bundle.topScores, homeName, awayName)}`;

    const shotsPanel = extrasPanel({
          label: 'Tiros a puerta esperados',
          unit: 'Tiros a puerta',
          homeName,
          awayName,
          homeLogo: m.homeTeam?.logo,
          awayLogo: m.awayTeam?.logo,
          expected: bundle.expected?.shotsOnTarget || bundle.expected?.shots,
          ladders: bundle.ladders?.shotsOnTarget || bundle.ladders?.shots,
          recentAvgs: {
            home: bundle.recentAvgs?.home?.shotsOnTarget,
            away: bundle.recentAvgs?.away?.shotsOnTarget,
          },
          leagueAverage: bundle.leagueAvgs?.shotsOnTarget,
          leagueProxy: Boolean(bundle.leagueAvgs?.proxy?.shotsOnTarget),
          matchLines: [7.5, 8.5, 9.5],
          teamLines: [2.5, 3.5, 4.5, 5.5],
          fallbackHtml: `<div class="market-block"><div class="market-block__title">Tiros a puerta</div><div class="muted">Sin datos suficientes para calcular probabilidades de este mercado.</div></div>`,
        });

    const cornersPanel = extrasPanel({
          label: 'Córners esperados',
          unit: 'Córners',
          homeName,
          awayName,
          homeLogo: m.homeTeam?.logo,
          awayLogo: m.awayTeam?.logo,
          expected: bundle.expected?.corners,
          ladders: bundle.ladders?.corners,
          recentAvgs: {
            home: bundle.recentAvgs?.home?.corners,
            away: bundle.recentAvgs?.away?.corners,
          },
          leagueAverage: bundle.leagueAvgs?.corners,
          leagueProxy: Boolean(bundle.leagueAvgs?.proxy?.corners),
          matchLines: [8.5, 9.5, 10.5],
          teamLines: [3.5, 4.5, 5.5, 6.5],
          fallbackHtml: `<div class="market-block"><div class="market-block__title">Córners</div><div class="muted">Sin datos suficientes para calcular probabilidades de este mercado.</div></div>`,
        });

    const cardsPanel = extrasPanel({
          label: 'Tarjetas (amarillas) esperadas',
          unit: 'Tarjetas',
          homeName,
          awayName,
          homeLogo: m.homeTeam?.logo,
          awayLogo: m.awayTeam?.logo,
          expected: bundle.expected?.cards,
          ladders: bundle.ladders?.cards,
          recentAvgs: {
            home: bundle.recentAvgs?.home?.yellows,
            away: bundle.recentAvgs?.away?.yellows,
          },
          leagueAverage: bundle.leagueAvgs?.cards,
          leagueProxy: Boolean(bundle.leagueAvgs?.proxy?.cards),
          matchLines: [3.5, 4.5],
          teamLines: [0.5, 1.5, 2.5],
          fallbackHtml: `<div class="market-block"><div class="market-block__title">Tarjetas</div><div class="muted">Sin datos suficientes para calcular probabilidades de este mercado.</div></div>`,
        });

    const liveEvents =
      m.status === 'live' || m.status === 'finished'
        ? matchEventsHtml(m.events || bundle.match?.events, { split: true })
        : '';
    openPanel(`
      <div class="mp" id="mp-root">
        <div class="mp-league">${escapeHtml(leagueLine || 'Liga')}</div>
        <div class="mp-meta muted">${escapeHtml(formatMatchDate(m.matchDate))}</div>
        <div class="mp-teams${liveEvents ? ' mp-teams--events' : ''}">
          ${mpTeamCol(homeName, m.homeTeam?.logo, 'home', bundle.form?.home)}
          <div class="mp-vs">
            <span class="mp-vs__label">VS</span>
            <span class="mp-status">${escapeHtml(matchStatusPill(m))}</span>
          </div>
          ${mpTeamCol(awayName, m.awayTeam?.logo, 'away', bundle.form?.away)}
          ${liveEvents}
        </div>
        <div class="panel-suggest">
          <div class="panel-suggest__bet">${escapeHtml(
            labelBet(p.suggested_bet, homeName, awayName)
          )}</div>
          <div class="panel-suggest__meta">
            <span class="${confClass(tipProb)}">${
              tipProb != null
                ? `<span data-count-to="${Math.round(Number(tipProb))}" data-count-suffix="%">0%</span> modelo`
                : '— modelo'
            }</span>
            ${tipOdds ? `<span class="tip-odds">${tipOdds} €</span>` : ''}
            ${
              p.value_edge != null && p.value_edge >= MIN_VALUE_EDGE
                ? `<span class="value">+${(p.value_edge * 100).toFixed(0)}%</span>`
                : ''
            }
          </div>
          <div class="muted panel-suggest__sec">2ª · ${escapeHtml(
            labelBet(p.secondary_bet, homeName, awayName)
          )}</div>
        </div>
        ${livePanelHtml(bundle.live, homeName, awayName)}
        ${
          bundle.dataQuality === 'low'
            ? `<div class="muted mp-note">Muestra baja (${bundle.sampleSize ?? 0})</div>`
            : ''
        }
        <nav class="mp-tabs" role="tablist">${tabBtns}</nav>
        <div class="mp-panels">
          <div class="mp-panel is-active" data-mp-panel="general" role="tabpanel">
            ${winProbBar(p)}
            ${
              keyCards
                ? `<h3 class="mp-section-title">Probabilidades clave</h3><div class="mp-grid">${keyCards}</div>`
                : ''
            }
            ${h2hHtml(bundle.h2h, homeName)}
            ${leagueTableHtml(bundle.leagueTable, homeName, awayName)}
          </div>
          <div class="mp-panel" data-mp-panel="goles" role="tabpanel" hidden>${goalsPanel}</div>
          <div class="mp-panel" data-mp-panel="tiros" role="tabpanel" hidden>${shotsPanel}</div>
          <div class="mp-panel" data-mp-panel="corners" role="tabpanel" hidden>${cornersPanel}</div>
          <div class="mp-panel" data-mp-panel="tarjetas" role="tabpanel" hidden>${cardsPanel}</div>
        </div>
      </div>
    `);
    const root = document.getElementById('mp-root');
    wireMatchPanelTabs(root);
    runPanelEntrance(root);
  } catch (err) {
    openPanel(`<div class="conf-lo">${escapeHtml(err.message)}. Cierra e inténtalo de nuevo.</div>`);
  }
}

async function searchTeam(q) {
  const box = document.getElementById('search-results');
  if (!q || q.trim().length < 2) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  box.classList.remove('hidden');
  box.className = 'search-panel';
  box.innerHTML = `<div class="search-panel__status">Buscando…</div>`;
  try {
    const data = await api(`/api/v1/teams/search?q=${encodeURIComponent(q.trim())}`);
    const teams = data.teams || [];
    if (!teams.length) {
      box.innerHTML = `<div class="search-panel__status">Sin resultados.</div>`;
      return;
    }
    box.innerHTML = teams
      .map(
        (t) => `
    <button class="search-hit" type="button" data-team="${Number(t.id)}" role="option">
      ${crestHtml(t.name, t.logo_url || t.logo, 'sm')}
      <span>
        <span class="search-hit__name">${escapeHtml(t.name)}</span>
        <span class="search-hit__meta">${escapeHtml(t.league_name)}</span>
      </span>
      <span class="search-hit__go">Abrir</span>
    </button>`
      )
      .join('');
    box.querySelectorAll('[data-team]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const insight = await api(`/api/v1/teams/${btn.dataset.team}`);
          document.getElementById('team-search').value = '';
          box.classList.add('hidden');
          box.innerHTML = '';
          if (insight.nextMatch?.id) openPrediction(insight.nextMatch.id);
          else openPanel(`<div class="muted">Sin próximo partido para ${escapeHtml(insight.team?.name)}.</div>`);
        } catch (err) {
          openPanel(`<div class="conf-lo">${escapeHtml(err.message)}</div>`);
        }
      });
    });
  } catch (err) {
    box.innerHTML = `<div class="search-panel__status conf-lo">${escapeHtml(err.message)}</div>`;
  }
}

async function loadTipSummaryFast() {
  try {
    const summary = await api(`/api/v1/tips/summary?${TIPS_PERF_GLOBAL_Q}`);
    cachedTipSummary = summary;
    setHitBadge(summary);
    return summary;
  } catch (_) {
    if (!cachedTipSummary) setHitBadge(null);
    return null;
  }
}

function waitForFirstPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

async function waitForBootAssets() {
  const img = document.querySelector('.boot-splash__icon');
  if (img && !img.complete) {
    await Promise.race([
      new Promise((res) => {
        img.addEventListener('load', res, { once: true });
        img.addEventListener('error', res, { once: true });
      }),
      new Promise((res) => setTimeout(res, 2500)),
    ]);
  }
  await waitForFirstPaint();
}

async function load() {
  updateTitles();
  syncWindowChips();
  syncLiveChip();
  syncMarketTabs();
  bestBetsLimit = 40;
  tipPerfCache = null;
  tipPerfCacheKey = '';
  const label = document.getElementById('today-label');
  if (label) {
    label.textContent = new Date().toLocaleDateString('es-ES', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  }

  setLoading('matches', 4);
  const countEl = document.getElementById('match-count');
  if (countEl) countEl.textContent = 'Cargando…';

  const q = matchListQuery();
  const errors = [];

  // Kick off live refresh without blocking the match list (Worker runs it in waitUntil).
  const activeDate = resolveSelectedDate();
  const refreshP =
    activeDate === todayYmd() || activeDate === yesterdayYmd()
      ? api('/api/v1/matches/refresh-live', { method: 'POST' }).catch(() => null)
      : null;

  // Critical path for first screen: partidos + chips + header badge
  const statusP = api('/api/v1/status').then(
    (status) => {
      setModeBadge(status);
      setSyncLabel(status);
      return status;
    },
    () => {
      errors.push('Estado');
      return null;
    }
  );
  const summaryP = loadTipSummaryFast().catch(() => null);

  try {
    const today = await api(`/api/v1/matches/today?${q}`);
    cachedMatches = today.matches || [];
    cachedBets = cachedMatches.filter((m) => m.suggestedBet);
    cachedMode = today.mode || 'live';
    matchesFetchLeagueId = desiredMatchesFetchLeagueId();
    renderLeagueCategories(cachedMatches);
    renderHoyBoard();
  } catch (err) {
    cachedMatches = [];
    cachedBets = [];
    renderLeagueCategories([]);
    const el = document.getElementById('matches');
    if (el) {
      el.innerHTML = `<div class="empty-board conf-lo">No se pudieron cargar partidos. ${escapeHtml(
        err.message || ''
      )}</div>`;
    }
    errors.push('Partidos');
  }

  await Promise.allSettled(refreshP ? [statusP, summaryP, refreshP] : [statusP, summaryP]);

  if (errors.length >= 2) {
    showBanner('No hay conexión con la API. Revisa la red e inténtalo de nuevo.', 'error');
  } else if (errors.length) {
    showBanner(`Algunas secciones fallaron (${errors.join(', ')}). El resto sigue disponible.`, 'error');
  } else {
    showBanner('');
  }

  const view = document.getElementById('views')?.dataset.view;
  if (view === 'bandas') loadCuotasTarget().catch(() => {});
  else if (view === 'stats' || view === 'aciertos') loadPerformance().catch(() => {});
  else if (view === 'top3') renderTop3().catch(() => {});
  else if (view === 'ligas') renderLigasView();

  // Ensure list/chips are painted before callers (boot) dismiss splash
  await waitForFirstPaint();
}

function matchKey(m) {
  return JSON.stringify({
    id: m.id,
    status: m.status,
    homeGoals: m.homeGoals,
    awayGoals: m.awayGoals,
    elapsedMinute: m.elapsedMinute,
    events: m.events || [],
    live: m.live || null,
    suggestedBet: m.suggestedBet || null,
    secondaryBet: m.secondaryBet || null,
    confidenceScore: m.confidenceScore ?? null,
    valueEdge: m.valueEdge ?? null,
    valueMarket: m.valueMarket || null,
    tipOdds: m.tipOdds ?? null,
    oddsBand: m.oddsBand || null,
    oddsSource: m.oddsSource || null,
  });
}

/** True when the payload is different from the cached one (avoids re-rendering). */
function sameMatches(cached, fresh) {
  if (!Array.isArray(cached) || cached.length !== fresh.length) return false;
  for (let i = 0; i < fresh.length; i += 1) {
    if (matchKey(cached[i]) !== matchKey(fresh[i])) return false;
  }
  return true;
}

function isLoadingMatchesPlaceholder() {
  const el = document.getElementById('matches');
  return el && /skeleton|Cargando/i.test(el.innerHTML || '');
}

/** Refresh the live block of the open analysis panel without reloading it. */
async function refreshOpenPanelLive() {
  if (!panelLiveCtx) return;
  const root = document.getElementById('mp-root');
  if (!root) return;
  const { id, homeName, awayName } = panelLiveCtx;
  try {
    const data = await api(`/api/v1/matches/${id}/live`, { method: 'POST' });
    const html = livePanelHtml(data.live, homeName, awayName);
    const current = root.querySelector('.mp-live');
    if (html) {
      if (current) current.outerHTML = html;
      else root.querySelector('.panel-suggest')?.insertAdjacentHTML('afterend', html);
    } else if (current) {
      current.remove();
    }
    // Also update cached objects so the panel sees fresh data on next open/re-render
    const freshMatch = data.match;
    if (freshMatch) {
      for (const m of cachedMatches) {
        if (Number(m.id) === Number(id)) {
          m.status = freshMatch.status;
          m.homeGoals = freshMatch.homeGoals;
          m.awayGoals = freshMatch.awayGoals;
          m.elapsedMinute = freshMatch.elapsedMinute;
          m.events = freshMatch.events || [];
          m.live = data.live || null;
          break;
        }
      }
      for (const b of cachedBets) {
        if (Number(b.matchId || b.id) === Number(id)) {
          b.status = freshMatch.status;
          b.homeGoals = freshMatch.homeGoals;
          b.awayGoals = freshMatch.awayGoals;
          b.elapsedMinute = freshMatch.elapsedMinute;
          b.events = freshMatch.events || [];
          b.live = data.live || null;
          break;
        }
      }
    }
  } catch (_) {
    /* ignore */
  }
}

async function refreshLiveAndReload() {
  if (document.visibilityState !== 'visible') return;
  try {
    await api('/api/v1/matches/refresh-live', { method: 'POST' });
  } catch (_) {
    /* ignore refresh errors */
  }
  try {
    const q = matchListQuery();
    const today = await api(`/api/v1/matches/today?${q}`);
    const fresh = today.matches || [];
    const changed = !sameMatches(cachedMatches, fresh);
    cachedMatches = fresh;
    cachedBets = cachedMatches.filter((m) => m.suggestedBet);
    cachedMode = today.mode || cachedMode;
    if (changed) {
      renderLeagueCategories(cachedMatches);
      renderHoyBoard();
    }
  } catch (_) {
    /* ignore */
  }
  await refreshOpenPanelLive();
}

/** Poll faster while there is football on, slower when there is not. */
function livePollInterval() {
  const hasLive = cachedMatches.some((m) => m.status === 'live');
  return hasLive ? 50_000 : 120_000;
}

function startLivePoll() {
  if (livePollTimer) clearTimeout(livePollTimer);
  const tick = async () => {
    await refreshLiveAndReload();
    livePollTimer = setTimeout(tick, livePollInterval());
  };
  livePollTimer = setTimeout(tick, livePollInterval());
}

document.getElementById('close-panel').addEventListener('click', closePanel);
document.getElementById('panel-backdrop').addEventListener('click', closePanel);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('panel').classList.contains('is-open')) {
    closePanel();
  }
});

document
  .querySelectorAll(
    'a.v2-nav__link, a.dock__link, a.brand, a.premium-chip, a.aciertos-sub__link, a.aciertos-bar__link, a.ajustes-bar__link, a.site-footer__link'
  )
  .forEach((link) => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href') || '';
      if (!href.startsWith('#')) return;
      e.preventDefault();
      setActiveNav(href);
    });
  });

document.getElementById('prevDayBtn')?.addEventListener('click', () => shiftDay(-1));
document.getElementById('nextDayBtn')?.addEventListener('click', () => shiftDay(1));
document.getElementById('yesterdayBtn')?.addEventListener('click', () => setDayPreset('yesterday'));
document.getElementById('todayBtn')?.addEventListener('click', () => setDayPreset('today'));
document.getElementById('tomorrowBtn')?.addEventListener('click', () => setDayPreset('tomorrow'));

function openDatePicker() {
  const input = document.getElementById('match-date');
  if (!input) return;
  try {
    if (typeof input.showPicker === 'function') input.showPicker();
    else input.click();
  } catch (_) {
    input.focus();
  }
}
document.getElementById('dateCenter')?.addEventListener('click', openDatePicker);
document.getElementById('dateCenter')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    openDatePicker();
  }
});

const DAY_SWIPE_EXCLUDED_SELECTOR =
  'button, a, input, select, textarea, [role="button"], [role="link"], [contenteditable="true"], [data-day-swipe-ignore], .browse-chips';

function daySwipeIntent({ dx, dy, dt, width }) {
  if (![dx, dy, dt, width].every(Number.isFinite) || dt < 0) return false;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const threshold = Math.max(70, width * 0.18);
  return absX >= threshold && absX >= absY * 2 && dt <= 550;
}

function isDaySwipeExcludedTarget(target, zone) {
  const element = target?.nodeType === 1 ? target : target?.parentElement;
  if (!element?.closest) return true;
  if (element.closest(DAY_SWIPE_EXCLUDED_SELECTOR)) return true;

  for (let node = element; node && node !== zone; node = node.parentElement) {
    if (node.scrollWidth <= node.clientWidth + 1) continue;
    const overflowX = window.getComputedStyle(node).overflowX;
    if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay') return true;
  }
  return false;
}

/* Horizontal swipe on list → change day; this gesture belongs to the list. */
(function initDaySwipe() {
  const zone = document.getElementById('listScreen') || document.getElementById('matches');
  if (!zone) return;
  let x0 = 0;
  let y0 = 0;
  let startedAt = 0;
  let locked = null;
  let tracking = false;
  zone.addEventListener(
    'touchstart',
    (e) => {
      tracking = e.touches?.length === 1 && !isDaySwipeExcludedTarget(e.target, zone);
      if (!tracking) return;
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      startedAt = performance.now();
      locked = null;
    },
    { passive: true }
  );
  zone.addEventListener(
    'touchmove',
    (e) => {
      if (!tracking || e.touches?.length !== 1 || locked === 'v') return;
      const dx = e.touches[0].clientX - x0;
      const dy = e.touches[0].clientY - y0;
      if (locked == null && (Math.abs(dx) >= 18 || Math.abs(dy) >= 18)) {
        if (Math.abs(dx) >= Math.abs(dy) * 1.5) locked = 'h';
        else if (Math.abs(dy) >= Math.abs(dx) * 1.5) locked = 'v';
      }
    },
    { passive: true }
  );
  zone.addEventListener(
    'touchend',
    (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches?.[0];
      if (!t) return;
      const dx = t.clientX - x0;
      const dy = t.clientY - y0;
      const dt = performance.now() - startedAt;
      if (locked === 'v' || !daySwipeIntent({ dx, dy, dt, width: zone.clientWidth })) return;
      shiftDay(dx < 0 ? 1 : -1);
    },
    { passive: true }
  );
  zone.addEventListener(
    'touchcancel',
    () => {
      tracking = false;
      locked = null;
    },
    { passive: true }
  );
})();

const viewsEl = document.getElementById('views');
const viewsTrack = document.getElementById('views-track');
let swipeStartX = 0;
let swipeStartY = 0;
let swipeDx = 0;
let swipeActive = false;
let swipeLocked = null; // 'h' | 'v'

function currentViewIndex() {
  const v = viewsEl?.dataset.view;
  if (v === 'top3') return 1;
  if (v === 'stats') return 2;
  if (v === 'ligas') return 3;
  if (v === 'bandas' || v === 'ajustes' || v === 'premium') return -1;
  return 0;
}

/** Primary swipe nav between main sections. */
const VIEW_HASHES = ['#partidos', '#top3', '#stats', '#ligas'];

function onSwipeStart(x, y, target) {
  if (document.body.classList.contains('panel-open')) return;
  // A gesture that starts in the match list is reserved for date navigation.
  if (document.getElementById('listScreen')?.contains(target)) return;
  swipeStartX = x;
  swipeStartY = y;
  swipeDx = 0;
  swipeActive = true;
  swipeLocked = null;
  viewsEl?.classList.add('views--dragging');
}

function onSwipeMove(x, y) {
  if (!swipeActive || !viewsTrack || !viewsEl) return;
  const dx = x - swipeStartX;
  const dy = y - swipeStartY;
  if (!swipeLocked) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    swipeLocked = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    if (swipeLocked === 'v') {
      swipeActive = false;
      viewsEl.classList.remove('views--dragging');
      viewsTrack.style.transform = '';
      return;
    }
  }
  if (swipeLocked !== 'h') return;
  swipeDx = dx;
  const idx = currentViewIndex();
  if (idx < 0) return; // bandas: no drag preview
  const base = idx * -100;
  const width = viewsEl.clientWidth || 1;
  const pct = (dx / width) * 100;
  let next = base + pct;
  if (idx === 0 && dx > 0) next = pct * 0.25;
  if (idx === VIEW_HASHES.length - 1 && dx < 0) next = -(VIEW_HASHES.length - 1) * 100 + pct * 0.25;
  viewsTrack.style.transform = `translateX(${next}%)`;
}

function onSwipeEnd() {
  if (!viewsEl || !viewsTrack) return;
  viewsEl.classList.remove('views--dragging');
  viewsTrack.style.transform = '';
  if (!swipeActive || swipeLocked !== 'h') {
    swipeActive = false;
    return;
  }
  swipeActive = false;
  let idx = currentViewIndex();
  if (idx < 0) return;
  const width = viewsEl.clientWidth || 1;
  if (Math.abs(swipeDx) > width * 0.22) {
    if (swipeDx < 0) idx = Math.min(VIEW_HASHES.length - 1, idx + 1);
    else idx = Math.max(0, idx - 1);
  }
  setActiveNav(VIEW_HASHES[idx]);
}

viewsEl?.addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length !== 1) return;
    onSwipeStart(e.touches[0].clientX, e.touches[0].clientY, e.target);
  },
  { passive: true }
);
viewsEl?.addEventListener(
  'touchmove',
  (e) => {
    if (!swipeActive || e.touches.length !== 1) return;
    onSwipeMove(e.touches[0].clientX, e.touches[0].clientY);
  },
  { passive: true }
);
viewsEl?.addEventListener('touchend', onSwipeEnd);
viewsEl?.addEventListener('touchcancel', onSwipeEnd);

window.addEventListener('hashchange', () => {
  const h = location.hash || '#hoy';
  setActiveNav(h, { pushHash: false });
});

window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    setActiveNav(location.hash || '#partidos', { pushHash: false });
  }
});

loadPrivacyPrefs();
restoreFiltersIfAllowed();
syncWindowChips();
syncLiveChip();
syncScopeChips();
syncPrivacyToggles();

bindCuotasTargetControls();
setActiveNav(location.hash || '#partidos', { pushHash: false });

document.getElementById('hit-badge')?.addEventListener('click', () => setActiveNav('#stats'));

document.querySelectorAll('.market-tabs__btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    hoyMarketTab = btn.dataset.market || 'top';
    syncMarketTabs();
    renderHoyBoard();
  });
});

(function initAdminFold() {
  const fold = document.getElementById('admin-fold');
  if (!fold) return;
  const params = new URLSearchParams(location.search);
  if (params.get('admin') === '1') {
    fold.classList.remove('hidden');
    fold.open = true;
    fold.style.opacity = '1';
  }
})();

document.getElementById('match-date')?.addEventListener('change', (e) => {
  const v = e.target.value;
  if (!v) return;
  windowMode = 'date';
  selectedDate = v;
  selectedMatchId = null;
  syncWindowChips();
  persistFiltersIfAllowed();
  load().catch((err) => showBanner(err.message, 'error'));
});

document.getElementById('chip-live')?.addEventListener('click', () => {
  liveOnly = !liveOnly;
  syncLiveChip();
  persistFiltersIfAllowed();
  applyFilters();
});

document.querySelectorAll('.browse-chip[data-scope], .tb-chip[data-scope]').forEach((chip) => {
  chip.addEventListener('click', () => {
    scopeFilter = chip.dataset.scope || 'all';
    syncScopeChips();
    leagueFilterIds.clear();
    if (scopeFilter === 'clubs' || scopeFilter === 'intl') leaguesPanelOpen = true;
    persistFiltersIfAllowed();
    applyFilters();
  });
});

document.getElementById('league-toggle')?.addEventListener('click', () => {
  leaguesPanelOpen = !leaguesPanelOpen;
  renderLeagueCategories(cachedMatches);
});

document.getElementById('ligas-back')?.addEventListener('click', () => {
  hideLigasTable({ pushHash: true });
  ensureLigasCatalog()
    .then((catalog) => renderLigasFolders(catalog))
    .catch((err) => showBanner(err.message || 'Error', 'error'));
});

document.getElementById('ligas-see-matches')?.addEventListener('click', () => {
  const d1Id = Number(ligasActiveD1Id);
  if (!Number.isFinite(d1Id) || d1Id <= 0) {
    showBanner('Liga no disponible', 'info');
    return;
  }
  leagueFilterIds.clear();
  leagueFilterIds.add(d1Id);
  scopeFilter = 'all';
  syncScopeChips();
  persistFiltersIfAllowed();
  setActiveNav('#partidos');
  applyFilters();
});

let searchTimer;
document.getElementById('team-search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value;
  searchTimer = setTimeout(() => {
    persistSearchIfAllowed(q);
    searchTeam(q);
  }, 250);
});

document.getElementById('pref-analytics')?.addEventListener('change', (e) => {
  privacyPrefs.analytics = !!e.target.checked;
  savePrivacyPrefs();
  syncPrivacyToggles();
  trackEvent('privacy_analytics', { enabled: privacyPrefs.analytics });
});

document.getElementById('pref-save-search')?.addEventListener('change', (e) => {
  privacyPrefs.saveSearch = !!e.target.checked;
  savePrivacyPrefs();
  syncPrivacyToggles();
  if (!privacyPrefs.saveSearch) {
    persistSearchIfAllowed('');
  } else {
    persistSearchIfAllowed(document.getElementById('team-search')?.value || '');
  }
});

document.getElementById('pref-remember-filters')?.addEventListener('change', (e) => {
  privacyPrefs.rememberFilters = !!e.target.checked;
  savePrivacyPrefs();
  syncPrivacyToggles();
  if (privacyPrefs.rememberFilters) persistFiltersIfAllowed();
  else persistFiltersIfAllowed();
});

const refreshBtnLabel = () => {
  const btn = document.getElementById('btn-sync');
  if (!btn) return;
  btn.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4.5 12a7.5 7.5 0 0 1 12.7-5.4M19.5 12a7.5 7.5 0 0 1-12.7 5.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M17 3.5v4h-4M7 20.5v-4h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span>Calendario</span>`;
};

function askSyncSecret() {
  return prompt('Clave de actualización (SYNC_SECRET):', 'change-me-houdini');
}

document.getElementById('btn-sync').addEventListener('click', async () => {
  const secret = askSyncSecret();
  if (secret == null) return;
  const btn = document.getElementById('btn-sync');
  const enrichBtn = document.getElementById('btn-enrich');
  btn.disabled = true;
  if (enrichBtn) enrichBtn.disabled = true;
  btn.innerHTML = '<span>Actualizando…</span>';
  showBanner('Actualizando calendario… puede tardar unos segundos.', 'info');
  try {
    const res = await api('/api/v1/sync/manual', {
      method: 'POST',
      headers: { 'x-sync-secret': secret },
    });
    const intl = res.internationalsSynced != null ? ` · Selecciones ${res.internationalsSynced}` : '';
    const seg = res.segundaSynced != null ? ` · Segunda ${res.segundaSynced}` : '';
    showBanner(
      `Calendario al día: ${res.savedFixtures ?? '—'} partidos · historial ${res.savedHistory ?? 0} · tips ${res.predicted ?? 0}${intl}${seg}`,
      'ok'
    );
    await load();
  } catch (err) {
    showBanner(`No se pudo actualizar: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    if (enrichBtn) enrichBtn.disabled = false;
    refreshBtnLabel();
  }
});

document.getElementById('btn-enrich')?.addEventListener('click', async () => {
  const secret = askSyncSecret();
  if (secret == null) return;
  const btn = document.getElementById('btn-enrich');
  const syncBtn = document.getElementById('btn-sync');
  const btBtn = document.getElementById('btn-backtest');
  btn.disabled = true;
  if (syncBtn) syncBtn.disabled = true;
  if (btBtn) btBtn.disabled = true;
  btn.innerHTML = '<span>Enrich…</span>';
  showBanner('Actualizando cuotas y stats (API-Football)…', 'info');
  try {
    const res = await api('/api/v1/sync/enrich', {
      method: 'POST',
      headers: { 'x-sync-secret': secret },
    });
    if (res.error && !res.ok) {
      showBanner(res.error, 'error');
    } else {
      showBanner(
        `Enrich: ${res.oddsSynced ?? 0} cuotas · ${res.statsSynced ?? 0} stats · tips ${res.tipsRefreshed ?? 0}${
          res.afError ? ` · aviso: ${res.afError}` : ''
        }`,
        res.ok === false ? 'error' : 'ok'
      );
    }
    const status = await api('/api/v1/status');
    setSyncLabel(status);
    await load();
  } catch (err) {
    showBanner(`No se pudo enriquecer: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    if (syncBtn) syncBtn.disabled = false;
    if (btBtn) btBtn.disabled = false;
    btn.innerHTML = '<span>Cuotas + stats</span>';
  }
});

document.getElementById('btn-backtest')?.addEventListener('click', async () => {
  const secret = askSyncSecret();
  if (secret == null) return;
  const btn = document.getElementById('btn-backtest');
  const syncBtn = document.getElementById('btn-sync');
  const enrichBtn = document.getElementById('btn-enrich');
  btn.disabled = true;
  if (syncBtn) syncBtn.disabled = true;
  if (enrichBtn) enrichBtn.disabled = true;
  btn.innerHTML = '<span>Backtest…</span>';
  showBanner('Ejecutando backtest holdout (puede tardar)…', 'info');
  try {
    const res = await api('/api/v1/admin/backtest', {
      method: 'POST',
      headers: { 'x-sync-secret': secret, 'content-type': 'application/json' },
      body: JSON.stringify({ days: 60, limit: 400 }),
    });
    const a = res.results?.shrinkage?.holdout?.['1x2'];
    const k = res.results?.ratings?.holdout?.['1x2'];
    const aB = a?.brier != null ? a.brier.toFixed(4) : '—';
    const kB = k?.brier != null ? k.brier.toFixed(4) : '—';
    showBanner(
      `Backtest holdout 1X2 Brier: shrinkage ${aB} · Kalman ${kB}. ${res.reason || res.recommendation || ''}`,
      res.recommendation === 'enable_ratings' ? 'ok' : 'info'
    );
    const el = document.getElementById('admin-status');
    if (el && res.results) {
      const lines = [
        `Backtest: ${res.recommendation || '—'}`,
        res.reason || '',
        `shrinkage 1X2 Brier ${aB} (n=${a?.n ?? 0})`,
        `Kalman 1X2 Brier ${kB} (n=${k?.n ?? 0})`,
      ].filter(Boolean);
      el.innerHTML = lines.map((l) => `<div>${escapeHtml(l)}</div>`).join('');
    }
  } catch (err) {
    showBanner(`Backtest falló: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    if (syncBtn) syncBtn.disabled = false;
    if (enrichBtn) enrichBtn.disabled = false;
    btn.innerHTML = '<span>Backtest</span>';
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshLiveAndReload();
});

/** Offline support: service worker for the shell + cached data fallback. */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const secure = location.protocol === 'https:' || location.hostname === 'localhost';
  if (!secure) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  });
}

function updateConnectionBanner() {
  if (navigator.onLine) {
    const el = document.getElementById('global-banner');
    if (el && el.classList.contains('banner-info') && /conexión/i.test(el.textContent || '')) {
      showBanner('');
    }
    return;
  }
  showBanner('Sin conexión: se muestran los últimos datos guardados.', 'info');
}

window.addEventListener('offline', updateConnectionBanner);
window.addEventListener('online', () => {
  updateConnectionBanner();
  refreshLiveAndReload();
});

registerServiceWorker();
updateConnectionBanner();

restoreSearchIfAllowed();

const dateInputInit = document.getElementById('match-date');
if (dateInputInit) {
  if (windowMode === 'date') dateInputInit.value = selectedDate;
  else if (windowMode === 'manana') dateInputInit.value = tomorrowYmd();
  else dateInputInit.value = todayYmd();
}

function dismissBootSplash() {
  const splash = document.getElementById('boot-splash');
  document.body.classList.remove('boot-pending');
  document.documentElement.setAttribute('aria-busy', 'false');
  if (!splash) return;
  splash.classList.add('is-done');
  const finish = () => {
    splash.hidden = true;
    splash.setAttribute('aria-hidden', 'true');
  };
  splash.addEventListener('transitionend', finish, { once: true });
  window.setTimeout(finish, 450);
}

startLivePoll();
trackEvent('session_start');

(async function bootApp() {
  const splashLabel = document.querySelector('.boot-splash__label');
  if (splashLabel) splashLabel.textContent = 'Cargando partidos y datos…';
  try {
    await waitForBootAssets();
    await handlePremiumReturn();
    await loadPremiumState();
    syncPremiumView();
    await load();
    if (splashLabel) splashLabel.textContent = 'Listo';
    await waitForFirstPaint();
    dismissBootSplash();
  } catch (err) {
    showBanner(err.message || 'Error al cargar', 'error');
    const el = document.getElementById('matches');
    if (el) {
      el.innerHTML = `<div class="empty-board conf-lo">No se pudo iniciar la página. Recarga e inténtalo de nuevo.</div>`;
    }
    dismissBootSplash();
  }
})();
