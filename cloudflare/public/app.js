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
/** Scope inside #ligas view: clubs | intl | all */
let ligasViewScope = 'clubs';
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
/** '1' | '2' | '3' | '4' | '5' — history selection; combos only for 2–5 */
let oddsBandFilter = '2';
let oddsHistoryFilter = 'all'; // all | miss | hit
let cachedOddsBandBets = [];
let cachedOddsBandPerf = null;
let cachedOddsRecent = [];
let cachedOddsCombos = [];
/** @type {{ hits: number, misses: number, decided: number, hitRate: number|null, pending: number, windowLabel?: string|null }|null} */
let cachedOddsGlobal = null;
/** Shared tip summary/perf cache for badge + Bandas counters */
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
  OVER_15: 'Más de 1,5 goles',
  UNDER_15: 'Menos de 1,5 goles',
  OVER_25: 'Más de 2,5 goles',
  UNDER_25: 'Menos de 2,5 goles',
  OVER_35: 'Más de 3,5 goles',
  UNDER_35: 'Menos de 3,5 goles',
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
  goles: 'Goles',
  corners: 'Córners',
  cards: 'Amarillas',
  shots: 'Tiros',
  shots_on_target: 'Tiros a puerta',
  otros: 'Otros',
};

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
  paris: 85,
  'paris saint germain': 85,
  psg: 85,
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
  leipzig: 173,
  stuttgart: 172,
  hoffenheim: 167,
  como: 895,
  sunderland: 746,
  bournemouth: 35,
  'crystal palace': 52,
  'aston villa': 66,
};

function clubCrestUrl(name) {
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
    .replace(/[^a-z0-9.\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!key) return null;
  const id = CLUB_CREST_IDS[key];
  if (id != null) return `https://media.api-sports.io/football/teams/${id}.png`;
  const stripped = key
    .replace(/^(fc|cf|ac|as|ssc|rc|rcd|gnk|nk|sk|fk|rsc|sl)\s+/, '')
    .replace(/\s+(fc|cf|ac|afc|sc|sv|jk)$/, '')
    .trim();
  if (stripped && CLUB_CREST_IDS[stripped] != null) {
    return `https://media.api-sports.io/football/teams/${CLUB_CREST_IDS[stripped]}.png`;
  }
  return null;
}

function resolveCrestUrl(logo, name) {
  return clubCrestUrl(name) || (logo ? String(logo) : null) || flagUrlForTeam(name);
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

function toneFromPct(p01) {
  const p = Number(p01);
  if (!Number.isFinite(p)) return 'muted';
  const pctVal = p <= 1 ? p * 100 : p;
  if (pctVal >= 60) return 'hi';
  if (pctVal >= 40) return 'mid';
  return 'lo';
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

function ladderTableHtml(homeName, awayName, ladderHome, ladderAway, ladderMatch) {
  const hMap = new Map((ladderHome || []).map((r) => [Number(r.line), r.over]));
  const aMap = new Map((ladderAway || []).map((r) => [Number(r.line), r.over]));
  const mMap = new Map((ladderMatch || []).map((r) => [Number(r.line), r.over]));
  const lines = [...new Set([
    ...[...hMap.keys()],
    ...[...aMap.keys()],
    ...[...mMap.keys()],
  ])].sort((a, b) => a - b);
  if (!lines.length) return '';
  const cell = (over) => {
    if (over == null) return '<td><span class="ladder-badge ladder-badge--muted">—</span></td>';
    const pctVal = Math.round(Number(over) * 100);
    return `<td><span class="ladder-badge ladder-badge--${toneFromPct(over)}">${pctVal}%</span></td>`;
  };
  const rows = lines
    .map((line) => {
      const label = `Más de ${String(line).replace('.', ',')}`;
      return `<tr>
        <th scope="row">${escapeHtml(label)}</th>
        ${cell(hMap.get(line))}
        ${cell(aMap.get(line))}
        ${cell(mMap.get(line))}
      </tr>`;
    })
    .join('');
  return `
    <div class="ladder-table-wrap">
      <table class="ladder-table">
        <thead>
          <tr>
            <th scope="col">Métrica</th>
            <th scope="col">${escapeHtml(homeName || 'Local')}</th>
            <th scope="col">${escapeHtml(awayName || 'Visitante')}</th>
            <th scope="col">Partido</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function marketLadderPanel({
  label,
  homeName,
  awayName,
  homeLogo,
  awayLogo,
  expected,
  ladders,
  fallbackHtml,
}) {
  if (!expected && !ladders) return fallbackHtml || '';
  return `
    ${expectedCardHtml({
      title: label,
      homeName,
      awayName,
      homeLogo,
      awayLogo,
      homeExp: expected?.home,
      awayExp: expected?.away,
      matchExp: expected?.match,
    })}
    ${ladderTableHtml(
      homeName,
      awayName,
      ladders?.home,
      ladders?.away,
      ladders?.match
    )}
  `;
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

function marketAveragesHtml({ unit, homeName, awayName, recentAvgs, leagueAverage }) {
  const home = recentAvgs?.home;
  const away = recentAvgs?.away;
  const leaguePerTeam =
    leagueAverage != null && Number.isFinite(Number(leagueAverage))
      ? Number(leagueAverage) / 2
      : null;
  const format = (value) => {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return Number(value).toFixed(1).replace('.', ',');
  };
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
          <span class="market-averages__label">Media liga / equipo</span>
          <strong class="market-averages__value">${format(leaguePerTeam)}</strong>
        </div>
      </div>
      <p class="market-averages__caption">${escapeHtml(unit)} por partido</p>
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
  fallbackHtml,
}) {
  const matchRows = ladderProbRows(ladders?.match, matchLines);
  const homeRows = ladderProbRows(ladders?.home, teamLines);
  const awayRows = ladderProbRows(ladders?.away, teamLines);
  const hasRows = Boolean(matchRows || homeRows || awayRows);
  const degradedNote = ladders?.degraded
    ? `<div class="market-estimate-note" role="status">Estimación con pocas muestras · ${Number(ladders.samples?.home) || 0} local / ${Number(ladders.samples?.away) || 0} visitante</div>`
    : '';
  const averages = marketAveragesHtml({
    unit,
    homeName,
    awayName,
    recentAvgs,
    leagueAverage,
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

function renderLigasView() {
  const listEl = document.getElementById('ligas-list');
  if (!listEl) return;

  document.querySelectorAll('.ligas-tabs__btn').forEach((btn) => {
    const on = btn.dataset.ligasScope === ligasViewScope;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });

  const leagues = collectLeagues(cachedMatches, ligasViewScope);
  pruneLeagueSelection(leagues);
  const nSel = selectedLeagueCount();
  const groups = groupLeaguesByCountry(leagues);

  if (!leagues.length) {
    listEl.innerHTML = `<p class="league-cats__empty">No hay ligas con partidos el ${escapeHtml(
      formatDateCenter(resolveSelectedDate())
    )}.</p>`;
    return;
  }

  const totalMatches = leagues.reduce((n, l) => n + l.count, 0);
  listEl.innerHTML = [
    `<div class="ligas-list__summary muted">${groups.length} país${
      groups.length === 1 ? '' : 'es'
    } · ${leagues.length} competicion${leagues.length === 1 ? '' : 'es'} · ${totalMatches} partidos · ${
      nSel ? `${nSel} seleccionada${nSel === 1 ? '' : 's'}` : 'ningún filtro'
    }</div>`,
    ...groups.map((g) => {
      const ids = g.leagues.map((l) => Number(l.id)).filter((id) => Number.isFinite(id));
      const selN = ids.filter((id) => leagueFilterIds.has(id)).length;
      const allOn = ids.length > 0 && selN === ids.length;
      const someOn = selN > 0 && !allOn;
      const countryKey = encodeURIComponent(g.country || '_');
      return `<section class="ligas-country${allOn ? ' is-all-active' : someOn ? ' is-partial' : ''}" data-country-group="${countryKey}">
        <button type="button" class="ligas-country__head" data-country-toggle="${countryKey}" aria-pressed="${allOn ? 'true' : 'false'}" title="Seleccionar o quitar todas las ligas de ${escapeHtml(g.label)}">
          <span class="ligas-country__check" aria-hidden="true"></span>
          <span class="ligas-country__flag" aria-hidden="true">${g.flag}</span>
          <span class="ligas-country__body">
            <span class="ligas-country__name">${escapeHtml(g.label)}</span>
            <span class="ligas-country__meta">${g.leagues.length} liga${
        g.leagues.length === 1 ? '' : 's'
      } · ${g.matchCount} partido${g.matchCount === 1 ? '' : 's'}</span>
          </span>
        </button>
        <div class="ligas-country__leagues" role="group" aria-label="${escapeHtml(g.label)}">
          ${g.leagues
            .map((l) => {
              const id = Number(l.id);
              const active = leagueFilterIds.has(id);
              return `<button type="button" class="league-cat league-cat--nested${
                active ? ' active' : ''
              }" role="option" aria-selected="${active}" data-liga-id="${id}">
            <span class="league-cat__check" aria-hidden="true"></span>
            <span class="league-cat__body">
              <span class="league-cat__name">${escapeHtml(l.name)}</span>
              <span class="league-cat__meta">${l.count} partido${l.count === 1 ? '' : 's'}</span>
            </span>
          </button>`;
            })
            .join('')}
        </div>
      </section>`;
    }),
  ].join('');

  listEl.querySelectorAll('[data-country-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = decodeURIComponent(btn.getAttribute('data-country-toggle') || '');
      const group = groups.find((g) => (g.country || '_') === key);
      if (!group) return;
      const ids = group.leagues.map((l) => Number(l.id)).filter((id) => Number.isFinite(id));
      const allOn = ids.length > 0 && ids.every((id) => leagueFilterIds.has(id));
      if (allOn) ids.forEach((id) => leagueFilterIds.delete(id));
      else ids.forEach((id) => leagueFilterIds.add(id));
      persistFiltersIfAllowed();
      renderLigasView();
    });
  });

  listEl.querySelectorAll('[data-liga-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.getAttribute('data-liga-id'));
      if (!Number.isFinite(id)) return;
      if (leagueFilterIds.has(id)) leagueFilterIds.delete(id);
      else leagueFilterIds.add(id);
      persistFiltersIfAllowed();
      renderLigasView();
    });
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

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, opts);
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }
  if (!res.ok) {
    throw new Error((data && data.error) || res.statusText || 'Error de red');
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

function matchListQuery() {
  const d = resolveSelectedDate();
  selectedDate = d;
  return `date=${encodeURIComponent(d)}`;
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

function selectDiverseTips(sortedTips, limit = 3, maxPerLabel = 1) {
  const selected = [];
  const used = new Map();
  const max = Math.max(1, Number(maxPerLabel) || 1);
  for (const item of sortedTips || []) {
    const label = item?.m?.suggestedBet || item?.suggestedBet || '';
    if (!label || (used.get(label) || 0) >= max) continue;
    selected.push(item);
    used.set(label, (used.get(label) || 0) + 1);
    if (selected.length >= limit) return selected;
  }
  // If fewer unique labels exist, keep Top 3 useful rather than showing empty slots.
  if (selected.length < limit) {
    for (const item of sortedTips || []) {
      if (selected.includes(item)) continue;
      selected.push(item);
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

function renderTop3() {
  const el = document.getElementById('top3-list');
  if (!el) return;
  const rankedTips = scopedMatches()
    .filter((m) => m.suggestedBet)
    .map((m) => ({ m, meta: tipValueScore(m) }))
    .filter((x) => x.meta.kind !== 'none')
    .sort((a, b) => {
      if (a.meta.kind === 'value' && b.meta.kind !== 'value') return -1;
      if (b.meta.kind === 'value' && a.meta.kind !== 'value') return 1;
      return b.meta.score - a.meta.score;
    });
  const tips = selectDiverseTips(rankedTips, 3, 1).map((x) => x.m);
  if (!tips.length) {
    el.innerHTML = `<div class="empty-board">Sin tips con valor/prob para ${escapeHtml(
      formatDateCenter(resolveSelectedDate())
    )}.</div>`;
    return;
  }
  el.innerHTML = tips
    .map((m, i) => {
      const home = m.homeTeam?.name || '';
      const away = m.awayTeam?.name || '';
      const tip = m.suggestedBet;
      const tipLabel = tip ? labelBet(tip, home, away) : 'Sin tip';
      const prob = tipProbPct(m);
      const oddsTxt = tipOddsDisplay(m.tipOdds);
      const edge = m.valueEdge != null ? Number(m.valueEdge) : null;
      const valueTxt =
        edge != null && Number.isFinite(edge) && m.oddsSource === 'book'
          ? `Valor +${(edge * 100).toFixed(0)}%`
          : edge != null && Number.isFinite(edge)
            ? `Edge ${(edge * 100).toFixed(0)}%`
            : '';
      const rank = i + 1;
      const liveStrip = m.status === 'live' ? liveStripHtml(m) : '';
      return `
      <article class="card card--tip card--row card--top3" data-analyze="${Number(m.id)}">
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
          ${crestsRowHtml(home, m.homeTeam?.logo, away, m.awayTeam?.logo)}
          <p class="card-tip__match">${escapeHtml(home)} vs ${escapeHtml(away)}</p>
          <p class="card-tip__league muted">${escapeHtml(leagueKey(m))} · ${escapeHtml(
            formatMatchDate(m.matchDate)
          )}</p>
        </div>
        <button class="primary card-tip__action" data-analyze="${Number(m.id)}" type="button">Analizar</button>
      </article>`;
    })
    .join('');
  bindAnalyze(el);
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

function tipMetaHtml({ tipOdds, valueEdge, valueMarket, home, away, oddsSource, dataQuality }) {
  const bits = [];
  const oddsTxt = tipOddsDisplay(tipOdds);
  if (oddsTxt) {
    bits.push(`<span class="tip-odds">${oddsTxt}</span>`);
  }
  if (dataQuality === 'low') bits.push('<span class="data-q data-q--low">muestra baja</span>');
  if (valueEdge != null && valueEdge >= 0.04 && oddsSource === 'book') {
    bits.push(
      `<span class="value">Valor +${(Number(valueEdge) * 100).toFixed(0)}%${
        valueMarket ? ` · ${escapeHtml(labelBet(valueMarket, home, away))}` : ''
      }</span>`
    );
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
        ${tipMetaHtml({ tipOdds, valueEdge, valueMarket, home, away, oddsSource, dataQuality })}
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
  const valueBit =
    raw.valueEdge != null && Number(raw.valueEdge) >= 0.04
      ? `<span class="sheet__edge">+${(Number(raw.valueEdge) * 100).toFixed(0)}%</span>`
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
      </span>
      <span class="sheet__odd">
        <span class="sheet__odd-v">${oddsTxt}</span>
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
      (m) => m.valueEdge != null && Number(m.valueEdge) >= 0.04 && m.oddsSource === 'book'
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
  renderTop3();
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
  if (document.getElementById('views')?.dataset.view === 'bandas') {
    loadOddsBandBets().catch(() => {});
  } else if (cachedOddsBandBets.length) {
    renderOddsBandBets(cachedOddsBandBets);
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

/** Profitability block: only meaningful with real bookmaker prices. */
function perfRoiHtml(perf) {
  const roi = perf?.roi || null;
  const staked = Number(roi?.staked || 0);
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
  if (perf) applyOddsPerformance(perf);

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

  const calib = perf?.calibration;
  let calibBit = '';
  if (calib?.updatedAt) {
    const d = new Date(calib.updatedAt);
    const when = Number.isNaN(d.getTime())
      ? String(calib.updatedAt).slice(0, 10)
      : d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    calibBit = ` · Calibrado ${escapeHtml(when)}`;
  }

  const families = (perf?.byFamily || []).filter((f) => (f.hits || 0) + (f.misses || 0) > 0);
  const familiesHtml = families.length
    ? `<div class="perf-strip" aria-label="Por mercado">${families
        .map((f) => {
          const n = (f.hits || 0) + (f.misses || 0);
          const hr = f.hitRate != null ? `${(Number(f.hitRate) * 100).toFixed(0)}%` : '—';
          const roi = roiLabel(f.roi);
          return `<div class="perf-strip__item"><span class="perf-strip__lab">${escapeHtml(
            labelFamily(f.family)
          )}</span><strong>${hr}</strong><span class="muted">${f.hits}/${n}</span>${
            roi ? `<span class="perf-strip__roi ${roiTone(f.roi)}">${escapeHtml(roi)}</span>` : ''
          }</div>`;
        })
        .join('')}</div>`
    : '';

  const winBit = perf?.windowLabel ? ` · ${escapeHtml(perf.windowLabel)}` : '';
  summary.innerHTML = `
    <div class="perf-board">
      <div class="perf-board__hero">
        <div class="perf-board__rate">${rate}</div>
        <div class="perf-board__label">Aciertos${winBit}${calibBit}</div>
      </div>
      <div class="perf-board__stats">
        ${perfStatCell('Aciertos', hits)}
        ${perfStatCell('Fallos', misses)}
        ${perfStatCell('Pendientes', pending)}
        ${perfStatCell('Cerrados', decided)}
      </div>
    </div>
    ${perfRoiHtml(perf)}
    ${familiesHtml}`;

  const rows = perf?.recent || [];
  if (!rows.length) {
    recent.innerHTML = `<div class="perf-empty muted">Sin tips cerrados aún — cuando liquiden partidos, aparecen aquí.</div>`;
    return;
  }
  recent.innerHTML = `
    <div class="perf-list__head" aria-hidden="true">
      <span>Recientes</span>
      <span>${rows.length}</span>
    </div>
    <div class="perf-list" role="list">${rows.map(recentTipRowHtml).join('')}</div>`;
}

async function fetchTipPerformance(q) {
  if (tipPerfCache && tipPerfCacheKey === q) return tipPerfCache;
  const perf = await api(`/api/v1/tips/performance?${q}`);
  tipPerfCacheKey = q;
  tipPerfCache = perf;
  applyOddsPerformance(perf);
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
  const id = (hash || '').replace('#', '');
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
  const view = normalizeViewHash(hash);
  const views = document.getElementById('views');
  if (views) views.dataset.view = view;
  document.querySelectorAll('.v2-nav__link, .dock__link').forEach((link) => {
    const target = normalizeViewHash(link.getAttribute('href') || '');
    const active =
      target === view || (view === 'bandas' && target === 'stats') || (view === 'premium' && false);
    link.classList.toggle('is-active', active);
  });
  if (pushHash && location.hash !== `#${view}`) {
    history.replaceState(null, '', `#${view}`);
  }
  window.scrollTo(0, 0);
  if (view === 'stats' || view === 'aciertos') loadPerformance().catch(() => {});
  if (view === 'top3') renderTop3();
  if (view === 'ligas') renderLigasView();
  if (view === 'bandas') loadOddsBandBets().catch(() => {});
  if (view === 'ajustes') syncPrivacyToggles();
}

function syncOddsBandChips() {
  /* Band picker lives in #odds-band-stats tiles (chips bar removed for iPhone). */
}

const ODDS_BAND_RANGES = {
  '1': '1.05–1.69',
  '2': '1.65–2.54',
  '3': '2.55–3.54',
  '4': '3.55–4.44',
  '5': '4.45–6.50',
};

const STAT_BAND_LABELS = {
  '1': 'Cortas',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
};

function tipStatsBand(row) {
  const o = Number(row?.tipOdds);
  if (Number.isFinite(o) && o > 1) {
    if (o < 1.7) return '1';
    if (o < 2.5) return '2';
    if (o < 3.5) return '3';
    if (o < 4.5) return '4';
    if (o <= 6.5) return '5';
  }
  const b = row?.oddsBand != null ? String(row.oddsBand) : '';
  return ['1', '2', '3', '4', '5'].includes(b) ? b : null;
}

function applyOddsPerformance(perf) {
  if (!perf) return;
  cachedOddsBandPerf = perf.byOddsBand || null;
  cachedOddsRecent = Array.isArray(perf.recent) ? perf.recent : [];
  cachedOddsCombos = Array.isArray(perf.recentCombos) ? perf.recentCombos : [];
  cachedOddsGlobal = {
    hits: Number(perf.hits || 0),
    misses: Number(perf.misses || 0),
    decided: Number(perf.decided || 0),
    hitRate: perf.hitRate != null ? Number(perf.hitRate) : null,
    pending: Number(perf.pending || 0),
    windowLabel: perf.windowLabel || null,
  };
  renderOddsBandStats(cachedOddsBandPerf);
  renderOddsBandHistory(oddsBandFilter);
}

function renderOddsBandStats(byOddsBand) {
  const wrap = document.getElementById('odds-band-stats');
  if (!wrap) return;
  const rows = byOddsBand || [];
  const map = new Map(rows.map((r) => [String(r.band), r]));
  const g = cachedOddsGlobal;
  const gDecided = Number(g?.decided || 0);
  const gHits = Number(g?.hits || 0);
  const gRate =
    g?.hitRate != null && gDecided > 0
      ? `${Math.round(Number(g.hitRate) * 100)}%`
      : gDecided > 0
        ? `${Math.round((gHits / gDecided) * 100)}%`
        : '—';
  const period = g?.windowLabel ? escapeHtml(g.windowLabel) : 'ventana';
  const globalHtml = `<div class="odds-global" aria-label="Aciertos tips">
    <div class="odds-global__main">
      <span class="odds-global__label">Tips</span>
      <span class="odds-global__rate">${gRate}</span>
      <span class="odds-global__sub">${
        gDecided > 0 ? `${gHits}/${gDecided}` : 'sin tips cerrados'
      }</span>
    </div>
    <span class="odds-global__period">${period} · Cortas=tips · 2–5=combinadas</span>
  </div>`;
  const cards = ['1', '2', '3', '4', '5']
    .map((band) => {
      const b = map.get(band);
      const hits = Number(b?.hits || 0);
      const misses = Number(b?.misses || 0);
      const pending = Number(b?.pending || 0);
      const decided = hits + misses;
      const lowSample = decided > 0 && decided < 10;
      const rate =
        decided <= 0
          ? '—'
          : lowSample
            ? 'muestra baja'
            : b?.hitRate != null
              ? `${Math.round(Number(b.hitRate) * 100)}%`
              : `${Math.round((hits / decided) * 100)}%`;
      const sub =
        decided > 0
          ? lowSample
            ? `${hits}/${decided} · n<10`
            : `${hits} aciertos · ${misses} fallos`
          : pending > 0
            ? `${pending} pend.`
            : 'sin muestra';
      const label = STAT_BAND_LABELS[band] || band;
      const range = ODDS_BAND_RANGES[band] || '';
      const kind = band === '1' ? 'tips' : 'comb.';
      const active = band === oddsBandFilter ? ' is-active' : '';
      return `<button type="button" class="odds-stat${active}" data-odds-band="${band}" aria-pressed="${
        band === oddsBandFilter ? 'true' : 'false'
      }">
        <span class="odds-stat__band">${escapeHtml(label)}</span>
        <span class="odds-stat__range">${escapeHtml(range)} · ${kind}</span>
        <span class="odds-stat__rate">${rate}</span>
        <span class="odds-stat__sub">${escapeHtml(sub)}</span>
      </button>`;
    })
    .join('');
  wrap.innerHTML = `${globalHtml}<div class="odds-stats" role="group" aria-label="Bandas">${cards}</div>`;
  wrap.querySelectorAll('button[data-odds-band]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const band = btn.getAttribute('data-odds-band') || '2';
      oddsBandFilter = band;
      renderOddsBandStats(cachedOddsBandPerf);
      renderOddsBandHistory(band);
      if (band !== '1') {
        loadOddsBandBets().catch((err) => showBanner(err.message, 'error'));
      } else {
        const hint = document.getElementById('odds-band-hint');
        const el = document.getElementById('odds-band-bets');
        if (hint) hint.textContent = 'Cortas = tips individuales · historial arriba · combinadas en bandas 2–5';
        if (el) {
          el.className = 'combo-board';
          el.innerHTML = '';
        }
      }
    });
  });
}

function tipHistoryRowHtml(r) {
  const country = r.leagueCountry || '';
  const flag = countryFlag(country);
  const countryEs = countryLabel(country);
  const odds =
    r.tipOdds != null && !Number.isNaN(Number(r.tipOdds))
      ? Number(r.tipOdds).toFixed(2)
      : '—';
  return `
    <article class="odds-history__row">
      <div class="odds-history__top">
        ${outcomeBadge(r.outcome)}
        <span class="odds-history__tip tip-accent">${escapeHtml(
          labelBet(r.suggestedBet, r.homeName, r.awayName)
        )}</span>
        <span class="odds-history__odds">@${odds}</span>
      </div>
      <p class="odds-history__match">${escapeHtml(r.homeName || '')} vs ${escapeHtml(
        r.awayName || ''
      )}</p>
      <p class="odds-history__meta muted">
        <span class="odds-history__flag" aria-hidden="true">${flag}</span>
        ${escapeHtml(countryEs)} · ${escapeHtml(r.leagueName || '—')}
      </p>
    </article>`;
}

function comboHistoryRowHtml(c) {
  const legs = c.legs || [];
  const total =
    c.combinedOdds != null && !Number.isNaN(Number(c.combinedOdds))
      ? Number(c.combinedOdds).toFixed(2)
      : '—';
  const legsHtml = legs
    .map((leg) => {
      const home = leg.homeName || leg.homeTeam?.name || '';
      const away = leg.awayName || leg.awayTeam?.name || '';
      const flag = countryFlag(leg.leagueCountry || '');
      return `<li class="odds-history-combo__leg">
        <span class="odds-history-combo__match">${escapeHtml(home)} · ${escapeHtml(away)}</span>
        <span class="odds-history-combo__tip tip-accent">${escapeHtml(
          labelBet(leg.suggestedBet, home, away)
        )}</span>
        <span class="odds-history-combo__meta muted">${flag} ${escapeHtml(
          leg.league || '—'
        )} · ${leg.tipOdds != null ? Number(leg.tipOdds).toFixed(2) : '—'}</span>
      </li>`;
    })
    .join('');
  return `
    <article class="odds-history__row odds-history-combo">
      <div class="odds-history__top">
        ${outcomeBadge(c.outcome)}
        <span class="odds-history__tip">Combinada · ${legs.length} piernas</span>
        <span class="odds-history__odds">@${total}</span>
      </div>
      <ul class="odds-history-combo__legs">${legsHtml}</ul>
    </article>`;
}

function renderOddsBandHistory(band) {
  const el = document.getElementById('odds-band-history');
  if (!el) return;
  const b = String(band || oddsBandFilter || '2');
  const label = STAT_BAND_LABELS[b] || b;
  const range = ODDS_BAND_RANGES[b] || '';
  const tabs = [
    ['all', 'Todos'],
    ['miss', 'Fallos'],
    ['hit', 'Aciertos'],
  ]
    .map(([id, lab]) => {
      const active = oddsHistoryFilter === id ? ' is-active' : '';
      return `<button type="button" class="odds-history__tab${active}" data-hist-filter="${id}">${lab}</button>`;
    })
    .join('');

  const wrapHistory = (summaryLabel, closedCount, subtitle, body) => {
    el.innerHTML = `
      <details class="odds-history" open>
        <summary class="odds-history__summary">
          <span class="odds-history__summary-title">Historial · ${escapeHtml(summaryLabel)}</span>
          <span class="odds-history__summary-meta muted">${closedCount} cerrada${closedCount === 1 ? '' : 's'}</span>
        </summary>
        <div class="odds-history__head">
          <div>
            <p class="odds-history__title">${escapeHtml(subtitle)}</p>
            <p class="odds-history__range muted">${escapeHtml(range)}</p>
          </div>
          <div class="odds-history__tabs" role="tablist">${tabs}</div>
        </div>
        <div class="odds-history__list">${body}</div>
      </details>`;
    const details = el.querySelector('details.odds-history');
    details?.addEventListener('toggle', (ev) => {
      if (!details.open) {
        ev.preventDefault();
        details.open = true;
      }
    });
    el.querySelectorAll('[data-hist-filter]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        oddsHistoryFilter = btn.getAttribute('data-hist-filter') || 'all';
        renderOddsBandHistory(oddsBandFilter);
      });
    });
  };

  if (b === '1') {
    const all = (cachedOddsRecent || []).filter((r) => tipStatsBand(r) === '1');
    let list = all;
    if (oddsHistoryFilter === 'miss') list = list.filter((r) => r.outcome === 'miss');
    if (oddsHistoryFilter === 'hit') list = list.filter((r) => r.outcome === 'hit');
    const body = list.length
      ? list.slice(0, 12).map(tipHistoryRowHtml).join('')
      : `<div class="empty-board odds-history__empty">Sin tips Cortas cerrados en esta ventana.</div>`;
    wrapHistory('Cortas', all.length, 'Tips oficiales por partido', body);
    return;
  }

  const all = filterCombosByScope(cachedOddsCombos || []).filter(
    (c) => String(c.oddsBand) === b
  );
  let list = all;
  if (oddsHistoryFilter === 'miss') list = list.filter((c) => c.outcome === 'miss');
  if (oddsHistoryFilter === 'hit') list = list.filter((c) => c.outcome === 'hit');
  const body = list.length
    ? list.slice(0, 10).map(comboHistoryRowHtml).join('')
    : `<div class="empty-board odds-history__empty">Sin combinadas cerradas en banda ${escapeHtml(
        label
      )} para esta ventana.</div>`;
  wrapHistory(`banda ${label}`, all.length, `Combinadas · acierto = todas las piernas`, body);
}

function comboCardHtml(combo) {
  const legs = combo.legs || [];
  const total =
    combo.combinedOdds != null ? Number(combo.combinedOdds).toFixed(2) : '—';
  const conf =
    combo.avgConfidence != null && !Number.isNaN(Number(combo.avgConfidence))
      ? `${Math.round(Number(combo.avgConfidence))}%`
      : '';
  const legsHtml = legs
    .map((leg) => {
      const home = leg.homeTeam?.name || '';
      const away = leg.awayTeam?.name || '';
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
        <span class="combo-leg__odds">${
          leg.confidenceScore != null && !Number.isNaN(Number(leg.confidenceScore))
            ? `${Math.round(Number(leg.confidenceScore))}% · `
            : ''
        }${leg.tipOdds != null ? Number(leg.tipOdds).toFixed(2) : '—'}</span>
      </button>`;
    })
    .join('');

  return `
    <article class="combo-card" role="listitem">
      <div class="combo-card__head">
        <div>
          <div class="combo-card__label">Combinada · ${legs.length} piernas</div>
          <div class="combo-card__odds tip-accent">${total}</div>
        </div>
        <div class="combo-card__side">
          ${conf ? `<span class="${confClass(combo.avgConfidence)}">${conf}</span>` : ''}
          <span class="muted">media conf.</span>
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

function renderOddsBandBets(combos) {
  const el = document.getElementById('odds-band-bets');
  const hint = document.getElementById('odds-band-hint');
  const wrap = document.getElementById('odds-band-bets-wrap');
  if (!el) return;
  syncOddsBandChips();
  const range = ODDS_BAND_RANGES[oddsBandFilter] || '';
  const filtered = filterCombosByScope(combos)
    .slice()
    .sort(
      (a, b) =>
        Number(b.avgConfidence || 0) - Number(a.avgConfidence || 0) ||
        Number(a.combinedOdds || 0) - Number(b.combinedOdds || 0)
    )
    .slice(0, 5);
  if (hint) {
    const leagueBit =
      leagueFilterIds.size > 0
        ? ` · ${leagueFilterIds.size} liga${leagueFilterIds.size === 1 ? '' : 's'}`
        : '';
    hint.innerHTML = filtered.length
      ? `<span class="odds-board__top-title">Top 5 combinadas · mayor %</span><span class="odds-board__top-meta">${filtered.length} mostrada${filtered.length === 1 ? '' : 's'} · ${escapeHtml(range || '—')}${leagueBit}</span>`
      : `Sin combinadas en banda ${oddsBandFilter} (${range || '—'}) para esta ventana${leagueBit}`;
  }
  if (wrap) wrap.hidden = false;
  if (!filtered.length) {
    el.className = 'combo-board';
    el.innerHTML = `<div class="empty-board">${
      (combos || []).length
        ? 'Ninguna combina encaja con estos filtros de liga.'
        : 'Sin combinadas cerca de banda ' + oddsBandFilter + ' en la ventana.'
    }</div>`;
    return;
  }
  el.className = 'combo-board';
  el.innerHTML = filtered.map(comboCardHtml).join('');
  bindAnalyze(el);
}

async function loadOddsBandBets() {
  const el = document.getElementById('odds-band-bets');
  const hint = document.getElementById('odds-band-hint');
  syncOddsBandChips();
  const q = matchListQuery();

  // Reuse perf cache when possible (avoid double settle on boot)
  try {
    await fetchTipPerformance(q);
  } catch (_) {
    renderOddsBandHistory(oddsBandFilter);
  }

  if (oddsBandFilter === '1') {
    const wrap = document.getElementById('odds-band-bets-wrap');
    if (wrap) wrap.hidden = false;
    if (hint) {
      hint.innerHTML =
        '<span class="odds-board__top-title">Top 5 combinadas</span><span class="odds-board__top-meta">Cortas = tips · combinadas solo en bandas 2–5</span>';
    }
    if (el) {
      el.className = 'combo-board';
      el.innerHTML = '';
    }
    return;
  }

  if (el) {
    el.className = 'combo-board';
    el.innerHTML = `<div class="muted odds-board__loading">Cargando combinadas banda ${oddsBandFilter}…</div>`;
  }
  try {
    const leagueQ =
      leagueFilterIds.size > 0
        ? `&leagueIds=${encodeURIComponent([...leagueFilterIds].join(','))}`
        : '';
    const data = await api(
      `/api/v1/matches/best-bets?${q}&oddsBand=${encodeURIComponent(oddsBandFilter)}&limit=5${leagueQ}`
    );
    cachedOddsBandBets = data.combos || [];
    renderOddsBandBets(cachedOddsBandBets);
  } catch (err) {
    cachedOddsBandBets = [];
    if (el) {
      el.innerHTML = `<div class="empty-board conf-lo">${escapeHtml(err.message)}</div>`;
    }
  }
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
              p.value_edge != null && p.value_edge >= 0.05
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

  // Close today's/yesterday's results before reading matches and hit stats.
  // The endpoint has its own cooldown, so day/filter navigation stays cheap.
  const activeDate = resolveSelectedDate();
  if (activeDate === todayYmd() || activeDate === yesterdayYmd()) {
    try {
      await api('/api/v1/matches/refresh-live', { method: 'POST' });
    } catch (_) {
      /* keep the read path available if an upstream result feed is unavailable */
    }
  }

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

  await Promise.allSettled([statusP, summaryP]);

  if (errors.length >= 2) {
    showBanner('No hay conexión con la API. Revisa la red e inténtalo de nuevo.', 'error');
  } else if (errors.length) {
    showBanner(`Algunas secciones fallaron (${errors.join(', ')}). El resto sigue disponible.`, 'error');
  } else {
    showBanner('');
  }

  const view = document.getElementById('views')?.dataset.view;
  if (view === 'bandas') loadOddsBandBets().catch(() => {});
  else if (view === 'stats' || view === 'aciertos') loadPerformance().catch(() => {});
  else if (view === 'top3') renderTop3();
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

loadPrivacyPrefs();
restoreFiltersIfAllowed();
syncWindowChips();
syncLiveChip();
syncScopeChips();
syncPrivacyToggles();

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

document.querySelectorAll('.ligas-tabs__btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    ligasViewScope = btn.dataset.ligasScope || 'clubs';
    renderLigasView();
  });
});

document.getElementById('ligas-apply')?.addEventListener('click', () => {
  if (ligasViewScope === 'clubs' || ligasViewScope === 'intl') {
    scopeFilter = ligasViewScope;
    syncScopeChips();
  }
  persistFiltersIfAllowed();
  setActiveNav('#partidos');
  applyFilters();
});

document.getElementById('ligas-clear')?.addEventListener('click', () => {
  leagueFilterIds.clear();
  renderLigasView();
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
