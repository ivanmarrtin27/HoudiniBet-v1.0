const API = '';

const PRIVACY_KEY = 'houdini_privacy_v1';
const CONSENT_KEY = 'houdini_consent_v1';
const CONSENT_VERSION = 2;
const FILTERS_KEY = 'houdini_filters_v1';
const SEARCH_KEY = 'houdini_last_search_v1';

/** @type {{ analytics: boolean, saveSearch: boolean, rememberFilters: boolean }} */
let privacyPrefs = {
  analytics: false,
  saveSearch: false,
  rememberFilters: false,
};

/** @type {{ version: number, choice: 'all'|'necessary'|'custom', ageConfirmed: boolean, acceptedAt: string } | null} */
let consentState = null;
let consentFocusBefore = null;
let consentTrapHandler = null;

const CONSENT_CHOICES = new Set(['all', 'necessary', 'custom']);

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

function deriveConsentChoiceFromPrefs() {
  const { analytics, saveSearch, rememberFilters } = privacyPrefs;
  if (analytics && saveSearch && rememberFilters) return 'all';
  if (!analytics && !saveSearch && !rememberFilters) return 'necessary';
  return 'custom';
}

function loadConsent() {
  const saved = readJsonStore(CONSENT_KEY);
  if (
    saved &&
    typeof saved === 'object' &&
    Number(saved.version) === CONSENT_VERSION &&
    CONSENT_CHOICES.has(saved.choice) &&
    saved.ageConfirmed === true
  ) {
    consentState = {
      version: CONSENT_VERSION,
      choice: saved.choice,
      ageConfirmed: true,
      acceptedAt: String(saved.acceptedAt || ''),
    };
  } else {
    consentState = null;
  }
  return consentState;
}

function hasValidConsent() {
  return Boolean(
    consentState &&
      consentState.version === CONSENT_VERSION &&
      consentState.ageConfirmed === true &&
      CONSENT_CHOICES.has(consentState.choice)
  );
}

function saveConsentRecord(choice) {
  consentState = {
    version: CONSENT_VERSION,
    choice,
    ageConfirmed: true,
    acceptedAt: new Date().toISOString(),
  };
  writeJsonStore(CONSENT_KEY, consentState);
}

function syncConsentChoiceFromPrefs() {
  if (!hasValidConsent()) return;
  const next = deriveConsentChoiceFromPrefs();
  if (consentState.choice !== next) {
    consentState = { ...consentState, choice: next };
    writeJsonStore(CONSENT_KEY, consentState);
  }
}

function clearOptionalStores() {
  try {
    localStorage.removeItem(FILTERS_KEY);
    localStorage.removeItem(SEARCH_KEY);
  } catch (_) {
    /* ignore */
  }
}

function applyConsentChoice(choice) {
  if (choice === 'custom') {
    savePrivacyPrefs();
    saveConsentRecord(deriveConsentChoiceFromPrefs());
    if (!privacyPrefs.saveSearch) {
      try {
        localStorage.removeItem(SEARCH_KEY);
      } catch (_) {
        /* ignore */
      }
    }
    if (!privacyPrefs.rememberFilters) {
      try {
        localStorage.removeItem(FILTERS_KEY);
      } catch (_) {
        /* ignore */
      }
    }
    syncPrivacyToggles();
    syncConsentGateToggles();
    return;
  }
  const all = choice === 'all';
  privacyPrefs = {
    analytics: all,
    saveSearch: all,
    rememberFilters: all,
  };
  savePrivacyPrefs();
  saveConsentRecord(all ? 'all' : 'necessary');
  if (!all) clearOptionalStores();
  syncPrivacyToggles();
  syncConsentGateToggles();
}

function clearDevicePrivacyData() {
  try {
    localStorage.removeItem(CONSENT_KEY);
    localStorage.removeItem(PRIVACY_KEY);
    localStorage.removeItem(FILTERS_KEY);
    localStorage.removeItem(SEARCH_KEY);
  } catch (_) {
    /* ignore */
  }
  privacyPrefs = {
    analytics: false,
    saveSearch: false,
    rememberFilters: false,
  };
  consentState = null;
  syncPrivacyToggles();
  syncConsentGateToggles();
  resetConsentAgeUi();
  openConsentGate();
}

function consentFocusable(root) {
  return [
    ...root.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ),
  ].filter((el) => {
    if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false;
    if (el.closest('[hidden]')) return false;
    return el.getClientRects().length > 0;
  });
}

function releaseConsentTrap() {
  if (consentTrapHandler) {
    document.removeEventListener('keydown', consentTrapHandler, true);
    consentTrapHandler = null;
  }
}

function armConsentTrap() {
  releaseConsentTrap();
  const gate = document.getElementById('consent-gate');
  if (!gate) return;
  consentTrapHandler = (e) => {
    if (!document.documentElement.classList.contains('consent-needed')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key !== 'Tab') return;
    const visible = gate.querySelector('.consent-gate__card:not([hidden])') || gate;
    const nodes = consentFocusable(visible);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', consentTrapHandler, true);
}

function setShellInert(on) {
  const ids = ['views', 'panel', 'panel-backdrop', 'global-banner', 'boot-splash'];
  document
    .querySelectorAll('.v2-header, .v2-main, .site-footer, .skip-link, .app-tabbar')
    .forEach((el) => {
      if (on) el.setAttribute('inert', '');
      else el.removeAttribute('inert');
    });
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (on) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  });
}

function showConsentCard(cardId) {
  const main = document.getElementById('consent-main');
  const custom = document.getElementById('consent-custom');
  const doc = document.getElementById('consent-doc');
  if (main) main.hidden = cardId !== 'main';
  if (custom) custom.hidden = cardId !== 'custom';
  if (doc) doc.hidden = cardId !== 'doc';
}

function isConsentAgeChecked() {
  const main = document.getElementById('consent-age');
  const custom = document.getElementById('consent-age-custom');
  const visibleCustom = document.getElementById('consent-custom');
  if (visibleCustom && !visibleCustom.hidden) return Boolean(custom?.checked);
  return Boolean(main?.checked);
}

function syncConsentAgeCheckboxes(sourceId) {
  const main = document.getElementById('consent-age');
  const custom = document.getElementById('consent-age-custom');
  const source = sourceId === 'custom' ? custom : main;
  const checked = Boolean(source?.checked);
  if (main && source !== main) main.checked = checked;
  if (custom && source !== custom) custom.checked = checked;
  syncConsentActionEnabled();
}

function syncConsentActionEnabled() {
  const ok = isConsentAgeChecked();
  ['consent-accept-all', 'consent-necessary', 'consent-customize', 'consent-save-custom'].forEach(
    (id) => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = !ok;
    }
  );
}

function resetConsentAgeUi() {
  const main = document.getElementById('consent-age');
  const custom = document.getElementById('consent-age-custom');
  if (main) main.checked = false;
  if (custom) custom.checked = false;
  syncConsentActionEnabled();
}

function syncConsentGateToggles() {
  const map = [
    ['consent-pref-analytics', 'analytics'],
    ['consent-pref-save-search', 'saveSearch'],
    ['consent-pref-remember-filters', 'rememberFilters'],
  ];
  map.forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = !!privacyPrefs[key];
    el.setAttribute('aria-checked', privacyPrefs[key] ? 'true' : 'false');
  });
}

function readConsentGatePrefsIntoState() {
  privacyPrefs = {
    analytics: !!document.getElementById('consent-pref-analytics')?.checked,
    saveSearch: !!document.getElementById('consent-pref-save-search')?.checked,
    rememberFilters: !!document.getElementById('consent-pref-remember-filters')?.checked,
  };
}

function openConsentDoc(docId) {
  const titleEl = document.getElementById('consent-doc-title');
  const bodyEl = document.getElementById('consent-doc-body');
  const source = document.querySelector(`.legal-body[data-legal="${docId}"]`);
  if (!titleEl || !bodyEl || !source) return;
  const titles = {
    privacidad: 'Privacidad',
    cookies: 'Cookies',
    aviso: 'Aviso',
    condiciones: 'Condiciones',
  };
  titleEl.textContent = titles[docId] || 'Documento';
  bodyEl.innerHTML = source.innerHTML;
  showConsentCard('doc');
  document.getElementById('consent-doc-back')?.focus();
}

function closeConsentDoc() {
  showConsentCard('main');
  const accept = document.getElementById('consent-accept-all');
  if (accept && !accept.disabled) accept.focus();
  else document.getElementById('consent-age')?.focus();
}

function openConsentCustom() {
  if (!isConsentAgeChecked()) return;
  syncConsentGateToggles();
  showConsentCard('custom');
  document.getElementById('consent-custom-back')?.focus();
}

function closeConsentCustom() {
  showConsentCard('main');
  const customize = document.getElementById('consent-customize');
  if (customize && !customize.disabled) customize.focus();
  else document.getElementById('consent-age')?.focus();
}

function openConsentGate({ docId = null } = {}) {
  const gate = document.getElementById('consent-gate');
  if (!gate) return;
  document.documentElement.classList.add('consent-needed');
  gate.hidden = false;
  setShellInert(true);
  showConsentCard('main');
  syncConsentGateToggles();
  syncConsentActionEnabled();
  if (docId) openConsentDoc(docId);
  armConsentTrap();
  consentFocusBefore = document.activeElement;
  requestAnimationFrame(() => {
    if (docId) document.getElementById('consent-doc-back')?.focus();
    else document.getElementById('consent-age')?.focus();
  });
}

function closeConsentGate() {
  const gate = document.getElementById('consent-gate');
  document.documentElement.classList.remove('consent-needed');
  if (gate) gate.hidden = true;
  showConsentCard('main');
  setShellInert(false);
  releaseConsentTrap();
  const restore = consentFocusBefore;
  consentFocusBefore = null;
  const focusTarget =
    document.querySelector('.v2-nav__link.is-active') ||
    document.getElementById('views') ||
    restore;
  if (focusTarget && typeof focusTarget.focus === 'function') {
    try {
      focusTarget.focus({ preventScroll: true });
    } catch (_) {
      /* ignore */
    }
  }
}

let appBootStarted = false;

function acceptConsent(choice) {
  if (!isConsentAgeChecked()) return;
  if (choice === 'custom') {
    readConsentGatePrefsIntoState();
    applyConsentChoice('custom');
  } else {
    applyConsentChoice(choice);
  }
  closeConsentGate();
  trackEvent('consent_accept', { choice: consentState?.choice || choice });
  const hash = location.hash || '';
  const view = normalizeViewHash(hash);
  if (isLegalViewId(view) || view === 'ajustes' || view === 'premium' || view === 'admin') {
    setActiveNav(hash || `#${view}`, { pushHash: false });
  } else if (hash) {
    setActiveNav(hash, { pushHash: false });
  } else {
    setActiveNav('#partidos', { pushHash: false });
  }
  startAppAfterConsent();
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

/** First-party page hit for admin IP log (Worker D1). Not third-party analytics. */
function reportPageHit() {
  if (!hasValidConsent()) return;
  try {
    const path = truncateStr(
      `${location.pathname || '/'}${location.hash || ''}`,
      240
    );
    const payload = JSON.stringify({
      path,
      referrer: document.referrer || '',
    });
    const url = `${API}/api/v1/telemetry/hit`;
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([payload], { type: 'application/json' });
      if (navigator.sendBeacon(url, blob)) return;
    }
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      credentials: 'same-origin',
      keepalive: true,
    }).catch(() => {});
  } catch (_) {
    /* ignore */
  }
}

function truncateStr(s, max) {
  const t = String(s || '');
  return t.length > max ? t.slice(0, max) : t;
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

/** 'hoy' | 'manana' | 'ayer' | 'date' */
let windowMode = 'hoy';
let selectedDate = new Date().toISOString().slice(0, 10);
/** Always all competitions (scope chips removed). */
let scopeFilter = 'all';
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
      { apiId: 2, name: 'Champions League', tag: 'UCL' },
      { apiId: 3, name: 'Europa League', tag: 'UEL' },
      { apiId: 5, name: 'Liga de Naciones', tag: 'UNL' },
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
      { apiId: 141, name: 'LaLiga Hypermotion', tag: '2ª' },
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
/**
 * Legacy soft-caps flag (Top10 caps etc.). Content paywall is now
 * `contentUnlocked()` = premiumState.premium (even while this is true).
 */
const PREMIUM_UNLOCKED = true;

function contentUnlocked() {
  return Boolean(premiumState.premium);
}

/** @deprecated use contentUnlocked — kept as alias for older call sites */
function tipsUnlocked() {
  return contentUnlocked();
}

/** Blur mask + Ver planes CTA for free (logged-in) users. */
function hbCensorWrap(html, { block = false } = {}) {
  if (!html) return '';
  if (contentUnlocked()) return html;
  const cls = block ? 'hb-censor hb-censor--block' : 'hb-censor hb-censor--inline';
  return `<div class="${cls}" data-hb-censor role="button" tabindex="0" aria-label="${escapeHtml(t('censor.aria'))}">
    <div class="hb-censor__veil" aria-hidden="true">${html}</div>
    <div class="hb-censor__lock" aria-hidden="true">
      <span class="hb-censor__lock-icon"></span>
      <span class="hb-censor__lock-title">${escapeHtml(t('censor.title'))}</span>
      <span class="hb-censor__lock-sub">${escapeHtml(t('censor.sub'))}</span>
      <span class="hb-censor__lock-btn">${escapeHtml(t('censor.cta'))}</span>
    </div>
  </div>`;
}

function hbPillTone(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 'muted';
  if (n >= 0.6) return 'hi';
  if (n >= 0.4) return 'mid';
  return 'lo';
}

function hbPillHtml(v) {
  if (v == null || !Number.isFinite(Number(v))) {
    return `<span class="hb-pill hb-pill--muted">—</span>`;
  }
  const n = Number(v);
  return `<span class="hb-pill hb-pill--${hbPillTone(n)}" data-target="${n}">0%</span>`;
}

/** Trend table with colored pills (blurred) for free users — Oddster-style. */
function lockedTrendTableHtml({ title, homeName, awayName, metrics }) {
  if (!(metrics || []).length) return '';
  const rows = (metrics || [])
    .map(
      (m) => `<tr>
        <td class="hb-trend__metric">${escapeHtml(m.label)}</td>
        <td>${hbPillHtml(m.home)}</td>
        <td>${hbPillHtml(m.away)}</td>
        <td>${hbPillHtml(m.match)}</td>
      </tr>`
    )
    .join('');
  const table = `<section class="hb-trend">
    <h3 class="hb-trend__title">${escapeHtml(title)}</h3>
    <div class="hb-trend__wrap">
      <table class="hb-trend__table">
        <thead><tr>
          <th>Métrica</th>
          <th>${escapeHtml(homeName || 'Local')}</th>
          <th>${escapeHtml(awayName || 'Visit.')}</th>
          <th>Partido</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`;
  return hbCensorWrap(table, { block: true });
}

/** Build one trend table body (optional avg row + metric pills). */
function mpTrendTableSection({
  titleText,
  homeName,
  awayName,
  ladderRows,
  avgRowHtml = '',
}) {
  const metricRows = (ladderRows || [])
    .map(
      (m) => `<tr>
        <td class="mp-trend-table__metric">${escapeHtml(m.label)}</td>
        <td>${hbPillHtml(m.home)}</td>
        <td>${hbPillHtml(m.away)}</td>
        <td>${hbPillHtml(m.match)}</td>
      </tr>`
    )
    .join('');
  if (!avgRowHtml && !metricRows) return '';
  return `<section class="mp-trend-table">
    <h3 class="mp-trend-table__title">${escapeHtml(titleText)}</h3>
    <div class="mp-trend-table__wrap">
      <table>
        <thead><tr>
          <th>${escapeHtml(t('panel.metric'))}</th>
          <th>${escapeHtml(homeName || t('panel.home'))}</th>
          <th>${escapeHtml(awayName || t('panel.awayShort'))}</th>
          <th>${escapeHtml(t('panel.match'))}</th>
        </tr></thead>
        <tbody>${avgRowHtml}${metricRows}</tbody>
      </table>
    </div>
  </section>`;
}

/**
 * Premium market tab: Oddster-style summary + Over table + optional Under table.
 * Data from expected + ladderRows / underRows — no new API fields.
 */
function marketTrendUnlockedHtml({
  title,
  totalLabel,
  homeName,
  awayName,
  homeCrest,
  awayCrest,
  expected,
  ladderRows,
  underRows = null,
  beforeTablesHtml = '',
  footerNote = '',
}) {
  const homeExp = expected?.home != null ? Number(expected.home) : null;
  const awayExp = expected?.away != null ? Number(expected.away) : null;
  const matchExp =
    expected?.match != null
      ? Number(expected.match)
      : homeExp != null && awayExp != null
        ? Number((homeExp + awayExp).toFixed(2))
        : null;
  const h = Number.isFinite(homeExp) ? homeExp : 0;
  const a = Number.isFinite(awayExp) ? awayExp : 0;
  const sum = h + a;
  const homeShare = sum > 0 ? (h / sum) * 100 : 50;
  const awayShare = 100 - homeShare;
  let diffHtml = '';
  if (sum > 0 && Math.abs(h - a) > 0.001) {
    const lead = h > a ? homeName || 'Local' : awayName || 'Visitante';
    const pct = Math.round((Math.abs(h - a) / sum) * 100);
    diffHtml = `<p class="mp-trend-summary__diff">Diferencia estimada: <strong>${escapeHtml(
      lead
    )} ${pct}%</strong></p>`;
  }
  const fmtExpAttr = (v) => {
    if (v == null || !Number.isFinite(Number(v))) {
      return `<span class="mp-trend-table__num">—</span>`;
    }
    const n = Number(v);
    return `<span class="mp-trend-table__num" data-count-to="${n}" data-count-decimals="1">0.0</span>`;
  };
  const fmtExpVal = (v, cls, tag = 'span') => {
    if (v == null || !Number.isFinite(Number(v))) {
      return `<${tag} class="${cls}">—</${tag}>`;
    }
    const n = Number(v);
    return `<${tag} class="${cls}" data-count-to="${n}" data-count-decimals="1">0.0</${tag}>`;
  };
  const summary = `<section class="mp-trend-summary">
    <p class="mp-trend-summary__eyebrow">${escapeHtml(totalLabel || 'Promedio estimado')}</p>
    ${fmtExpVal(matchExp, 'mp-trend-summary__total', 'p')}
    <div class="mp-trend-summary__teams">
      <div class="mp-trend-summary__side">
        ${crestHtml(homeName, homeCrest, 'sm')}
        <span class="mp-trend-summary__name">${escapeHtml(homeName || 'Local')}</span>
        ${fmtExpVal(homeExp, 'mp-trend-summary__val')}
      </div>
      <div class="mp-trend-summary__side mp-trend-summary__side--away">
        ${crestHtml(awayName, awayCrest, 'sm')}
        <span class="mp-trend-summary__name">${escapeHtml(awayName || 'Visitante')}</span>
        ${fmtExpVal(awayExp, 'mp-trend-summary__val')}
      </div>
    </div>
    <div class="mp-trend-summary__bar" aria-hidden="true">
      <span class="mp-trend-summary__bar-home" data-bar-to="${homeShare.toFixed(1)}" style="width:0%"></span>
      <span class="mp-trend-summary__bar-away" data-bar-to="${awayShare.toFixed(1)}" style="width:0%"></span>
    </div>
    ${diffHtml}
    ${footerNote ? `<p class="mp-trend-summary__note muted">${footerNote}</p>` : ''}
  </section>`;

  const avgRow = `<tr>
    <td class="mp-trend-table__metric">${escapeHtml(t('panel.average'))}</td>
    <td>${fmtExpAttr(homeExp)}</td>
    <td>${fmtExpAttr(awayExp)}</td>
    <td>${fmtExpAttr(matchExp)}</td>
  </tr>`;
  const overTable = mpTrendTableSection({
    titleText: t('panel.trendsOf', { title }),
    homeName,
    awayName,
    ladderRows,
    avgRowHtml: avgRow,
  });
  const underTable =
    Array.isArray(underRows) && underRows.length
      ? mpTrendTableSection({
          titleText: t('panel.underTrendsOf', { title }),
          homeName,
          awayName,
          ladderRows: underRows,
        })
      : '';
  return `${summary}${beforeTablesHtml || ''}${overTable}${underTable}`;
}

/** Goals-tab BTTS block: one clear Yes % + subtle No — not a 3-col H/A/Match grid. */
function bttsPanelHtml(pred, { leagueRate = null } = {}) {
  const yes = pred?.btts_yes_prob != null ? Number(pred.btts_yes_prob) : null;
  const no =
    pred?.btts_no_prob != null
      ? Number(pred.btts_no_prob)
      : yes != null && Number.isFinite(yes)
        ? 1 - yes
        : null;
  if (yes == null || !Number.isFinite(yes)) return '';
  const yesBar = Math.max(0, Math.min(100, Math.round(yes * 100)));
  const league =
    leagueRate != null && Number.isFinite(Number(leagueRate))
      ? `<span class="mp-btts__league muted">${escapeHtml(t('panel.leagueAvg'))} · ${(
          Number(leagueRate) * 100
        ).toFixed(0)}%</span>`
      : '';
  const noHtml =
    no != null && Number.isFinite(no)
      ? `<span class="mp-btts__no">${escapeHtml(t('panel.bttsNo'))} · <span data-target="${no}">0%</span></span>`
      : '';
  const meta =
    noHtml || league
      ? `<div class="mp-btts__meta">${noHtml}${noHtml && league ? `<span class="mp-btts__dot" aria-hidden="true"></span>` : ''}${league}</div>`
      : '';
  return `<section class="mp-btts" aria-label="${escapeHtml(t('panel.btts'))}">
    <div class="mp-btts__head">
      ${MP_STAT_ICONS.btts}
      <h3 class="mp-btts__title">${escapeHtml(t('panel.btts'))}</h3>
    </div>
    <div class="mp-btts__hero">
      <div class="mp-btts__yes">
        <span class="mp-btts__yes-label">${escapeHtml(t('panel.bttsYes'))}</span>
        <span class="mp-btts__pct" data-target="${yes}">0%</span>
      </div>
      <div class="mp-btts__track" aria-hidden="true">
        <span class="mp-btts__fill" data-bar-to="${yesBar}" style="width:0%"></span>
      </div>
    </div>
    ${meta}
  </section>`;
}

function premiumBannerHtml() {
  if (!authUser || contentUnlocked()) return '';
  return `<aside class="premium-banner" data-hb-censor role="button" tabindex="0" aria-label="Ver planes Premium">
    <span class="premium-banner__badge">OFERTA ESPECIAL</span>
    <div class="premium-banner__body">
      <div class="premium-banner__copy">
        <h3 class="premium-banner__title">Houdini Premium</h3>
        <p class="premium-banner__lead">Tip Houdini y estadísticas avanzadas del partido.</p>
        <ul class="premium-banner__list">
          <li>Tip del partido + 1X2</li>
          <li>Tablas Goles · Tiros · Córners · Tarjetas</li>
          <li>Top 10 y combinadas Semanal</li>
          <li>Probabilidades en vivo</li>
        </ul>
        <span class="premium-banner__cta">Ver planes</span>
      </div>
    </div>
  </aside>`;
}

function refreshTipsLockedViews() {
  try {
    if (typeof renderPartidosList === 'function' && cachedMatches?.length) {
      renderPartidosList();
    }
  } catch (_) {
    /* ignore */
  }
  if (typeof renderTop3 === 'function') {
    renderTop3().catch(() => {});
  }
  if (cachedWeeklyPayload && typeof renderWeeklyCombos === 'function') {
    try {
      renderWeeklyCombos(cachedWeeklyPayload);
    } catch (_) {
      /* ignore */
    }
  }
  if (
    selectedMatchId &&
    typeof openPrediction === 'function' &&
    (document.getElementById('panel')?.classList.contains('is-open') ||
      document.body.classList.contains('has-browse-selection'))
  ) {
    openPrediction(selectedMatchId).catch(() => {});
  }
}
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

/** Display names for allowlist leagues (AF api_id). */
const LEAGUE_ES_BY_API = {
  140: 'LaLiga',
  141: 'LaLiga Hypermotion',
  39: 'Premier League',
  135: 'Serie A',
  78: 'Bundesliga',
  61: 'Ligue 1',
  5: 'Liga de Naciones',
  2: 'Champions League',
  3: 'Europa League',
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

/** "15" → "1,5" (ES) / "1.5" (EN) ; "105" → "10,5" / "10.5" */
function lineFromSuffix(suffix) {
  const s = String(suffix || '');
  const sep = getUiLang() === 'en' ? '.' : ',';
  if (!/^\d+$/.test(s)) return s.replace(/[.,]/, sep);
  if (s.length === 1) return s;
  return `${s.slice(0, -1)}${sep}${s.slice(-1)}`;
}

function labelBetFallback(code, homeName, awayName) {
  const raw = String(code || '').toUpperCase();
  if (!raw) return '—';
  const home = String(homeName || '').trim();
  const away = String(awayName || '').trim();
  const en = getUiLang() === 'en';
  if (raw === 'HOME_WIN') return home ? t('bet.winNamed', { name: home }) : t('bet.winHome');
  if (raw === 'AWAY_WIN') return away ? t('bet.winNamed', { name: away }) : t('bet.winAway');
  if (raw === 'DRAW') return t('bet.DRAW');
  if (raw === 'BTTS_YES') return t('bet.BTTS_YES');
  if (raw === 'BTTS_NO') return t('bet.BTTS_NO');

  const m = raw.match(/^(HOME_|AWAY_|CORNERS_|CARDS_|SHOTS_|SOT_)?(OVER|UNDER)_(\d+)$/);
  if (!m) return code;
  const scope = m[1] || '';
  const side = m[2] === 'OVER' ? (en ? 'Over' : 'Más de') : en ? 'Under' : 'Menos de';
  const line = lineFromSuffix(m[3]);
  let unit = en ? 'goals' : 'goles';
  let who = '';
  if (scope === 'HOME_') who = home ? `${home} · ` : en ? 'Home · ' : 'Local · ';
  else if (scope === 'AWAY_') who = away ? `${away} · ` : en ? 'Away · ' : 'Visitante · ';
  else if (scope === 'CORNERS_') unit = en ? 'corners' : 'córners';
  else if (scope === 'CARDS_') unit = en ? 'cards' : 'amarillas';
  else if (scope === 'SHOTS_') unit = en ? 'shots' : 'tiros';
  else if (scope === 'SOT_') unit = en ? 'shots on target' : 'tiros a puerta';
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
  if (raw === 'HOME_WIN') return home ? t('bet.winNamed', { name: home }) : t('bet.HOME_WIN');
  if (raw === 'AWAY_WIN') return away ? t('bet.winNamed', { name: away }) : t('bet.AWAY_WIN');
  if (raw.startsWith('HOME_') && home) {
    return labelBetFallback(raw, home, away);
  }
  if (raw.startsWith('AWAY_') && away) {
    return labelBetFallback(raw, home, away);
  }
  const key = `bet.${raw}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return BET_LABELS[code] || labelBetFallback(code, home, away);
}

function labelFamily(family) {
  const key = `family.${family}`;
  const translated = t(key);
  if (translated !== key) return translated;
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
  'paris fc': 6379,
  elche: 10268,
  'elche cf': 10268,
  'rc deportivo': 9783,
  deportivo: 9783,
  'bayer leverkusen': 8178,
  'bayer 04 leverkusen': 8178,
  'bayer 04': 8178,
  leverkusen: 8178,
  'bayer leverkusen fc': 8178,
  'racing santander': 8696,
  'racing de santander': 8696,
  'real racing club': 8696,
  'real racing club de santander': 8696,
  'r. racing club': 8696,
  'r racing club': 8696,
  'racing club': 8696,
  racing: 8696,
  'bayern munich': 9823,
  'bayern munchen': 9823,
  'fc bayern munich': 9823,
  'fc bayern munchen': 9823,
  bayern: 9823,
  'borussia dortmund': 9789,
  dortmund: 9789,
  bvb: 9789,
  'rb leipzig': 178475,
  leipzig: 178475,
  'eintracht frankfurt': 9810,
  frankfurt: 9810,
  wolfsburg: 8721,
  'vfl wolfsburg': 8721,
  'borussia monchengladbach': 9788,
  monchengladbach: 9788,
  gladbach: 9788,
  hoffenheim: 8226,
  'tsg hoffenheim': 8226,
  freiburg: 8358,
  'sc freiburg': 8358,
  'sport-club freiburg': 8358,
  'sport club freiburg': 8358,
  mainz: 9905,
  'mainz 05': 9905,
  'fsv mainz 05': 9905,
  augsburg: 8406,
  'fc augsburg': 8406,
  stuttgart: 10269,
  'vfb stuttgart': 10269,
  'werder bremen': 8697,
  'sv werder bremen': 8697,
  bremen: 8697,
  'union berlin': 8149,
  '1. fc union berlin': 8149,
  '1 fc union berlin': 8149,
  heidenheim: 10030,
  '1. fc heidenheim': 10030,
  '1 fc heidenheim': 10030,
  'st pauli': 8152,
  'fc st. pauli': 8152,
  'fc st pauli': 8152,
  'holstein kiel': 9785,
  kiel: 9785,
  koln: 8722,
  '1. fc koln': 8722,
  '1 fc koln': 8722,
  'fc koln': 8722,
  cologne: 8722,
  paderborn: 8460,
  'sc paderborn': 8460,
  'sc paderborn 07': 8460,
  elversberg: 8232,
  'sv elversberg': 8232,
  schalke: 10189,
  'fc schalke 04': 10189,
  'schalke 04': 10189,
  'hamburger sv': 9790,
  hamburg: 9790,
  hsv: 9790,
};
const AF_BROKEN_CREST_IDS = new Set([1102, 85, 3751, 168, 159, 174, 1357, 1113]);

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
  const locale = getUiLocale();
  return d.toLocaleTimeString(locale, {
    timeZone: getUiTimeZone(),
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
    return 'FT';
  }
  return time ? `${time} · NS` : 'NS';
}

function mpVsMidLabel(m, live) {
  if (m.status !== 'live' && m.status !== 'finished') {
    return { text: 'VS', score: false };
  }
  const hg = live?.homeGoals ?? m.homeGoals;
  const ag = live?.awayGoals ?? m.awayGoals;
  if (hg != null && ag != null) {
    return { text: `${Number(hg)}-${Number(ag)}`, score: true };
  }
  return { text: 'VS', score: false };
}

function mpVsMidHtml(m, live) {
  const mid = mpVsMidLabel(m, live);
  const labelCls = mid.score ? ' mp-vs__label--score' : '';
  return `<div class="mp-vs">
    <span class="mp-vs__label${labelCls}">${escapeHtml(mid.text)}</span>
    <span class="mp-status">${escapeHtml(matchStatusPill(m))}</span>
  </div>`;
}

function refreshMpVsMid(root, m, live) {
  const vs = root.querySelector('.mp-vs');
  if (!vs) return;
  const mid = mpVsMidLabel(m, live);
  const label = vs.querySelector('.mp-vs__label');
  const status = vs.querySelector('.mp-status');
  if (label) {
    label.textContent = mid.text;
    label.classList.toggle('mp-vs__label--score', mid.score);
  }
  if (status) status.textContent = matchStatusPill(m);
}

function refreshMpLiveEvents(root, events, m) {
  const teams = root.querySelector('.mp-teams');
  if (!teams) return;
  const show =
    m && (m.status === 'live' || m.status === 'finished') && Array.isArray(events) && events.length;
  const html = show ? matchEventsHtml(events, { split: true }) : '';
  if (!html) {
    teams.classList.remove('mp-teams--events');
    teams.querySelectorAll('.mp-live-events__col, .mp-live-events__mid').forEach((el) => el.remove());
    return;
  }
  teams.classList.add('mp-teams--events');
  let homeCol = teams.querySelector('.mp-live-events__col--home');
  let awayCol = teams.querySelector('.mp-live-events__col--away');
  if (!homeCol || !awayCol) {
    teams.querySelectorAll('.mp-live-events__col, .mp-live-events__mid').forEach((el) => el.remove());
    teams.insertAdjacentHTML('beforeend', html);
    return;
  }
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const newHome = tmp.querySelector('.mp-live-events__col--home');
  const newAway = tmp.querySelector('.mp-live-events__col--away');
  if (newHome) homeCol.innerHTML = newHome.innerHTML;
  if (newAway) awayCol.innerHTML = newAway.innerHTML;
  const mid = teams.querySelector('.mp-live-events__mid');
  if (mid && !mid.innerHTML) mid.innerHTML = '';
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
    const home = focus.filter((e) => e.isHome === true);
    const away = focus.filter((e) => e.isHome === false);
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
  return hbCensorWrap(
    `<span class="live-tip ${meta.cls}">${escapeHtml(meta.label)}${escapeHtml(prob)}</span>`
  );
}

function liveProbsRow(live) {
  if (!live) return '';
  const h = Math.round(Number(live.homeWin || 0) * 100);
  const d = Math.round(Number(live.draw || 0) * 100);
  const a = Math.round(Number(live.awayWin || 0) * 100);
  return hbCensorWrap(`<span class="live-probs" aria-label="Probabilidades en vivo: local ${h}%, empate ${d}%, visitante ${a}%">
    <span class="live-probs__p live-probs__p--home">${h}%</span>
    <span class="live-probs__p live-probs__p--draw">${d}%</span>
    <span class="live-probs__p live-probs__p--away">${a}%</span>
  </span>`);
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
      ${hbCensorWrap(
        `<div class="mp-live__bar" role="img" aria-label="Probabilidades en vivo: local ${h}%, empate ${d}%, visitante ${a}%">
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
      </div>`,
        { block: true }
      )}
      ${
        live.tip
          ? hbCensorWrap(
              `<div class="mp-live__tip">
              <span class="mp-live__tip-key">Tip · ${escapeHtml(
                labelBet(live.tip.label, homeName, awayName)
              )}</span>
              <span class="live-tip ${(LIVE_TIP_META[live.tip.status] || LIVE_TIP_META.unknown).cls}">${escapeHtml(
                (LIVE_TIP_META[live.tip.status] || LIVE_TIP_META.unknown).label
              )}${
                live.tip.prob != null
                  ? ` · ${Math.round(Number(live.tip.prob) * 100)}%`
                  : ''
              }</span>
            </div>`,
              { block: true }
            )
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
      <span class="league-match__live"><span class="league-match__live-dot"></span>${escapeHtml(t('chip.live'))}</span>
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

const MP_STAT_ICONS = {
  /* O2.5: portería + dos balones (más denso) */
  o25: `<svg class="mp-stat__icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M5 19V8h14v11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9.2" cy="13.2" r="2.35" fill="none" stroke="currentColor" stroke-width="1.35"/><circle cx="14.8" cy="13.2" r="2.35" fill="none" stroke="currentColor" stroke-width="1.35"/></svg>`,
  /* O1.5: misma portería + un balón (más simple) */
  o15: `<svg class="mp-stat__icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M5 19V8h14v11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="13.4" r="2.6" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
  /* BTTS: dos balones pequeños (ambos equipos) */
  btts: `<svg class="mp-stat__icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="8.2" cy="12" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="15.8" cy="12" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
  /* Goles: balón simple */
  goals: `<svg class="mp-stat__icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
  /* Córners: banderín de córner */
  corners: `<svg class="mp-stat__icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M7 21V4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M7 4.2l11 3.4-11 3.4V4.2z" fill="currentColor" opacity=".88"/><path d="M4 21h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  /* Tarjetas: amarilla + roja superpuestas */
  cards: `<svg class="mp-stat__icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><rect x="5.5" y="4.5" width="8.5" height="13.5" rx="1.2" fill="#eab308" stroke="currentColor" stroke-width="1.15" transform="rotate(-12 9.75 11.25)"/><rect x="10" y="5.5" width="8.5" height="13.5" rx="1.2" fill="#ef4444" stroke="currentColor" stroke-width="1.15" transform="rotate(10 14.25 12.25)"/></svg>`,
};

function keyStatCard({ title, valueHtml, barPct, tone = 'accent', sub = '', iconHtml = '' }) {
  const width = Math.max(0, Math.min(100, Math.round(Number(barPct) || 0)));
  return `
    <article class="mp-stat">
      <div class="mp-stat__head">
        <span class="mp-stat__title">${escapeHtml(title)}</span>
        ${iconHtml || ''}
      </div>
      <div class="mp-stat__value">${valueHtml}</div>
      <div class="mp-stat__track" aria-hidden="true">
        <span class="mp-stat__fill mp-stat__fill--${tone}" data-bar-to="${width}" style="width:0%"></span>
      </div>
      ${sub ? `<div class="mp-stat__sub">${sub}</div>` : ''}
    </article>`;
}

/** General «Probabilidades clave» cards — visible for free (no Premium censor). */
function pctStatCard(title, prob, leagueRate = null, iconHtml = '') {
  const p = pct(prob);
  const rate =
    leagueRate != null && Number.isFinite(Number(leagueRate)) ? Number(leagueRate) : null;
  const sub =
    rate != null
      ? `<span class="muted">${escapeHtml(t('panel.leagueAvg'))} ${Math.round(rate * 100)}%</span>`
      : `<span class="muted">${escapeHtml(t('panel.leagueAvg'))} —</span>`;
  if (p == null) {
    return keyStatCard({
      title,
      valueHtml: `<span class="mp-stat__num">—</span>`,
      barPct: 0,
      tone: 'muted',
      sub,
      iconHtml,
    });
  }
  const n = Math.round(p * 100);
  return keyStatCard({
    title,
    valueHtml: `<span class="mp-stat__num" data-count-to="${n}" data-count-suffix="%">0%</span>`,
    barPct: n,
    tone: n >= 60 ? 'accent' : n >= 45 ? 'warn' : 'muted',
    sub,
    iconHtml,
  });
}

function avgStatCard(title, value, scale, leagueAvg = null, iconHtml = '') {
  const sub =
    leagueAvg != null && Number.isFinite(Number(leagueAvg))
      ? `<span class="muted">${escapeHtml(t('panel.leagueAvg'))} ${Number(leagueAvg).toFixed(1)}</span>`
      : `<span class="muted">${escapeHtml(t('panel.leagueAvg'))} —</span>`;
  if (value == null || Number.isNaN(Number(value))) {
    return keyStatCard({
      title,
      valueHtml: `<span class="mp-stat__num">—</span>`,
      barPct: 0,
      tone: 'muted',
      sub,
      iconHtml,
    });
  }
  const n = Number(value);
  const ref = leagueAvg != null && Number(leagueAvg) > 0 ? Number(leagueAvg) : scale;
  const bar = ref > 0 ? (n / ref) * 100 : 0;
  const ratio = ref > 0 ? n / ref : 1;
  let tone = 'warn';
  if (ratio >= 0.9 && ratio <= 1.1) tone = 'accent';
  else if (ratio < 0.9) tone = 'muted';
  else tone = 'accent';
  return keyStatCard({
    title,
    valueHtml: `<span class="mp-stat__num">${n.toFixed(2)}</span>`,
    barPct: bar,
    tone,
    sub,
    iconHtml,
  });
}

function expectedCardHtml({ title, homeName, awayName, homeLogo, awayLogo, homeExp, awayExp, matchExp }) {
  if (homeExp == null && awayExp == null && matchExp == null) return '';
  const pill = (v) => {
    if (v == null) return '<span class="ladder-pill ladder-pill--muted">—</span>';
    return `<span class="ladder-pill ladder-pill--hi">${Number(v).toFixed(1)}</span>`;
  };
  return hbCensorWrap(
    `
    <div class="ladder-expected">
      <div class="ladder-expected__eyebrow">${escapeHtml(t('panel.expected'))}</div>
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
    </div>`,
    { block: true }
  );
}

/** Over-prob for a ladder line, or null. */
function ladderLineProb(side, line) {
  const map = ladderProbsMap(side);
  const v = map.get(Number(line));
  return v == null ? null : v;
}

/** Poisson P(K=k | λ) — mirror Worker matchModel.poissonP. */
function poissonP(k, lambda) {
  const lam = Number(lambda);
  const kk = Number(k);
  if (!Number.isFinite(lam) || !Number.isFinite(kk) || kk < 0) return 0;
  if (lam <= 0) return kk === 0 ? 1 : 0;
  let fact = 1;
  for (let i = 2; i <= kk; i += 1) fact *= i;
  return (Math.exp(-lam) * lam ** kk) / fact;
}

/** P(X > L) = 1 − Σ P(0..⌊L⌋) — mirror Worker poissonOverLadder. */
function poissonOver(lambda, line) {
  if (lambda == null || line == null || line === '') return null;
  const lam = Number(lambda);
  const L = Number(line);
  if (!Number.isFinite(lam) || lam < 0 || !Number.isFinite(L)) return null;
  const maxK = Math.floor(L);
  let under = 0;
  for (let k = 0; k <= maxK; k += 1) under += poissonP(k, lam);
  return Math.max(0, Math.min(1, 1 - under));
}

/** Prefer ladder over-prob; fallback Poisson CDF from λ. */
function ladderOrPoisson(sideLadder, lambda, line) {
  const fromLadder = ladderLineProb(sideLadder, line);
  if (fromLadder != null) return fromLadder;
  return poissonOver(lambda, line);
}

/**
 * One row per line L: Home/Away/Match = P(Over L) or P(Under L)=1−over.
 * Drops rows where all three columns are null. Overs decrease with L; Unders increase.
 */
function buildOuRows(lines, opts = {}) {
  const {
    homeLadder = null,
    awayLadder = null,
    matchLadder = null,
    lambdaHome = null,
    lambdaAway = null,
    lambdaMatch = null,
    side = 'over',
  } = opts;
  const labelKey = side === 'under' ? 'panel.underLine' : 'panel.overLine';
  const invert = side === 'under';
  const rows = [];
  (Array.isArray(lines) ? lines : []).forEach((line) => {
    const L = Number(line);
    if (!Number.isFinite(L)) return;
    let home = ladderOrPoisson(homeLadder, lambdaHome, L);
    let away = ladderOrPoisson(awayLadder, lambdaAway, L);
    let match = ladderOrPoisson(matchLadder, lambdaMatch, L);
    if (invert) {
      home = home == null ? null : Math.max(0, Math.min(1, 1 - home));
      away = away == null ? null : Math.max(0, Math.min(1, 1 - away));
      match = match == null ? null : Math.max(0, Math.min(1, 1 - match));
    }
    if (home == null && away == null && match == null) return;
    rows.push({
      label: t(labelKey, { n: marketLineLabel(L) }),
      home,
      away,
      match,
    });
  });
  return rows;
}

function buildOverRows(lines, opts = {}) {
  return buildOuRows(lines, { ...opts, side: 'over' });
}

function buildUnderRows(lines, opts = {}) {
  return buildOuRows(lines, { ...opts, side: 'under' });
}

/** Goals Over 0.5–3.5 from flat prediction fields (same L H/A/Match). BTTS is separate. */
function goalsTrendRows(p) {
  const pred = p || {};
  const over = (n) => t('panel.overLine', { n });
  const rows = [
    {
      label: over('0,5'),
      home: pred.home_over05_prob,
      away: pred.away_over05_prob,
      match: pred.over05_prob,
    },
    {
      label: over('1,5'),
      home: pred.home_over15_prob,
      away: pred.away_over15_prob,
      match: pred.over15_prob,
    },
    {
      label: over('2,5'),
      home: pred.home_over25_prob,
      away: pred.away_over25_prob,
      match: pred.over25_prob,
    },
    {
      label: over('3,5'),
      home: pred.home_over35_prob,
      away: pred.away_over35_prob,
      match: pred.over35_prob,
    },
  ];
  return rows.filter((r) => r.home != null || r.away != null || r.match != null);
}

/** Goals Under 0.5–3.5 — explicit under_* fields, else 1−over. */
function goalsTrendUnderRows(p) {
  const pred = p || {};
  const under = (n) => t('panel.underLine', { n });
  const fallback = (u, o) =>
    u != null && Number.isFinite(Number(u))
      ? Number(u)
      : o != null && Number.isFinite(Number(o))
        ? Math.max(0, Math.min(1, 1 - Number(o)))
        : null;
  const rows = [
    {
      label: under('0,5'),
      home: fallback(pred.home_under05_prob, pred.home_over05_prob),
      away: fallback(pred.away_under05_prob, pred.away_over05_prob),
      match: fallback(pred.under05_prob, pred.over05_prob),
    },
    {
      label: under('1,5'),
      home: fallback(pred.home_under15_prob, pred.home_over15_prob),
      away: fallback(pred.away_under15_prob, pred.away_over15_prob),
      match: fallback(pred.under15_prob, pred.over15_prob),
    },
    {
      label: under('2,5'),
      home: fallback(pred.home_under25_prob, pred.home_over25_prob),
      away: fallback(pred.away_under25_prob, pred.away_over25_prob),
      match: fallback(pred.under25_prob, pred.over25_prob),
    },
    {
      label: under('3,5'),
      home: fallback(pred.home_under35_prob, pred.home_over35_prob),
      away: fallback(pred.away_under35_prob, pred.away_over35_prob),
      match: fallback(pred.under35_prob, pred.over35_prob),
    },
  ];
  return rows.filter((r) => r.home != null || r.away != null || r.match != null);
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
  if (Number.isInteger(n)) return String(n);
  const raw = n.toFixed(1);
  return getUiLang() === 'en' ? raw : raw.replace('.', ',');
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
  return hbCensorWrap(
    `
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
    </section>`,
    { block: true }
  );
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
  })}${averages}`;
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
            ).toFixed(1)}%"><span data-target="${p}">0%</span></div>`;
          })
          .join('')}</div>`
    )
    .join('');
  const list = (topScores || [])
    .slice(0, 4)
    .map(
      (s) =>
        `<span class="mp-score__chip"><strong>${s.home}-${s.away}</strong> <span data-target="${Number(
          s.prob
        )}" data-target-decimals="1">0.0%</span></span>`
    )
    .join('');
  return hbCensorWrap(
    `
    <section class="mp-score">
      <div class="mp-score__title">Marcadores exactos</div>
      <div class="mp-score__grid" role="img" aria-label="Probabilidad de cada marcador exacto, del 0 al ${grid.length - 1} goles por equipo">
        ${cells}
      </div>
      <div class="mp-score__top">${list}</div>
      ${
        top
          ? `<p class="mp-score__caption">Más probable: <strong>${top.home}-${top.away}</strong> (<span data-target="${Number(
              top.prob
            )}" data-target-decimals="1">0.0%</span>)</p>`
          : ''
      }
      <p class="mp-score__axis muted">Filas: ${escapeHtml(homeName || 'local')} · Columnas: ${escapeHtml(
        awayName || 'visitante'
      )}</p>
    </section>`,
    { block: true }
  );
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
        <span class="mp-h2h__league muted">${escapeHtml(leagueLabelEs(r.leagueName || ''))}</span>
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
  return hbCensorWrap(
    `
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
    </section>`,
    { block: true }
  );
}

function mpTeamCol(name, logo, side, form) {
  const label = side === 'home' ? 'Local' : 'Visitante';
  return `
    <div class="mp-team mp-team--${side}">
      ${crestHtml(name, logo, 'lg')}
      <div class="mp-team__name">${escapeHtml(name || '—')}</div>
      <div class="mp-team__side">${label}</div>
      <div class="mp-team__form">${formHtml(form, side)}</div>
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
  return hbCensorWrap(`
    <div class="prob-row">
      <div class="prob-row__label">${escapeHtml(label)}</div>
      <div class="prob-row__track" aria-hidden="true"><span class="prob-row__fill" data-bar-to="${width}" style="width:0%"></span></div>
      <div class="prob-row__pct" data-count-to="${n}" data-count-suffix="%">0%</div>
    </div>`);
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

/**
 * Count-up % from data-target (0–1 fraction) → "67%" / "12.3%".
 * Skips free blur (.hb-censor): snap to final. Once per reveal / tab switch.
 */
function animatePercents(root) {
  if (!root) return;
  const reduce = prefersReducedMotion();
  const dur = 560;
  root.querySelectorAll('[data-target]').forEach((el) => {
    const target = Number(el.dataset.target);
    if (!Number.isFinite(target)) return;
    const decimals = Math.max(0, Number(el.dataset.targetDecimals) || 0);
    const fmt = (v) => `${(v * 100).toFixed(decimals)}%`;
    // Free censored veil: no count-up (blur would look jittery).
    if (reduce || el.closest('.hb-censor')) {
      el.textContent = fmt(target);
      return;
    }
    const gen = String((Number(el.dataset.pctAnimGen) || 0) + 1);
    el.dataset.pctAnimGen = gen;
    el.textContent = fmt(0);
    const start = performance.now();
    const step = (now) => {
      if (el.dataset.pctAnimGen !== gen) return;
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(target * eased);
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = fmt(target);
    };
    requestAnimationFrame(step);
  });
}

function animateCountUps(root) {
  if (!root) return;
  const reduce = prefersReducedMotion();
  root.querySelectorAll('[data-count-to]').forEach((el) => {
    const to = Number(el.dataset.countTo);
    const suffix = el.dataset.countSuffix ?? '';
    const decimals = Math.max(0, Number(el.dataset.countDecimals) || 0);
    if (!Number.isFinite(to)) return;
    const fmt = (v) =>
      decimals > 0 ? `${v.toFixed(decimals)}${suffix}` : `${Math.round(v)}${suffix}`;
    if (reduce || el.closest('.hb-censor')) {
      el.textContent = fmt(to);
      return;
    }
    el.textContent = fmt(0);
    const dur = 560;
    const start = performance.now();
    const from = 0;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = fmt(to);
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
        el.style.transition = 'width 0.56s cubic-bezier(0.22, 1, 0.36, 1)';
        el.style.width = `${to}%`;
      });
    });
  });
  root.querySelectorAll('[data-flex-to]').forEach((el) => {
    const to = Number(el.dataset.flexTo);
    if (!Number.isFinite(to)) return;
    el.style.flex = String(Math.max(to, 1));
  });
  animatePercents(root);
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
  if (!value) return t('date.unavailable');
  const d = parseMatchDate(value);
  if (!d) return String(value);
  const locale = getUiLocale();
  const opts = { timeZone: getUiTimeZone() };
  const weekday = d.toLocaleDateString(locale, { ...opts, weekday: 'short' });
  const datePart = d.toLocaleDateString(locale, {
    ...opts,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const timePart = d.toLocaleTimeString(locale, {
    ...opts,
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${weekday} ${datePart} · ${timePart}`;
}

function formBadge(raw) {
  const en = getUiLang() === 'en';
  const map = {
    W: { letter: en ? 'W' : 'V', cls: 'V', title: t('form.win') },
    D: { letter: en ? 'D' : 'E', cls: 'E', title: t('form.draw') },
    L: { letter: en ? 'L' : 'D', cls: 'D', title: t('form.loss') },
    V: { letter: en ? 'W' : 'V', cls: 'V', title: t('form.win') },
    E: { letter: en ? 'D' : 'E', cls: 'E', title: t('form.draw') },
  };
  return map[raw] || { letter: raw || '—', cls: raw || 'E', title: raw || '—' };
}

/** Last 7 results; newest toward VS (home: reverse DOM; away: newest-first). */
function formHtml(form, side = 'home') {
  if (!form || !form.length) {
    return `<span class="muted">${escapeHtml(t('ligas.noTable'))}</span>`;
  }
  // API form is newest-first; cap at 7 for the panel strip.
  const newestFirst = form.slice(0, 7);
  const ordered = side === 'away' ? newestFirst : [...newestFirst].reverse();
  return ordered
    .map((f) => {
      const raw = String(f || '').toUpperCase();
      const mapped = formBadge(raw);
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
  if (!c) return '—';
  if (getUiLang() === 'en') return c;
  return COUNTRY_ES[c] || c;
}

function leagueLabelEs(nameOrMatch, apiId = null) {
  const aid =
    apiId != null
      ? Number(apiId)
      : Number(
          nameOrMatch?.leagueApiId ??
            nameOrMatch?.apiId ??
            nameOrMatch?.league_api_id ??
            nameOrMatch?.api_id
        );
  if (Number.isFinite(aid) && LEAGUE_ES_BY_API[aid]) {
    if (aid === 5) return t('league.nations');
    return LEAGUE_ES_BY_API[aid];
  }
  const raw =
    typeof nameOrMatch === 'string'
      ? nameOrMatch
      : nameOrMatch?.leagueName || nameOrMatch?.league || nameOrMatch?.league_name || '';
  const n = String(raw || '').trim();
  if (!n) return t('league.generic');
  if (/champions/i.test(n)) return 'Champions League';
  if (/europa\s*league/i.test(n)) return 'Europa League';
  if (/nations\s*league|liga de naciones/i.test(n)) return t('league.nations');
  if (/premier/i.test(n)) return 'Premier League';
  if (/serie\s*a/i.test(n)) return 'Serie A';
  if (/bundesliga/i.test(n)) return 'Bundesliga';
  if (/ligue\s*1/i.test(n)) return 'Ligue 1';
  if (/hypermotion|laliga\s*2|segunda/i.test(n)) return 'LaLiga Hypermotion';
  if (/la\s*liga|laliga/i.test(n)) return 'LaLiga';
  return shortLeagueName(n);
}

function formatLeagueLine(country, name, apiId = null) {
  const c = countryLabel(country);
  const l = leagueLabelEs(name, apiId);
  return [c !== '—' ? c : '', l].filter(Boolean).join(' · ') || t('league.generic');
}

function collectLeagues(matches) {
  const list = matches || [];
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
      name: leagueLabelEs(m),
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

function isLigasDesktopSplit() {
  return window.matchMedia('(min-width: 900px)').matches;
}

function mountLigasDetailHost() {
  const detail = document.getElementById('ligas-detail');
  if (!detail) return;
  const desktopHost = document.getElementById('ligasBrowsePanel');
  const mobileBody = document.getElementById('ligas-panel-body');
  if (isLigasDesktopSplit()) {
    if (desktopHost && detail.parentElement !== desktopHost) desktopHost.appendChild(detail);
  } else if (mobileBody && detail.parentElement !== mobileBody) {
    mobileBody.appendChild(detail);
  }
}

function openLigasMobileOverlay() {
  const overlay = document.getElementById('ligas-panel');
  const backdrop = document.getElementById('ligas-panel-backdrop');
  const title = document.getElementById('ligas-panel-title');
  const nameEl = document.getElementById('ligas-detail-name');
  if (title && nameEl) title.textContent = nameEl.textContent || 'Liga';
  mountLigasDetailHost();
  overlay?.classList.add('is-open');
  overlay?.setAttribute('aria-hidden', 'false');
  backdrop?.classList.add('is-open');
  backdrop?.setAttribute('aria-hidden', 'false');
  document.body.classList.add('panel-open');
}

function closeLigasMobileOverlay() {
  const overlay = document.getElementById('ligas-panel');
  const backdrop = document.getElementById('ligas-panel-backdrop');
  overlay?.classList.remove('is-open');
  overlay?.setAttribute('aria-hidden', 'true');
  backdrop?.classList.remove('is-open');
  backdrop?.setAttribute('aria-hidden', 'true');
  if (!document.getElementById('panel')?.classList.contains('is-open')) {
    document.body.classList.remove('panel-open');
  }
  const detail = document.getElementById('ligas-detail');
  const desktopHost = document.getElementById('ligasBrowsePanel');
  if (detail && desktopHost && detail.parentElement !== desktopHost) {
    desktopHost.appendChild(detail);
  }
}

function setLigasSelectionVisible(hasSelection) {
  const on = !!hasSelection;
  document.body.classList.toggle('has-ligas-selection', on);
  const panel = document.getElementById('ligasBrowsePanel');
  if (panel) panel.classList.toggle('ligas-browse-panel--detail', on);
  const empty = document.getElementById('ligas-panel-empty');
  const detail = document.getElementById('ligas-detail');
  if (empty) empty.hidden = on;
  if (detail) detail.hidden = !on;
  if (on) {
    if (isLigasDesktopSplit()) {
      closeLigasMobileOverlay();
      mountLigasDetailHost();
    } else {
      openLigasMobileOverlay();
    }
  } else {
    closeLigasMobileOverlay();
  }
}

function ligasStandingsHtml(table) {
  const rows = table || [];
  if (!rows.length) {
    return `<p class="ligas-standings__empty">${escapeHtml(t('ligas.noTable'))}</p>`;
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
        showBanner(t('toast.nextMatchSearch'), 'info');
        const insight = await api(`/api/v1/teams/${teamId}`);
        const nextId = Number(insight?.nextMatch?.id);
        if (!Number.isFinite(nextId) || nextId <= 0) {
          showBanner(t('toast.noNextMatch'), 'info');
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
    if (location.hash !== want) {
      /* push so browser back slides back to the list */
      history.pushState(null, '', want);
    }
  }

  const folderLeague = LIGAS_FOLDERS.flatMap((f) => f.leagues).find((l) => l.apiId === aid);
  if (nameEl) nameEl.textContent = folderLeague?.name || leagueLabelEs('', aid) || `Liga ${aid}`;
  if (metaEl) metaEl.textContent = 'Cargando clasificación…';
  tableEl.innerHTML = Array.from({ length: 6 }, () => `<div class="skeleton" aria-hidden="true"></div>`).join('');

  try {
    const catalog = await ensureLigasCatalog();
    const known = catalog.get(aid);
    if (!known) {
      ligasActiveD1Id = null;
      if (metaEl) metaEl.textContent = 'No disponible en datos';
      tableEl.innerHTML = `<p class="ligas-standings__empty">${escapeHtml(t('ligas.noTable'))}</p>`;
      return;
    }
    ligasActiveD1Id = known.id;
    const data = await api(`/api/v1/leagues/${aid}/table`);
    const league = data.league || known;
    ligasActiveD1Id = Number(league.id) || known.id;
    if (nameEl) {
      nameEl.textContent =
        leagueLabelEs(league.name || folderLeague?.name || '', aid) || `Liga ${aid}`;
    }
    if (metaEl) {
      const bits = [countryLabel(league.country), folderLeague?.tag].filter(Boolean);
      metaEl.textContent = bits.length ? bits.join(' · ') : 'Clasificación';
    }
    tableEl.innerHTML = ligasStandingsHtml(data.table || []);
    bindLigasStandingsRows(tableEl);
  } catch (err) {
    if (metaEl) metaEl.textContent = '';
    tableEl.innerHTML = `<p class="ligas-standings__error">${escapeHtml(
      err.message || 'Error al cargar la tabla'
    )}</p>`;
  } finally {
    const title = document.getElementById('ligas-panel-title');
    const nameEl = document.getElementById('ligas-detail-name');
    if (title && nameEl) title.textContent = nameEl.textContent || 'Liga';
    const panel = document.getElementById('ligasBrowsePanel');
    if (panel) panel.scrollTop = 0;
    const overlayBody = document.getElementById('ligas-panel-body');
    if (overlayBody) overlayBody.scrollTop = 0;
    if (isLigasDesktopSplit()) {
      const view = document.getElementById('ligas');
      if (view && typeof view.scrollIntoView === 'function') {
        view.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
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
    listEl.innerHTML = `<p class="ligas-standings__empty">${escapeHtml(t('ligas.noLeagues'))}</p>`;
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

  // Scope chips removed — league category sidebar only when a single-liga filter is active.
  const showCats = leagueFilterIds.size > 0;
  block.hidden = !showCats;
  if (!showCats) {
    cats.innerHTML = '';
    return;
  }

  const leagues = collectLeagues(matches);
  pruneLeagueSelection(leagues);

  const nSel = selectedLeagueCount();
  if (label) {
    label.textContent = nSel ? `Ligas · ${nSel} seleccionada${nSel === 1 ? '' : 's'}` : 'Ligas · todas';
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
          <span class="league-cat__name">Todas las ligas</span>
          <span class="league-cat__meta">${escapeHtml(
            t(totalMatches === 1 ? 'ligas.matchCount' : 'ligas.matchCountPlural', { n: totalMatches })
          )}</span>
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
          <span class="league-cat__name">${escapeHtml(l.name)}</span>
          <span class="league-cat__meta">${escapeHtml(countryLabel(l.country))} · ${escapeHtml(
            t(l.count === 1 ? 'ligas.matchCount' : 'ligas.matchCountPlural', { n: l.count })
          )}</span>
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

const toastQueue = [];
let toastTimer = null;

function clearToasts() {
  const host = document.getElementById('hb-toast');
  if (host) host.innerHTML = '';
  toastQueue.length = 0;
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  const legacy = document.getElementById('global-banner');
  if (legacy) {
    legacy.className = 'banner hidden';
    legacy.textContent = '';
    legacy.hidden = true;
  }
}

function renderToastQueue() {
  const host = document.getElementById('hb-toast');
  if (!host) return;
  host.innerHTML = toastQueue
    .map(
      (item) =>
        `<div class="hb-toast__item hb-toast__item--${escapeHtml(item.kind)}" role="status">${escapeHtml(
          item.message
        )}</div>`
    )
    .join('');
}

function scheduleToastDismiss() {
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastQueue.shift();
    renderToastQueue();
    toastTimer = null;
    if (toastQueue.length) scheduleToastDismiss();
  }, 3000);
}

/** Ephemeral bottom toast (3s). Empty message clears the queue. */
function showBanner(message, kind = 'info') {
  if (!message) {
    clearToasts();
    return;
  }
  const k = kind === 'error' || kind === 'ok' ? kind : 'info';
  toastQueue.push({ message: String(message), kind: k });
  while (toastQueue.length > 2) toastQueue.shift();
  renderToastQueue();
  scheduleToastDismiss();
}

const showToast = showBanner;

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
  premiumStartedAt: null,
  plan: 'free',
  premiumDaysLeft: null,
  stripeConfigured: false,
  pendingPromoPercent: null,
  pendingPromoCode: null,
};

const PREMIUM_LIST_PRICES = { weekly: 9.99, monthly: 19.9 };

function formatEuroPrice(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${v.toFixed(2).replace('.', ',')} €`;
}

function discountedListPrice(base, percent) {
  const pct = Number(percent);
  if (!Number.isFinite(pct) || pct <= 0) return null;
  return Math.round(base * (100 - pct)) / 100;
}

async function loadPremiumState() {
  try {
    const data = await api(`/api/v1/premium/status`);
    premiumState.premium = Boolean(data.premium);
    premiumState.premiumUntil = data.premiumUntil || null;
    premiumState.premiumStartedAt = data.premiumStartedAt || null;
    premiumState.plan = data.plan || (premiumState.premium ? 'premium' : 'free');
    premiumState.premiumDaysLeft =
      data.premiumDaysLeft != null ? Number(data.premiumDaysLeft) : null;
    premiumState.stripeConfigured = Boolean(data.stripeConfigured);
    premiumState.pendingPromoPercent =
      data.pendingPromoPercent != null ? Number(data.pendingPromoPercent) : null;
    premiumState.pendingPromoCode = data.pendingPromoCode || null;
  } catch (_) {
    premiumState.stripeConfigured = false;
    premiumState.pendingPromoPercent = null;
    premiumState.pendingPromoCode = null;
  }
  premiumState.loaded = true;
  syncPremiumView();
  syncPerfilView();
  return premiumState;
}

async function startPremiumCheckout() {
  if (!premiumState.loaded) await loadPremiumState();
  if (!premiumState.stripeConfigured) {
    showBanner(t('toast.payUnconfigured'), 'info');
    return;
  }
  try {
    const data = await api(`/api/v1/premium/session`, { method: 'POST' });
    if (data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
    } else {
      showBanner(t('toast.payOpenFail'), 'error');
    }
  } catch (err) {
    showBanner(t('toast.payStartFail', { msg: err.message || '' }), 'error');
  }
}

function premiumUpsellHtml(source) {
  if (contentUnlocked()) return '';
  return `
    <div class="premium-upsell" data-premium-source="${escapeHtml(source)}">
      <span class="premium-upsell__lock" aria-hidden="true">🔒</span>
      <div class="premium-upsell__text">
        <strong>Premium</strong>
        <span>Tips, ROI y estadísticas avanzadas van con el plan de pago.</span>
      </div>
      <button type="button" class="btn premium-upsell__btn" data-go-premium>Ver planes</button>
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
  if (ret === 'ok') showBanner(t('toast.payOk'), 'info');
  else showBanner(t('toast.payCancel'), 'info');
  sp.delete('premium');
  const rest = sp.toString();
  window.history.replaceState({}, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
}

function syncPremiumView() {
  const root = document.getElementById('premium');
  if (!root) return;
  const status = root.querySelector('[data-premium-status]');
  if (status) {
    if (contentUnlocked()) {
      status.textContent = premiumState.premiumUntil
        ? t('premium.statusUntil', { date: String(premiumState.premiumUntil).slice(0, 10) })
        : t('premium.statusOn');
    } else {
      status.textContent = t('premium.statusFree');
    }
  }
  const pct = Number(premiumState.pendingPromoPercent) || 0;
  root.querySelectorAll('[data-premium-price]').forEach((el) => {
    const plan = el.getAttribute('data-premium-price');
    const base = PREMIUM_LIST_PRICES[plan];
    if (base == null) return;
    const discounted = pct > 0 ? discountedListPrice(base, pct) : null;
    if (discounted != null) {
      el.innerHTML = `<strong>${escapeHtml(formatEuroPrice(discounted))}</strong> <span class="premium-card__was">${escapeHtml(formatEuroPrice(base))}</span> <span>${plan === 'weekly' ? '/ semana' : '/ mes'}</span>`;
    } else {
      el.innerHTML = `<strong>${escapeHtml(formatEuroPrice(base))}</strong> <span>${plan === 'weekly' ? '/ semana' : '/ mes'}</span>`;
    }
  });
  let badge = root.querySelector('[data-premium-discount-badge]');
  if (pct > 0 && !contentUnlocked()) {
    if (!badge) {
      badge = document.createElement('p');
      badge.className = 'premium-promo__badge';
      badge.setAttribute('data-premium-discount-badge', '1');
      const grid = root.querySelector('.premium-grid');
      if (grid) grid.before(badge);
      else root.appendChild(badge);
    }
    badge.hidden = false;
    badge.textContent = t('premium.discountBadge', { pct: String(pct) });
  } else if (badge) {
    badge.hidden = true;
  }
  root.querySelectorAll('[data-premium-activate]').forEach((btn) => {
    btn.disabled = contentUnlocked();
    btn.textContent = contentUnlocked() ? t('premium.already') : t('premium.subscribe');
  });
  bindPremiumActivate(root);
}

const SETTINGS_KEY = 'houdini_settings_v1';

const I18N = {
  es: {
    'date.unavailable': 'Fecha no disponible',
    'account.perfil': 'Perfil',
    'account.settings': 'Ajustes',
    'account.help': 'Ayuda',
    'account.coop': 'Cooperación',
    'account.privacy': 'Privacidad',
    'account.logout': 'Cerrar sesión',
    'account.premiumOn': 'Premium',
    'account.premiumOff': 'Gratuito',
    'perfil.title': 'Perfil',
    'perfil.badgeFree': 'Gratuito',
    'perfil.badgePremium': 'Premium',
    'perfil.promoLabel': 'Código promocional',
    'perfil.promoApply': 'Aplicar',
    'perfil.promoPlaceholder': 'Código',
    'perfil.promoOk': 'Código aplicado · Premium activado',
    'perfil.promoOkDays': 'Código aplicado · Premium {days}d',
    'perfil.promoOkMonth': 'Código aplicado · 1 mes Premium',
    'perfil.promoOkDiscount': 'Descuento {pct}% aplicado · se usa al pagar',
    'perfil.promoBad': 'Código no válido',
    'perfil.promoUsed': 'Ya has usado este código',
    'perfil.promoExpired': 'Código agotado o caducado',
    'perfil.promoNeedAuth': 'Inicia sesión para canjear',
    'premium.priceWeek': '9,99 €',
    'premium.priceMonth': '19,90 €',
    'premium.discountBadge': '−{pct}% promo',
    'date.yesterday': 'Ayer',
    'date.today': 'Hoy',
    'date.tomorrow': 'Mañana',
    'search.placeholder': 'Buscar equipo',
    'search.results': 'Resultados',
    'search.loading': 'Buscando…',
    'search.empty': 'Sin resultados.',
    'view.top10': 'Top 10 predicciones',
    'view.stats': 'Stats',
    'view.ligas': 'Ligas',
    'view.semanal': 'Semanal',
    'view.partidos': 'Partidos',
    'panel.emptySelect': 'Selecciona un partido para ver el análisis',
    'ligas.emptySelect': 'Selecciona una liga para ver la clasificación',
    'ligas.seeMatches': 'Ver partidos de esta liga',
    'ligas.hint':
      'Elige un país y una liga. En escritorio la tabla aparece a la derecha; en móvil se abre desde la derecha.',
    'ligas.noLeagues': 'No hay ligas en la ventana',
    'ligas.noTable': 'Sin clasificatorio aún',
    'ligas.matchCount': '{n} partido',
    'ligas.matchCountPlural': '{n} partidos',
    'empty.noMatches': 'Sin partidos para {date}',
    'empty.noTips': 'Sin tips jugables hoy (P≥{p}% · cuota ≤{odds})',
    'empty.noClosedTips': 'Sin tips cerrados aún',
    'empty.loadingAnalysis': 'Cargando análisis…',
    'form.win': 'Victoria',
    'form.draw': 'Empate',
    'form.loss': 'Derrota',
    'auth.title': 'Cuenta',
    'auth.tabLogin': 'Inicio de sesión',
    'auth.tabRegister': 'Registrarse',
    'auth.google': 'Continuar con Google',
    'auth.telegram': 'Continuar con Telegram',
    'auth.soon': 'Pronto',
    'auth.or': 'o',
    'auth.userOrEmail': 'Usuario o email',
    'auth.password': 'Contraseña',
    'auth.loginSubmit': 'Entrar',
    'auth.noAccount': '¿No tienes cuenta?',
    'auth.registerLink': 'Regístrate',
    'auth.hasAccount': '¿Ya tienes cuenta?',
    'auth.loginLink': 'Inicia sesión',
    'auth.username': 'ID de usuario',
    'auth.name': 'Nombre',
    'auth.email': 'Email',
    'auth.phone': 'Teléfono',
    'auth.registerSubmit': 'Crear cuenta',
    'auth.confirmPassword': 'Confirmar contraseña',
    'auth.close': 'Cerrar',
    'premiumModal.title': 'Pasa a Premium',
    'premiumModal.lead':
      'Desbloquea tips semanales y el acceso completo a Houdini Bet. Puedes activarlo ahora o más tarde.',
    'premiumModal.activate': 'Activar Premium',
    'premiumModal.skip': 'Ahora no',
    'consent.title': 'Cookies y privacidad',
    'consent.lead':
      'Usamos almacenamiento local para que la app funcione. Las opciones opcionales (analytics stub, búsqueda y filtros) solo se activan si las aceptas.',
    'consent.age': 'Confirmo que soy mayor de 18 años',
    'consent.acceptAll': 'Aceptar todo',
    'consent.necessary': 'Solo necesarias',
    'consent.customize': 'Personalizar',
    'consent.back': '← Volver',
    'consent.customLead':
      'Elige qué guardar en este dispositivo. Necesitas confirmar la mayoría de edad para guardar.',
    'consent.privacy': 'Privacidad',
    'consent.cookies': 'Cookies',
    'consent.notice': 'Aviso',
    'consent.terms': 'Condiciones',
    'toast.payOpenFail': 'No se pudo abrir el pago. Intenta de nuevo en unos segundos.',
    'toast.payStartFail': 'No se pudo iniciar el pago premium: {msg}',
    'toast.payOk': 'Pago confirmado: premium activado. Será visible en unos segundos.',
    'toast.payCancel': 'Pago cancelado sin cargos.',
    'toast.accountDeleted': 'Cuenta eliminada',
    'toast.accountDeleteFail': 'No se pudo eliminar la cuenta',
    'toast.telegramSoon': 'Telegram · Pronto',
    'toast.nextMatchSearch': 'Buscando próximo partido…',
    'toast.noNextMatch': 'Sin partido próximo en la ventana',
    'toast.googleFail': 'No se pudo completar el acceso con Google.',
    'league.generic': 'Liga',
    'league.nations': 'Liga de Naciones',
    'family.1X2': '1X2',
    'family.ou': 'Más/Menos',
    'family.btts': 'Ambos marcan',
    'family.goles': 'Goles',
    'family.corners': 'Córners',
    'family.cards': 'Amarillas',
    'family.shots': 'Tiros',
    'family.shots_on_target': 'Tiros a puerta',
    'family.otros': 'Otros',
    'bet.HOME_WIN': 'Victoria local',
    'bet.DRAW': 'Empate',
    'bet.AWAY_WIN': 'Victoria visitante',
    'bet.DC_1X': 'Doble oportunidad 1X',
    'bet.DC_X2': 'Doble oportunidad X2',
    'bet.DNB_HOME': 'Empate no válido · local',
    'bet.DNB_AWAY': 'Empate no válido · visitante',
    'bet.OVER_05': 'Más de 0,5 goles',
    'bet.UNDER_05': 'Menos de 0,5 goles',
    'bet.OVER_15': 'Más de 1,5 goles',
    'bet.UNDER_15': 'Menos de 1,5 goles',
    'bet.OVER_25': 'Más de 2,5 goles',
    'bet.UNDER_25': 'Menos de 2,5 goles',
    'bet.OVER_35': 'Más de 3,5 goles',
    'bet.UNDER_35': 'Menos de 3,5 goles',
    'bet.OVER_45': 'Más de 4,5 goles',
    'bet.UNDER_45': 'Menos de 4,5 goles',
    'bet.BTTS_YES': 'Ambos marcan — Sí',
    'bet.BTTS_NO': 'Ambos marcan — No',
    'bet.HOME_OVER_05': 'Local · Más de 0,5 goles',
    'bet.HOME_UNDER_05': 'Local · Menos de 0,5 goles',
    'bet.HOME_OVER_15': 'Local · Más de 1,5 goles',
    'bet.HOME_UNDER_15': 'Local · Menos de 1,5 goles',
    'bet.HOME_OVER_25': 'Local · Más de 2,5 goles',
    'bet.HOME_UNDER_25': 'Local · Menos de 2,5 goles',
    'bet.HOME_OVER_35': 'Local · Más de 3,5 goles',
    'bet.HOME_UNDER_35': 'Local · Menos de 3,5 goles',
    'bet.AWAY_OVER_05': 'Visitante · Más de 0,5 goles',
    'bet.AWAY_UNDER_05': 'Visitante · Menos de 0,5 goles',
    'bet.AWAY_OVER_15': 'Visitante · Más de 1,5 goles',
    'bet.AWAY_UNDER_15': 'Visitante · Menos de 1,5 goles',
    'bet.AWAY_OVER_25': 'Visitante · Más de 2,5 goles',
    'bet.AWAY_UNDER_25': 'Visitante · Menos de 2,5 goles',
    'bet.AWAY_OVER_35': 'Visitante · Más de 3,5 goles',
    'bet.AWAY_UNDER_35': 'Visitante · Menos de 3,5 goles',
    'bet.CORNERS_OVER_85': 'Más de 8,5 córners',
    'bet.CORNERS_UNDER_85': 'Menos de 8,5 córners',
    'bet.CORNERS_OVER_95': 'Más de 9,5 córners',
    'bet.CORNERS_UNDER_95': 'Menos de 9,5 córners',
    'bet.CORNERS_OVER_105': 'Más de 10,5 córners',
    'bet.CORNERS_UNDER_105': 'Menos de 10,5 córners',
    'bet.SHOTS_OVER_225': 'Más de 22,5 tiros',
    'bet.SHOTS_UNDER_225': 'Menos de 22,5 tiros',
    'bet.SHOTS_OVER_255': 'Más de 25,5 tiros',
    'bet.SHOTS_UNDER_255': 'Menos de 25,5 tiros',
    'bet.SOT_OVER_75': 'Más de 7,5 tiros a puerta',
    'bet.SOT_UNDER_75': 'Menos de 7,5 tiros a puerta',
    'bet.SOT_OVER_85': 'Más de 8,5 tiros a puerta',
    'bet.SOT_UNDER_85': 'Menos de 8,5 tiros a puerta',
    'bet.SOT_OVER_95': 'Más de 9,5 tiros a puerta',
    'bet.SOT_UNDER_95': 'Menos de 9,5 tiros a puerta',
    'bet.CARDS_OVER_35': 'Más de 3,5 amarillas',
    'bet.CARDS_UNDER_35': 'Menos de 3,5 amarillas',
    'bet.CARDS_OVER_45': 'Más de 4,5 amarillas',
    'bet.CARDS_UNDER_45': 'Menos de 4,5 amarillas',
    'bet.winNamed': 'Victoria {name}',
    'bet.winHome': 'Victoria local',
    'bet.winAway': 'Victoria visitante',
    'weekly.window': 'Jornada',
    'weekly.weekend': 'Fin de semana',
    'weekly.thisWeek': 'Esta semana',
    'weekly.next7': 'Próximos 7 días',
    'weekly.next14': 'Próximos 14 días',
    'weekly.league': 'Liga',
    'weekly.allLeagues': 'Todas',
    'perfil.metaFree': 'Plan gratuito',
    'perfil.metaActive': 'Plan Premium activo',
    'perfil.metaUntil': 'Hasta {date}',
    'perfil.metaDays': ' · {n} días',
    'perfil.upgrade': 'Mejorar a Premium',
    'perfil.settings': 'Ajustes',
    'perfil.privacy': 'Privacidad',
    'perfil.help': 'Ayuda',
    'perfil.logout': 'Cerrar sesión',
    'perfil.delete': 'Eliminar cuenta',
    'premium.statusFree': 'Plan gratuito — desbloquea tip y estadísticas avanzadas',
    'premium.statusOn': 'Plan Premium activo',
    'premium.statusUntil': 'Plan Premium activo · hasta {date}',
    'premium.subscribe': 'Suscribirse',
    'premium.already': 'Ya eres Premium',
    'settings.title': 'Ajustes',
    'settings.lang': 'Idioma',
    'settings.theme': 'Tema',
    'settings.themeDark': 'Oscuro',
    'settings.themeLight': 'Claro',
    'settings.tz': 'Zona horaria',
    'settings.tzDevice': 'Dispositivo',
    'settings.save': 'Guardar',
    'settings.saved': 'Ajustes guardados',
    'settings.privacyHint':
      'Privacidad y cookies en <a href="#ajustes" data-settings-close data-go-ajustes>Ajustes de privacidad</a>.',
    'toast.payUnconfigured': 'Pago no configurado',
    'sanction.title': 'Premium',
    'sanction.copy': 'Premium retirado por incumplimiento de las normas.',
    'sanction.ack': 'Entendido',
    'nav.partidos': 'Partidos',
    'nav.top10': 'Top 10',
    'nav.stats': 'Stats',
    'nav.semanal': 'Semanal',
    'nav.ligas': 'Ligas',
    'panel.tabGeneral': 'General',
    'panel.tabGoals': 'Goles',
    'panel.tabShots': 'Tiros',
    'panel.tabSot': 'Tiros a puerta',
    'panel.tabCorners': 'Córners',
    'panel.tabCards': 'Tarjetas',
    'panel.keyProbs': 'Probabilidades clave',
    'panel.leagueAvg': 'Media liga',
    'panel.over25': 'Más de 2,5 goles',
    'panel.over15': 'Más de 1,5 goles',
    'panel.btts': 'Ambos marcan',
    'panel.bttsYes': 'Sí',
    'panel.bttsNo': 'No',
    'panel.avgGoals': 'Promedio goles',
    'panel.avgCorners': 'Promedio córners',
    'panel.avgCards': 'Promedio tarjetas',
    'panel.average': 'Promedio',
    'panel.metric': 'Métrica',
    'panel.home': 'Local',
    'panel.awayShort': 'Visit.',
    'panel.match': 'Partido',
    'panel.expected': 'Esperado',
    'panel.trendsOf': 'Tendencias de {title}',
    'panel.underTrendsOf': 'Menos de — {title}',
    'panel.overLine': 'Más de {n}',
    'panel.underLine': 'Menos de {n}',
    'panel.goalsTitle': 'goles',
    'panel.goalsExpected': 'Goles esperados',
    'panel.shotsTitle': 'tiros',
    'panel.shotsExpected': 'Tiros totales esperados',
    'panel.sotTitle': 'tiros a puerta',
    'panel.sotExpected': 'Tiros a puerta esperados',
    'panel.cornersTitle': 'córners',
    'panel.cornersExpected': 'Córners esperados',
    'panel.cardsTitle': 'tarjetas',
    'panel.cardsExpected': 'Tarjetas esperadas',
    'panel.offTarget': 'Est. fuera ≈ {h} / {a} / {m}',
    'censor.aria': 'Solo suscriptores — desbloquea con Houdini Premium',
    'censor.title': 'Solo suscriptores',
    'censor.sub': 'Desbloquea las estadísticas con Houdini Premium',
    'censor.cta': 'Ver planes',
    'chip.all': 'Todos',
    'chip.live': 'En vivo',
    'chip.finished': 'Finalizados',
    'chip.upcoming': 'Próximos',
    'panel.analysis': 'Análisis',
  },
  en: {
    'date.unavailable': 'Date unavailable',
    'account.perfil': 'Profile',
    'account.settings': 'Settings',
    'account.help': 'Help',
    'account.coop': 'Collaboration',
    'account.privacy': 'Privacy',
    'account.logout': 'Log out',
    'account.premiumOn': 'Premium',
    'account.premiumOff': 'Free',
    'perfil.title': 'Profile',
    'perfil.badgeFree': 'Free',
    'perfil.badgePremium': 'Premium',
    'perfil.promoLabel': 'Promo code',
    'perfil.promoApply': 'Apply',
    'perfil.promoPlaceholder': 'Code',
    'perfil.promoOk': 'Code applied · Premium unlocked',
    'perfil.promoOkDays': 'Code applied · Premium {days}d',
    'perfil.promoOkMonth': 'Code applied · 1 month Premium',
    'perfil.promoOkDiscount': '{pct}% off applied · used at checkout',
    'perfil.promoBad': 'Invalid code',
    'perfil.promoUsed': 'You already used this code',
    'perfil.promoExpired': 'Code exhausted or expired',
    'perfil.promoNeedAuth': 'Sign in to redeem',
    'premium.priceWeek': '€9.99',
    'premium.priceMonth': '€19.90',
    'premium.discountBadge': '−{pct}% promo',
    'date.yesterday': 'Yesterday',
    'date.today': 'Today',
    'date.tomorrow': 'Tomorrow',
    'search.placeholder': 'Search team',
    'search.results': 'Results',
    'search.loading': 'Searching…',
    'search.empty': 'No results.',
    'view.top10': 'Top 10 predictions',
    'view.stats': 'Stats',
    'view.ligas': 'Leagues',
    'view.semanal': 'Weekly',
    'view.partidos': 'Matches',
    'panel.emptySelect': 'Select a match to see the analysis',
    'ligas.emptySelect': 'Select a league to see the table',
    'ligas.seeMatches': 'See matches in this league',
    'ligas.hint':
      'Pick a country and league. On desktop the table appears on the right; on mobile it slides in from the right.',
    'ligas.noLeagues': 'No leagues in the window',
    'ligas.noTable': 'No standings yet',
    'ligas.matchCount': '{n} match',
    'ligas.matchCountPlural': '{n} matches',
    'empty.noMatches': 'No matches for {date}',
    'empty.noTips': 'No playable tips today (P≥{p}% · odds ≤{odds})',
    'empty.noClosedTips': 'No settled tips yet',
    'empty.loadingAnalysis': 'Loading analysis…',
    'form.win': 'Win',
    'form.draw': 'Draw',
    'form.loss': 'Loss',
    'auth.title': 'Account',
    'auth.tabLogin': 'Sign in',
    'auth.tabRegister': 'Sign up',
    'auth.google': 'Continue with Google',
    'auth.telegram': 'Continue with Telegram',
    'auth.soon': 'Soon',
    'auth.or': 'or',
    'auth.userOrEmail': 'Username or email',
    'auth.password': 'Password',
    'auth.loginSubmit': 'Sign in',
    'auth.noAccount': "Don't have an account?",
    'auth.registerLink': 'Sign up',
    'auth.hasAccount': 'Already have an account?',
    'auth.loginLink': 'Sign in',
    'auth.username': 'Username',
    'auth.name': 'Name',
    'auth.email': 'Email',
    'auth.phone': 'Phone',
    'auth.registerSubmit': 'Create account',
    'auth.confirmPassword': 'Confirm password',
    'auth.close': 'Close',
    'premiumModal.title': 'Go Premium',
    'premiumModal.lead':
      'Unlock weekly tips and full access to Houdini Bet. Activate now or later.',
    'premiumModal.activate': 'Activate Premium',
    'premiumModal.skip': 'Not now',
    'consent.title': 'Cookies and privacy',
    'consent.lead':
      'We use local storage so the app works. Optional choices (analytics stub, search and filters) only turn on if you accept them.',
    'consent.age': 'I confirm I am 18 or older',
    'consent.acceptAll': 'Accept all',
    'consent.necessary': 'Necessary only',
    'consent.customize': 'Customize',
    'consent.back': '← Back',
    'consent.customLead':
      'Choose what to store on this device. You need to confirm you are of legal age to save.',
    'consent.privacy': 'Privacy',
    'consent.cookies': 'Cookies',
    'consent.notice': 'Notice',
    'consent.terms': 'Terms',
    'toast.payOpenFail': 'Could not open checkout. Try again in a few seconds.',
    'toast.payStartFail': 'Could not start Premium checkout: {msg}',
    'toast.payOk': 'Payment confirmed: Premium unlocked. It will show in a few seconds.',
    'toast.payCancel': 'Payment cancelled — no charge.',
    'toast.accountDeleted': 'Account deleted',
    'toast.accountDeleteFail': 'Could not delete account',
    'toast.telegramSoon': 'Telegram · Soon',
    'toast.nextMatchSearch': 'Looking up next match…',
    'toast.noNextMatch': 'No upcoming match in the window',
    'toast.googleFail': 'Could not complete Google sign-in.',
    'league.generic': 'League',
    'league.nations': 'Nations League',
    'family.1X2': '1X2',
    'family.ou': 'Over/Under',
    'family.btts': 'Both teams to score',
    'family.goles': 'Goals',
    'family.corners': 'Corners',
    'family.cards': 'Cards',
    'family.shots': 'Shots',
    'family.shots_on_target': 'Shots on target',
    'family.otros': 'Other',
    'bet.HOME_WIN': 'Home win',
    'bet.DRAW': 'Draw',
    'bet.AWAY_WIN': 'Away win',
    'bet.DC_1X': 'Double chance 1X',
    'bet.DC_X2': 'Double chance X2',
    'bet.DNB_HOME': 'Draw no bet · home',
    'bet.DNB_AWAY': 'Draw no bet · away',
    'bet.OVER_05': 'Over 0.5 goals',
    'bet.UNDER_05': 'Under 0.5 goals',
    'bet.OVER_15': 'Over 1.5 goals',
    'bet.UNDER_15': 'Under 1.5 goals',
    'bet.OVER_25': 'Over 2.5 goals',
    'bet.UNDER_25': 'Under 2.5 goals',
    'bet.OVER_35': 'Over 3.5 goals',
    'bet.UNDER_35': 'Under 3.5 goals',
    'bet.OVER_45': 'Over 4.5 goals',
    'bet.UNDER_45': 'Under 4.5 goals',
    'bet.BTTS_YES': 'BTTS — Yes',
    'bet.BTTS_NO': 'BTTS — No',
    'bet.HOME_OVER_05': 'Home · Over 0.5 goals',
    'bet.HOME_UNDER_05': 'Home · Under 0.5 goals',
    'bet.HOME_OVER_15': 'Home · Over 1.5 goals',
    'bet.HOME_UNDER_15': 'Home · Under 1.5 goals',
    'bet.HOME_OVER_25': 'Home · Over 2.5 goals',
    'bet.HOME_UNDER_25': 'Home · Under 2.5 goals',
    'bet.HOME_OVER_35': 'Home · Over 3.5 goals',
    'bet.HOME_UNDER_35': 'Home · Under 3.5 goals',
    'bet.AWAY_OVER_05': 'Away · Over 0.5 goals',
    'bet.AWAY_UNDER_05': 'Away · Under 0.5 goals',
    'bet.AWAY_OVER_15': 'Away · Over 1.5 goals',
    'bet.AWAY_UNDER_15': 'Away · Under 1.5 goals',
    'bet.AWAY_OVER_25': 'Away · Over 2.5 goals',
    'bet.AWAY_UNDER_25': 'Away · Under 2.5 goals',
    'bet.AWAY_OVER_35': 'Away · Over 3.5 goals',
    'bet.AWAY_UNDER_35': 'Away · Under 3.5 goals',
    'bet.CORNERS_OVER_85': 'Over 8.5 corners',
    'bet.CORNERS_UNDER_85': 'Under 8.5 corners',
    'bet.CORNERS_OVER_95': 'Over 9.5 corners',
    'bet.CORNERS_UNDER_95': 'Under 9.5 corners',
    'bet.CORNERS_OVER_105': 'Over 10.5 corners',
    'bet.CORNERS_UNDER_105': 'Under 10.5 corners',
    'bet.SHOTS_OVER_225': 'Over 22.5 shots',
    'bet.SHOTS_UNDER_225': 'Under 22.5 shots',
    'bet.SHOTS_OVER_255': 'Over 25.5 shots',
    'bet.SHOTS_UNDER_255': 'Under 25.5 shots',
    'bet.SOT_OVER_75': 'Over 7.5 shots on target',
    'bet.SOT_UNDER_75': 'Under 7.5 shots on target',
    'bet.SOT_OVER_85': 'Over 8.5 shots on target',
    'bet.SOT_UNDER_85': 'Under 8.5 shots on target',
    'bet.SOT_OVER_95': 'Over 9.5 shots on target',
    'bet.SOT_UNDER_95': 'Under 9.5 shots on target',
    'bet.CARDS_OVER_35': 'Over 3.5 cards',
    'bet.CARDS_UNDER_35': 'Under 3.5 cards',
    'bet.CARDS_OVER_45': 'Over 4.5 cards',
    'bet.CARDS_UNDER_45': 'Under 4.5 cards',
    'bet.winNamed': '{name} win',
    'bet.winHome': 'Home win',
    'bet.winAway': 'Away win',
    'weekly.window': 'Window',
    'weekly.weekend': 'Weekend',
    'weekly.thisWeek': 'This week',
    'weekly.next7': 'Next 7 days',
    'weekly.next14': 'Next 14 days',
    'weekly.league': 'League',
    'weekly.allLeagues': 'All',
    'perfil.metaFree': 'Free plan',
    'perfil.metaActive': 'Premium plan active',
    'perfil.metaUntil': 'Until {date}',
    'perfil.metaDays': ' · {n} days',
    'perfil.upgrade': 'Upgrade to Premium',
    'perfil.settings': 'Settings',
    'perfil.privacy': 'Privacy',
    'perfil.help': 'Help',
    'perfil.logout': 'Log out',
    'perfil.delete': 'Delete account',
    'premium.statusFree': 'Free plan — unlock tip and advanced stats',
    'premium.statusOn': 'Premium plan active',
    'premium.statusUntil': 'Premium plan active · until {date}',
    'premium.subscribe': 'Subscribe',
    'premium.already': 'You are Premium',
    'settings.title': 'Settings',
    'settings.lang': 'Language',
    'settings.theme': 'Theme',
    'settings.themeDark': 'Dark',
    'settings.themeLight': 'Light',
    'settings.tz': 'Time zone',
    'settings.tzDevice': 'Device',
    'settings.save': 'Save',
    'settings.saved': 'Settings saved',
    'settings.privacyHint':
      'Privacy and cookies in <a href="#ajustes" data-settings-close data-go-ajustes>Privacy settings</a>.',
    'toast.payUnconfigured': 'Payment not configured',
    'sanction.title': 'Premium',
    'sanction.copy': 'Premium removed for violating the rules.',
    'sanction.ack': 'Got it',
    'nav.partidos': 'Matches',
    'nav.top10': 'Top 10',
    'nav.stats': 'Stats',
    'nav.semanal': 'Weekly',
    'nav.ligas': 'Leagues',
    'panel.tabGeneral': 'Overview',
    'panel.tabGoals': 'Goals',
    'panel.tabShots': 'Shots',
    'panel.tabSot': 'Shots on target',
    'panel.tabCorners': 'Corners',
    'panel.tabCards': 'Cards',
    'panel.keyProbs': 'Key probabilities',
    'panel.leagueAvg': 'League avg',
    'panel.over25': 'Over 2.5 goals',
    'panel.over15': 'Over 1.5 goals',
    'panel.btts': 'Both teams to score',
    'panel.bttsYes': 'Yes',
    'panel.bttsNo': 'No',
    'panel.avgGoals': 'Goals average',
    'panel.avgCorners': 'Corners average',
    'panel.avgCards': 'Cards average',
    'panel.average': 'Average',
    'panel.metric': 'Metric',
    'panel.home': 'Home',
    'panel.awayShort': 'Away',
    'panel.match': 'Match',
    'panel.expected': 'Expected',
    'panel.trendsOf': '{title} trends',
    'panel.underTrendsOf': 'Under — {title}',
    'panel.overLine': 'Over {n}',
    'panel.underLine': 'Under {n}',
    'panel.goalsTitle': 'goals',
    'panel.goalsExpected': 'Expected goals',
    'panel.shotsTitle': 'shots',
    'panel.shotsExpected': 'Expected total shots',
    'panel.sotTitle': 'shots on target',
    'panel.sotExpected': 'Expected shots on target',
    'panel.cornersTitle': 'corners',
    'panel.cornersExpected': 'Expected corners',
    'panel.cardsTitle': 'cards',
    'panel.cardsExpected': 'Expected cards',
    'panel.offTarget': 'Est. off target ≈ {h} / {a} / {m}',
    'censor.aria': 'Subscribers only — unlock with Houdini Premium',
    'censor.title': 'Subscribers only',
    'censor.sub': 'Unlock stats with Houdini Premium',
    'censor.cta': 'See plans',
    'chip.all': 'All',
    'chip.live': 'Live',
    'chip.finished': 'Finished',
    'chip.upcoming': 'Upcoming',
    'panel.analysis': 'Analysis',
  },
};

function loadUiSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      lang: parsed?.lang === 'en' ? 'en' : 'es',
      theme: 'dark',
      timezone: parsed?.timezone === 'device' ? 'device' : 'Europe/Madrid',
    };
  } catch (_) {
    return { lang: 'es', theme: 'dark', timezone: 'Europe/Madrid' };
  }
}

/** Shared Premium / Gratuito badge for menú + perfil. */
function syncPlanBadge(el, isPremium) {
  if (!el) return;
  const on = Boolean(isPremium);
  el.textContent = on ? t('perfil.badgePremium') : t('perfil.badgeFree');
  el.classList.add('plan-badge');
  el.classList.toggle('plan-badge--premium', on);
  el.classList.remove(
    'account-menu__premium',
    'account-menu__premium--on',
    'account-menu__premium--off',
    'perfil-plan__badge',
    'is-premium'
  );
}

function saveUiSettings(next) {
  const cur = { ...loadUiSettings(), ...next };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(cur));
  return cur;
}

function getUiLang() {
  return loadUiSettings().lang === 'en' ? 'en' : 'es';
}

function getUiLocale() {
  return getUiLang() === 'en' ? 'en-GB' : 'es-ES';
}

function getUiTimeZone() {
  const tz = loadUiSettings().timezone;
  if (tz === 'device') {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid';
    } catch (_) {
      return 'Europe/Madrid';
    }
  }
  return 'Europe/Madrid';
}

function t(key, vars = {}) {
  const lang = getUiLang();
  const dict = I18N[lang] || I18N.es;
  let out = dict[key] ?? I18N.es[key] ?? key;
  Object.keys(vars).forEach((k) => {
    out = out.replaceAll(`{${k}}`, String(vars[k]));
  });
  return out;
}

function applyAccountI18n() {
  const map = [
    ['#account-perfil', 'account.perfil'],
    ['#account-settings', 'account.settings'],
    ['#account-ayuda', 'account.help'],
    ['#account-coop', 'account.coop'],
    ['#account-ajustes', 'account.privacy'],
    ['#account-logout', 'account.logout'],
    ['.perfil-bar__title', 'perfil.title'],
    ['#perfil-open-settings', 'perfil.settings'],
    ['#perfil-logout', 'perfil.logout'],
    ['#perfil-delete', 'perfil.delete'],
    ['#perfil-upgrade', 'perfil.upgrade'],
    ['#settings-modal-title', 'settings.title'],
    ['#settings-save', 'settings.save'],
    ['#sanction-modal-title', 'sanction.title'],
    ['#sanction-modal-copy', 'sanction.copy'],
    ['#sanction-modal-ack', 'sanction.ack'],
  ];
  map.forEach(([sel, key]) => {
    const el = document.querySelector(sel);
    if (el) el.textContent = t(key);
  });
  const privacyLink = document.querySelector('#perfil .perfil-links a[href="#ajustes"]');
  if (privacyLink) privacyLink.textContent = t('perfil.privacy');
  const helpLink = document.querySelector('#perfil .perfil-links a[href^="mailto"]');
  if (helpLink) helpLink.textContent = t('perfil.help');
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const key = el.getAttribute('data-i18n-html');
    if (key) el.innerHTML = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) el.setAttribute('placeholder', t(key));
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria');
    if (key) el.setAttribute('aria-label', t(key));
  });
  const googleSpan = document.querySelector('#auth-google span:last-child');
  if (googleSpan && !googleSpan.classList.contains('auth-google__mark')) {
    googleSpan.textContent = t('auth.google');
  }
  const tgAuthSoon = document.querySelector('#auth-telegram .auth-telegram__soon');
  if (tgAuthSoon) tgAuthSoon.textContent = t('auth.soon');
  const tgAuthLabel = document.querySelector('#auth-telegram > span:not(.auth-telegram__soon):not(.auth-telegram__mark)');
  if (tgAuthLabel) tgAuthLabel.textContent = t('auth.telegram');
  document.querySelectorAll('.account-menu__soon, .perfil-links__soon').forEach((el) => {
    el.textContent = t('auth.soon');
  });
}

function applyUiSettings() {
  const s = loadUiSettings();
  document.documentElement.lang = s.lang === 'en' ? 'en' : 'es';
  document.body.setAttribute('data-theme', 'dark');
  applyAccountI18n();
  syncPremiumView();
  syncPerfilView();
  const panelTitle = document.querySelector('.panel-header__title');
  if (panelTitle) panelTitle.textContent = t('panel.analysis');
  document.querySelectorAll('[data-chip]').forEach((el) => {
    const k = el.getAttribute('data-chip');
    if (k) el.textContent = t(`chip.${k}`);
  });
}

function refreshUiAfterLangChange() {
  applyUiSettings();
  try {
    if (typeof renderPartidosList === 'function') renderPartidosList();
  } catch (_) {}
  try {
    if (typeof renderTop3 === 'function') renderTop3();
  } catch (_) {}
  try {
    if (typeof renderLigasView === 'function') renderLigasView();
  } catch (_) {}
  try {
    if (typeof loadPerformance === 'function') loadPerformance();
  } catch (_) {}
  if (selectedMatchId && document.getElementById('panel')?.classList.contains('is-open')) {
    openPrediction(selectedMatchId).catch(() => {});
  }
}

function syncPerfilView() {
  const root = document.getElementById('perfil');
  if (!root || !authUser) return;
  const letter = String(authUser.name || authUser.email || '?')
    .trim()
    .charAt(0)
    .toUpperCase();
  const avatar = document.getElementById('perfil-avatar');
  const nameEl = document.getElementById('perfil-name');
  const userEl = document.getElementById('perfil-user');
  const emailEl = document.getElementById('perfil-email');
  const badge = document.getElementById('perfil-plan-badge');
  const meta = document.getElementById('perfil-plan-meta');
  const upgrade = document.getElementById('perfil-upgrade');
  if (avatar) avatar.textContent = letter || '?';
  if (nameEl) nameEl.textContent = authUser.name || 'Cuenta';
  if (userEl) {
    userEl.textContent = authUser.username ? `@${authUser.username}` : '';
    userEl.hidden = !authUser.username;
  }
  if (emailEl) emailEl.textContent = authUser.email || '';
  const on = contentUnlocked();
  syncPlanBadge(badge, on);
  if (meta) {
    if (on && premiumState.premiumUntil) {
      meta.textContent =
        t('perfil.metaUntil', { date: String(premiumState.premiumUntil).slice(0, 10) }) +
        (premiumState.premiumDaysLeft != null
          ? t('perfil.metaDays', { n: premiumState.premiumDaysLeft })
          : '');
    } else if (on) {
      meta.textContent = t('perfil.metaActive');
    } else {
      meta.textContent = t('perfil.metaFree');
    }
  }
  if (upgrade) {
    upgrade.hidden = on;
    upgrade.textContent = t('perfil.upgrade');
  }
}

function isSettingsModalOpen() {
  const modal = document.getElementById('settings-modal');
  return Boolean(modal && !modal.hidden && modal.classList.contains('is-open'));
}

function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  const s = loadUiSettings();
  modal.querySelectorAll('[name="settings-lang"]').forEach((el) => {
    el.checked = el.value === s.lang;
  });
  modal.querySelectorAll('[name="settings-tz"]').forEach((el) => {
    el.checked = el.value === s.timezone;
  });
  modal.hidden = false;
  modal.classList.add('is-open');
  document.body.classList.add('auth-open');
  requestAnimationFrame(() => {
    document.getElementById('settings-save')?.focus({ preventScroll: true });
  });
}

function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (!modal || !isSettingsModalOpen()) return;
  modal.classList.remove('is-open');
  modal.hidden = true;
  if (!isAuthModalOpen() && !isPremiumModalOpen()) {
    document.body.classList.remove('auth-open');
  }
}

async function deleteOwnAccount() {
  const ok = window.confirm(
    '¿Eliminar tu cuenta de forma permanente? Se borrarán tu sesión y tus datos de acceso.'
  );
  if (!ok) return;
  try {
    await api('/api/v1/auth/delete', { method: 'POST' });
    setAuthUser(null);
    premiumState.premium = false;
    premiumState.plan = 'free';
    bootAwaitingAuth = true;
    openAuthRequiredGate();
    showBanner(t('toast.accountDeleted'), 'info');
  } catch (err) {
    showBanner(err.message || t('toast.accountDeleteFail'), 'error');
  }
}

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    credentials: 'same-origin',
    ...opts,
  });
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

/** Aciertos / tip summary: always full tip history (ignore Pronósticos window). */
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
    ['all', t('chip.all'), c.all],
    ['live', t('chip.live'), c.live],
    ['finished', t('chip.finished'), c.finished],
    ['upcoming', t('chip.upcoming'), c.upcoming],
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
  return formatLeagueLine(
    m.leagueCountry || m.country || '',
    m.leagueName || m.league || '',
    m.leagueApiId ?? m.apiId
  );
}

function browseRowHtml(m) {
  const id = Number(m.id);
  const home = m.homeTeam?.name || '';
  const away = m.awayTeam?.name || '';
  const homeLogo = m.homeTeam?.logo;
  const awayLogo = m.awayTeam?.logo;
  const sel = selectedMatchId === id ? ' is-selected' : '';
  const liveCls = m.status === 'live' ? ' league-match--live' : '';
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
      ${liveStrip}
    </button>`;
}

function renderPartidosList() {
  const el = document.getElementById('matches');
  const countEl = document.getElementById('match-count');
  if (!el) return;
  const rows = filteredBrowseMatches();
  if (countEl) {
    countEl.textContent = t(
      rows.length === 1 ? 'ligas.matchCount' : 'ligas.matchCountPlural',
      { n: rows.length }
    );
  }
  if (!rows.length) {
    el.innerHTML = `${premiumBannerHtml()}<div class="empty-board">${escapeHtml(
      t('empty.noMatches', { date: formatDateCenter(resolveSelectedDate()) })
    )}</div>`;
    return;
  }
  const groups = new Map();
  for (const m of rows) {
    const k = leagueKey(m);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  const sections = [...groups.entries()].map(
    ([title, matches]) => `
      <section class="league" role="group" aria-label="${escapeHtml(title)}">
        <h3 class="league__title">${escapeHtml(title)}</h3>
        <div class="league__list">${matches.map(browseRowHtml).join('')}</div>
      </section>`
  );
  /* Banner after first league group (or at top if only one). */
  if (sections.length > 1) {
    sections.splice(1, 0, premiumBannerHtml());
  } else {
    sections.push(premiumBannerHtml());
  }
  el.innerHTML = sections.join('');
  bindAnalyze(el);
}

/** Primary Top 10 floor (same as playable tip lane). */
const TOP10_MIN_PROB = 75;
/** Soft backfill floor — fill to 10 when primary pass underfills; never invent tips. */
const TOP10_SOFT_MIN_PROB = 69;
/** Preferred playable floor (lane/value). Top 10 does not hard-reject below this. */
const TOP10_MIN_ODDS = 1.3;
const TOP10_MAX_ODDS = 3.5;
const TOP10_TRIVIAL_LABELS = new Set(['OVER_05', 'UNDER_45']);
const TOP10_MAX_PER_FAMILY = 3;
const TOP10_LIMIT = 10;

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

function isTrivialTop10Label(label) {
  const lab = String(label || '').toUpperCase();
  return TOP10_TRIVIAL_LABELS.has(lab) || lab.startsWith('SHOTS_');
}

/**
 * Odds used for Top 10 band check: book tipOdds → any tipOdds → model-implied 1/p.
 * Never reject solely because tipOdds is null (common without API_FOOTBALL_KEY).
 */
function tipOddsForTop10Band(m, probPct) {
  const raw = m?.tipOdds != null ? Number(m.tipOdds) : null;
  if (raw != null && Number.isFinite(raw) && raw > 1) return raw;
  const p = Number(probPct) / 100;
  if (Number.isFinite(p) && p > 0.01 && p < 0.99) return 1 / p;
  return null;
}

/**
 * Top 10 eligibility score: non-trivial, P≥minProb, cuota ≤3.50.
 * Min cuota 1.30 is playable-value guidance only — do NOT reject high-P tips
 * whose model 1/p (or short book) falls below 1.30; that starved quiet/high-P days.
 * tipTier none / display tips OK (Top 10 is UI ranking, not tip_results).
 */
function tipPlayableScore(m, minProb = TOP10_SOFT_MIN_PROB) {
  const tip = m?.suggestedBet || m?.tip || m?.suggested_bet || '';
  if (!tip || isTrivialTop10Label(tip)) return null;
  const prob = tipProbPct(m);
  if (prob == null || !Number.isFinite(Number(prob)) || Number(prob) < minProb) {
    return null;
  }
  const odds = tipOddsForTop10Band(m, prob);
  // Reject missing / invalid / longshot (>max). Allow shorts below TOP10_MIN_ODDS.
  if (odds == null || !Number.isFinite(odds) || odds <= 1 || odds > TOP10_MAX_ODDS) {
    return null;
  }
  const isBook = m.oddsSource === 'book' && m.tipOdds != null && Number(m.tipOdds) > 1;
  let score = (Number(prob) / 100) * Math.log(Math.max(odds, 1.01));
  const edge = m.valueEdge != null ? Number(m.valueEdge) : null;
  if (edge != null && Number.isFinite(edge)) score += Math.max(0, edge) * 0.15;
  if (!isBook) score -= 0.05;
  return {
    score,
    kind: isBook ? 'book' : 'est',
    prob: Number(prob),
    primaryPass: Number(prob) >= TOP10_MIN_PROB,
  };
}

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
 * Pass 2: drop family cap, keep label cap.
 * Pass 3: fill remaining with one-per-match only (allow duplicate labels) so quiet
 * days are not starved when several matches share OVER_15 / etc. Still no inventing.
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

  const tryPick = ({ enforceFamilyCap, enforceLabelCap }) => {
    while (selected.length < limit) {
      let best = null;
      let bestIdx = Infinity;
      let bestFamMalus = Infinity;
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (selected.includes(item)) continue;
        const label = labelOf(item);
        if (!label) continue;
        if (enforceLabelCap && (usedLabels.get(label) || 0) >= maxLabel) continue;
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

  tryPick({ enforceFamilyCap: true, enforceLabelCap: true });
  if (selected.length < limit) tryPick({ enforceFamilyCap: false, enforceLabelCap: true });
  if (selected.length < limit) tryPick({ enforceFamilyCap: false, enforceLabelCap: false });
  return selected;
}

function isTop10MatchStatus(status) {
  const s = String(status || '').toLowerCase();
  return s === 'scheduled' || s === 'live' || s === '';
}

/**
 * Primary tip candidates only (soft floor). Never promote secondary into Top 10 chrome —
 * panel-suggest and card-tip must show the same match primary (suggestedBet).
 * tipTier none / display tips included when tipProbPct ≥ soft floor (Top 10 ≠ Stats ledger).
 * Only scheduled/live (skip finished) so Top 10 stays actionable.
 */
function buildTop10Pool(matches) {
  const pool = [];
  for (const raw of matches || []) {
    if (!raw?.suggestedBet || isTrivialTop10Label(raw.suggestedBet)) continue;
    if (!isTop10MatchStatus(raw.status)) continue;
    const matchId = raw.id ?? raw.matchId;
    const primaryView = {
      ...raw,
      id: matchId,
      suggestedBet: raw.suggestedBet,
      tipOdds: raw.tipOdds,
      oddsSource: raw.oddsSource,
      confidenceScore: raw.confidenceScore,
    };
    const primaryMeta = tipPlayableScore(primaryView, TOP10_SOFT_MIN_PROB);
    if (primaryMeta) {
      pool.push({
        m: primaryView,
        tipLabel: raw.suggestedBet,
        matchId,
        isSecondary: false,
        meta: primaryMeta,
      });
    }
  }
  // Primary pass (P≥75) first, then soft backfill (P≥69); within band: book > est, then score.
  return pool.sort((a, b) => {
    const aPri = a.meta.primaryPass ? 1 : 0;
    const bPri = b.meta.primaryPass ? 1 : 0;
    if (bPri !== aPri) return bPri - aPri;
    if (a.meta.kind === 'book' && b.meta.kind !== 'book') return -1;
    if (b.meta.kind === 'book' && a.meta.kind !== 'book') return 1;
    if (b.meta.prob !== a.meta.prob) return b.meta.prob - a.meta.prob;
    return b.meta.score - a.meta.score;
  });
}

/** Fill up to 10: diversity caps, primary P≥75 first, soft P≥69 backfill. */
function pickTop10Tips(matches, limit = TOP10_LIMIT) {
  const pool = buildTop10Pool(matches);
  return selectDiverseTips(pool, limit, 1, TOP10_MAX_PER_FAMILY);
}

let top3LoadSeq = 0;

/**
 * Top 10: tips of the selected calendar day only (same date as Partidos).
 * Fill min(10, N). Primary P≥75 + soft ≥69. Not best-bets/playable-only. Stats tip_results unchanged.
 */
async function renderTop3() {
  const el = document.getElementById('top3-list');
  if (!el) return;
  const seq = ++top3LoadSeq;
  el.innerHTML = Array.from({ length: 4 }, () => `<div class="skeleton" aria-hidden="true"></div>`).join('');
  try {
    const date = resolveSelectedDate();
    const data = await api(`/api/v1/matches/today?date=${encodeURIComponent(date)}`);
    if (seq !== top3LoadSeq) return;
    const matches = data.matches || [];
    const picked = pickTop10Tips(matches, TOP10_LIMIT);
    if (!picked.length) {
      el.innerHTML = `<div class="empty-board">${escapeHtml(
        t('empty.noTips', { p: TOP10_SOFT_MIN_PROB, odds: TOP10_MAX_ODDS.toFixed(2) })
      )}</div>`;
      return;
    }
    el.innerHTML = picked
      .map((item, i) => {
        const bet = item.m;
        const home = bet.homeTeam?.name || bet.home || '';
        const away = bet.awayTeam?.name || bet.away || '';
        const tip = item.tipLabel || bet.suggestedBet;
        const tipLabel = tip ? labelBet(tip, home, away) : 'Sin tip';
        const m = {
          ...bet,
          id: item.matchId ?? bet.id ?? bet.matchId,
          leagueName: bet.leagueName || bet.league,
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
        const matchId = Number(item.matchId ?? bet.id ?? bet.matchId);
        const liveStrip = bet.status === 'live' ? liveStripHtml(m) : '';
        const tipPrimary = hbCensorWrap(
          `<div class="card-tip__primary">
            <span class="card-tip__bet tip-accent">${escapeHtml(tipLabel)}</span>
            ${
              prob != null
                ? `<span class="${confClass(prob)} card-tip__conf">${Math.round(Number(prob))}%</span>`
                : ''
            }
          </div>`
        );
        const tipMetrics = hbCensorWrap(
          `<div class="top3-metrics">
            ${prob != null ? `<span class="top3-metrics__item"><em>Prob</em> ${Math.round(Number(prob))}%</span>` : ''}
            ${oddsTxt ? `<span class="top3-metrics__item"><em>Cuota</em> ${escapeHtml(oddsTxt)}</span>` : '<span class="top3-metrics__item muted"><em>Cuota</em> sin book</span>'}
            ${valueTxt ? `<span class="top3-metrics__item top3-metrics__item--value">${escapeHtml(valueTxt)}</span>` : ''}
          </div>`
        );
        return `
      <article class="card card--tip card--row card--top3" data-analyze="${matchId}">
        <div class="card-tip__body">
          <div class="top3-rank">#${rank}</div>
          ${tipPrimary}
          ${liveStrip}
          ${tipMetrics}
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
  if (tipTier === 'none' || tipTier === 'fallback') {
    bits.push('<span class="muted">sin tip ≥75%</span>');
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
  const confN =
    conf != null && !Number.isNaN(Number(conf)) && Number(conf) > 0
      ? Number(conf)
      : tip
        ? tipProbPct({
            suggestedBet: tip,
            confidenceScore: conf,
            tipTier,
          })
        : null;
  const confLabel =
    tip && confN != null && !Number.isNaN(Number(confN))
      ? `${Math.round(Number(confN))}%`
      : '';
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
          ${confLabel ? `<span class="${confClass(confN)} card-tip__conf">${confLabel}</span>` : ''}
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
          conf: confN,
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
    if (node.dataset.analyzeBound === '1') return;
    node.dataset.analyzeBound = '1';
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

/** Normalize a 0–1 or 0–100 model prob to display percentage (0–100). */
function toDisplayPct(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  const pct = n <= 1 ? n * 100 : n;
  return Number(pct.toFixed(1));
}

/**
 * Model market probability (0–100) for a tip label from a prediction / markets payload.
 * Shared by panel / list / Top10 so tip meta never falls back to bare "— modelo".
 */
function probForLabel(prediction, label) {
  if (!prediction || !label) return null;
  const tip = String(label);
  const p = prediction.prediction && typeof prediction.prediction === 'object'
    ? { ...prediction, ...prediction.prediction }
    : prediction;
  const pick = (...keys) => {
    for (const k of keys) {
      if (p[k] != null && p[k] !== '') return toDisplayPct(p[k]);
    }
    return null;
  };
  const markets = resolveMarkets(p) || {};
  const marketMap = {
    HOME_WIN: markets.home,
    DRAW: markets.draw,
    AWAY_WIN: markets.away,
    OVER_25: markets.over25,
    UNDER_25: markets.under25,
    BTTS_YES: markets.bttsYes,
    BTTS_NO: markets.bttsNo,
  };
  if (marketMap[tip] != null) return marketMap[tip];

  const hw = pick('home_win_prob', 'homeWinProb');
  const dr = pick('draw_prob', 'drawProb');
  const aw = pick('away_win_prob', 'awayWinProb');
  if (tip === 'DC_1X' && hw != null && dr != null) {
    const sum = hw + dr;
    return sum > 0 && sum < 100 ? Number(sum.toFixed(1)) : null;
  }
  if (tip === 'DC_X2' && aw != null && dr != null) {
    const sum = aw + dr;
    return sum > 0 && sum < 100 ? Number(sum.toFixed(1)) : null;
  }
  if (tip === 'DNB_HOME' && hw != null && aw != null && hw + aw > 0) {
    return Number(((hw / (hw + aw)) * 100).toFixed(1));
  }
  if (tip === 'DNB_AWAY' && hw != null && aw != null && hw + aw > 0) {
    return Number(((aw / (hw + aw)) * 100).toFixed(1));
  }

  const fieldMap = {
    HOME_WIN: ['home_win_prob', 'homeWinProb'],
    DRAW: ['draw_prob', 'drawProb'],
    AWAY_WIN: ['away_win_prob', 'awayWinProb'],
    OVER_05: ['over05_prob', 'over05Prob'],
    UNDER_05: ['under05_prob', 'under05Prob'],
    OVER_15: ['over15_prob', 'over15Prob'],
    UNDER_15: ['under15_prob', 'under15Prob'],
    OVER_25: ['over25_prob', 'over25Prob'],
    UNDER_25: ['under25_prob', 'under25Prob'],
    OVER_35: ['over35_prob', 'over35Prob'],
    UNDER_35: ['under35_prob', 'under35Prob'],
    OVER_45: ['over45_prob', 'over45Prob'],
    UNDER_45: ['under45_prob', 'under45Prob'],
    BTTS_YES: ['btts_yes_prob', 'bttsYesProb'],
    BTTS_NO: ['btts_no_prob', 'bttsNoProb'],
    HOME_OVER_05: ['home_over05_prob', 'homeOver05Prob'],
    HOME_UNDER_05: ['home_under05_prob', 'homeUnder05Prob'],
    HOME_OVER_15: ['home_over15_prob', 'homeOver15Prob'],
    HOME_UNDER_15: ['home_under15_prob', 'homeUnder15Prob'],
    HOME_OVER_25: ['home_over25_prob', 'homeOver25Prob'],
    HOME_UNDER_25: ['home_under25_prob', 'homeUnder25Prob'],
    HOME_OVER_35: ['home_over35_prob', 'homeOver35Prob'],
    HOME_UNDER_35: ['home_under35_prob', 'homeUnder35Prob'],
    AWAY_OVER_05: ['away_over05_prob', 'awayOver05Prob'],
    AWAY_UNDER_05: ['away_under05_prob', 'awayUnder05Prob'],
    AWAY_OVER_15: ['away_over15_prob', 'awayOver15Prob'],
    AWAY_UNDER_15: ['away_under15_prob', 'awayUnder15Prob'],
    AWAY_OVER_25: ['away_over25_prob', 'awayOver25Prob'],
    AWAY_UNDER_25: ['away_under25_prob', 'awayUnder25Prob'],
    AWAY_OVER_35: ['away_over35_prob', 'awayOver35Prob'],
    AWAY_UNDER_35: ['away_under35_prob', 'awayUnder35Prob'],
    CORNERS_OVER_85: ['corners_over85_prob', 'cornersOver85Prob'],
    CORNERS_UNDER_85: ['corners_under85_prob', 'cornersUnder85Prob'],
    CORNERS_OVER_95: ['corners_over95_prob', 'cornersOver95Prob'],
    CORNERS_UNDER_95: ['corners_under95_prob', 'cornersUnder95Prob'],
    CORNERS_OVER_105: ['corners_over105_prob', 'cornersOver105Prob'],
    CORNERS_UNDER_105: ['corners_under105_prob', 'cornersUnder105Prob'],
    CARDS_OVER_35: ['cards_over35_prob', 'cardsOver35Prob'],
    CARDS_UNDER_35: ['cards_under35_prob', 'cardsUnder35Prob'],
    CARDS_OVER_45: ['cards_over45_prob', 'cardsOver45Prob'],
    CARDS_UNDER_45: ['cards_under45_prob', 'cardsUnder45Prob'],
    SOT_OVER_75: ['sot_over75_prob', 'sotOver75Prob'],
    SOT_UNDER_75: ['sot_under75_prob', 'sotUnder75Prob'],
    SOT_OVER_85: ['sot_over85_prob', 'sotOver85Prob'],
    SOT_UNDER_85: ['sot_under85_prob', 'sotUnder85Prob'],
    SOT_OVER_95: ['sot_over95_prob', 'sotOver95Prob'],
    SOT_UNDER_95: ['sot_under95_prob', 'sotUnder95Prob'],
  };
  const keys = fieldMap[tip];
  if (keys) return pick(...keys);
  return null;
}

/**
 * Tip display % (0–100): confidence_score when > 0, else market P for suggestedBet.
 * Never returns null when a suggested bet has a resolvable market probability.
 */
function tipProbPct(raw) {
  if (!raw) return null;
  const tip = String(raw.suggestedBet || raw.tip || raw.suggested_bet || '');
  const confRaw = raw.confidenceScore ?? raw.conf ?? raw.confidence_score;
  const conf =
    confRaw != null && !Number.isNaN(Number(confRaw)) ? Number(confRaw) : null;
  if (conf != null && conf > 0) return conf;
  if (tip) {
    const fromLabel = probForLabel(raw, tip);
    if (fromLabel != null) return fromLabel;
  }
  return conf != null && conf > 0 ? conf : null;
}

/** Format tip meta % + optional odds-source hint. Never bare "— modelo". */
function tipConfMetaHtml(tipProb, oddsSource = null) {
  const src =
    oddsSource && oddsSource !== 'book'
      ? ` · ${escapeHtml(oddsSourceLabel(oddsSource))}`
      : '';
  if (tipProb != null && Number.isFinite(Number(tipProb))) {
    const n = Math.round(Number(tipProb));
    return `<span class="${confClass(n)}"><span data-count-to="${n}" data-count-suffix="%">0%</span>${src}</span>`;
  }
  return src
    ? `<span class="conf-lo muted">${escapeHtml(oddsSourceLabel(oddsSource))}</span>`
    : '';
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
  const league = leagueLabelEs(raw);
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
    (prob != null && Number(prob) >= 75 ? 'playable' : tip ? 'fallback' : null);
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
    tipTier === 'none' || tipTier === 'fallback'
      ? '<span class="muted sheet__odd-src">sin tip ≥75%</span>'
      : tipTier === 'playable' && prob != null && Number(prob) >= 80
        ? '<span class="muted sheet__odd-src">tip seguro</span>'
        : '';
  // Always show numeric % when tip exists; never bare dash for suggested tips.
  const showProb = tip ? prob : null;

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
      <span class="sheet__prob ${confClass(showProb)}">${
        showProb != null ? `${Math.round(Number(showProb))}%` : tip ? '…' : '—'
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
  const matchId = Number(r.matchId);
  const clickable = Number.isFinite(matchId) && matchId > 0;
  const tip = escapeHtml(labelBet(r.suggestedBet, r.homeName, r.awayName));
  const score =
    r.homeGoals != null && r.awayGoals != null
      ? `${Number(r.homeGoals)}-${Number(r.awayGoals)}`
      : '—';
  const odds = tipOddsDisplay(r.tipOdds);
  const attrs = clickable
    ? ` data-analyze="${matchId}" role="button" tabindex="0"`
    : '';
  return `
    <article class="perf-row" role="listitem"${attrs}>
      <span class="perf-row__crests" aria-hidden="true">
        ${crestHtml(r.homeName, r.homeLogo, 'sm')}
        ${crestHtml(r.awayName, r.awayLogo, 'sm')}
      </span>
      <span class="perf-row__main">
        <span class="perf-row__match">${escapeHtml(r.homeName || '')} – ${escapeHtml(r.awayName || '')}</span>
        <span class="perf-row__tip tip-accent">${tip}</span>
        <span class="perf-row__meta muted">${escapeHtml(leagueLabelEs(r.leagueName || r.league || '—'))} · ${escapeHtml(
          formatMatchDate(r.matchDate)
        )} · ${score}${odds ? ` · ${odds}` : ''}</span>
      </span>
      <span class="perf-row__out">${outcomeBadge(r.outcome)}</span>
    </article>`;
}

const PERF_RECENT_PAGE = 50;
let perfRecentOffset = 0;
let perfRecentHasMore = false;
let perfRecentLoadingMore = false;

function renderPerformance(perf, { append = false } = {}) {
  const summary = document.getElementById('perf-summary');
  const recent = document.getElementById('perf-recent');
  if (!summary || !recent) return;

  if (!append) {
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
  }

  const rows = perf?.recent || [];
  perfRecentHasMore = Boolean(perf?.recentHasMore);
  perfRecentOffset =
    Number(perf?.recentOffset || 0) + Number(perf?.recentLimit || rows.length || PERF_RECENT_PAGE);

  if (!append) {
    if (!rows.length) {
      const gated =
        !PREMIUM_UNLOCKED && perf?.premiumRequired && !premiumState.premium;
      recent.innerHTML = gated
        ? premiumUpsellHtml('perf-recent')
        : `<div class="perf-empty muted">${escapeHtml(t('empty.noClosedTips'))}</div>`;
      if (gated) bindPremiumActivate(recent);
      return;
    }
    recent.innerHTML = `<div class="perf-list" role="list">${rows
      .map(recentTipRowHtml)
      .join('')}</div>
      <div class="perf-more-wrap" id="perf-more-wrap"></div>`;
  } else {
    const list = recent.querySelector('.perf-list');
    if (list && rows.length) {
      list.insertAdjacentHTML('beforeend', rows.map(recentTipRowHtml).join(''));
    }
  }
  if (rows.length) bindAnalyze(recent);
  renderPerfLoadMore();
}

function renderPerfLoadMore() {
  const wrap = document.getElementById('perf-more-wrap');
  if (!wrap) return;
  if (!perfRecentHasMore) {
    wrap.innerHTML = '';
    return;
  }
  wrap.innerHTML = `<button type="button" class="btn btn--ghost perf-more" id="perf-load-more"${
    perfRecentLoadingMore ? ' disabled' : ''
  }>Cargar más</button>`;
  document.getElementById('perf-load-more')?.addEventListener('click', () => {
    loadMorePerformance().catch(() => {});
  });
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
  perfRecentOffset = 0;
  perfRecentHasMore = false;
  try {
    const q = `${TIPS_PERF_GLOBAL_Q}&limit=${PERF_RECENT_PAGE}&offset=0`;
    tipPerfCache = null;
    tipPerfCacheKey = null;
    const perf = await fetchTipPerformance(q);
    renderPerformance(perf);
    cachedTipSummary = perf;
  } catch (err) {
    if (summary) {
      summary.innerHTML = `<div class="empty-board conf-lo">${escapeHtml(err.message)}</div>`;
    }
    if (recent) recent.innerHTML = '';
  }
}

async function loadMorePerformance() {
  if (perfRecentLoadingMore || !perfRecentHasMore) return;
  perfRecentLoadingMore = true;
  renderPerfLoadMore();
  try {
    const q = `${TIPS_PERF_GLOBAL_Q}&limit=${PERF_RECENT_PAGE}&offset=${perfRecentOffset}`;
    const perf = await api(`/api/v1/tips/performance?${q}`);
    renderPerformance(perf, { append: true });
  } catch (_) {
    /* keep existing list */
  } finally {
    perfRecentLoadingMore = false;
    renderPerfLoadMore();
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

function isLegalViewId(id) {
  return id === 'privacidad' || id === 'cookies' || id === 'aviso' || id === 'condiciones';
}

function isAdminQueryEnabled() {
  return new URLSearchParams(location.search).get('admin') === '1';
}

function normalizeViewHash(hash) {
  const raw = (hash || '').replace('#', '');
  const id = raw.split('/')[0];
  if (id === 'mejores' || id === 'hoy' || id === '') return 'partidos';
  if (id === 'aciertos') return 'stats';
  if (id === 'cuotas') return 'bandas';
  if (id === 'admin') return isAdminQueryEnabled() ? 'admin' : 'partidos';
  if (
    id === 'partidos' ||
    id === 'top3' ||
    id === 'stats' ||
    id === 'ligas' ||
    id === 'bandas' ||
    id === 'premium' ||
    id === 'perfil' ||
    id === 'ajustes' ||
    isLegalViewId(id)
  ) {
    return id;
  }
  return 'partidos';
}

let navIndicatorReady = false;

function syncNavIndicator({ instant = false } = {}) {
  const nav = document.querySelector('.v2-nav');
  const indicator = nav?.querySelector('.v2-nav__indicator');
  const active = nav?.querySelector('.v2-nav__link.is-active');
  if (!nav || !indicator) return;
  if (!active) {
    indicator.style.opacity = '0';
    return;
  }
  const navRect = nav.getBoundingClientRect();
  const linkRect = active.getBoundingClientRect();
  const left = linkRect.left - navRect.left + nav.scrollLeft;
  const width = linkRect.width;
  const snap = instant || prefersReducedMotion() || !navIndicatorReady;
  if (snap) {
    indicator.style.transition = 'none';
  }
  indicator.style.width = `${Math.max(0, width)}px`;
  indicator.style.transform = `translateX(${Math.max(0, left)}px)`;
  indicator.style.opacity = width > 0 ? '1' : '0';
  if (snap) {
    void indicator.offsetWidth;
    indicator.style.transition = '';
  }
  navIndicatorReady = true;
  try {
    active.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  } catch {
    /* ignore */
  }
}

function setActiveNav(hash, { pushHash = true } = {}) {
  const incoming = String(hash || '');
  const view = normalizeViewHash(incoming);
  const views = document.getElementById('views');
  if (views) views.dataset.view = view;
  const track = document.getElementById('views-track');
  if (track) track.style.transform = '';
  if (views) views.classList.remove('views--dragging');
  document.querySelectorAll('.v2-nav__link, .dock__link, .app-tabbar__link').forEach((link) => {
    const target = normalizeViewHash(link.getAttribute('href') || '');
    const href = link.getAttribute('href') || '';
    const active =
      target === view ||
      (view === 'bandas' && (href === '#cuotas' || href === '#bandas')) ||
      (view === 'premium' && false);
    link.classList.toggle('is-active', active);
    if (link.classList.contains('v2-nav__link') || link.classList.contains('app-tabbar__link')) {
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
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
  if (view === 'premium') syncPremiumView();
  if (view === 'perfil') syncPerfilView();
  if (view === 'admin') loadAdminPanel().catch(() => {});
  requestAnimationFrame(() => syncNavIndicator({ instant: !navIndicatorReady }));
}

function navigateAppHash(href) {
  const view = normalizeViewHash(href);
  if (!hasValidConsent()) {
    if (isLegalViewId(view)) openConsentGate({ docId: view });
    else openConsentGate();
    return;
  }
  setActiveNav(href);
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
  const marketCell = hbCensorWrap(
    `<span class="tip-accent">${escapeHtml(labelBet(leg.suggestedBet, home, away))}</span>
      <div class="muted weekly-table__when">${fam}</div>`
  );
  const oddsCell = hbCensorWrap(
    leg.tipOdds != null ? Number(leg.tipOdds).toFixed(2) : '—'
  );
  const pCasaCell = hbCensorWrap(pCasa);
  const pModelCell = hbCensorWrap(
    `<span class="${confClass(Number(leg.prob) * 100)}">${pModel}</span>`
  );
  const valorCell = hbCensorWrap(valor);
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
    <td>${marketCell}</td>
    <td>${oddsCell}</td>
    <td>${pCasaCell}</td>
    <td>${pModelCell}</td>
    <td>${valorCell}</td>
    <td class="muted">${src}</td>
  </tr>`;
}

function weeklyPricingShort(pricing) {
  if (pricing === 'book') return 'Casa';
  if (pricing === 'mixed') return 'Mixto';
  if (pricing === 'model') return 'Estimado';
  return pricing ? String(pricing) : '—';
}

function weeklyMetricCell(label, valueHtml) {
  return `<div class="perf-stat weekly-metric">
    <span class="perf-stat__v">${valueHtml}</span>
    <span class="perf-stat__k">${escapeHtml(label)}</span>
  </div>`;
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
  const noBook =
    pricing === 'model' ||
    (primary.bookRatio != null && Number(primary.bookRatio) < 0.15);
  const probClass = confClass(Number(primary.jointProbAdj ?? primary.jointProb) * 100);
  box.hidden = false;
  box.innerHTML = `
    <div class="weekly-summary__stats">
      ${weeklyMetricCell(
        'Cuota 10',
        hbCensorWrap(escapeHtml(Number(primary.combinedOdds).toFixed(2)))
      )}
      ${weeklyMetricCell(
        'Prob. combinada',
        hbCensorWrap(`<span class="${probClass}">${pAdj}</span>`)
      )}
      ${weeklyMetricCell('Selecciones', escapeHtml(String(primary.nLegs)))}
    </div>
    <div class="weekly-summary__stats weekly-summary__stats--secondary">
      ${weeklyMetricCell(
        'Ligas',
        primary.leagueCount != null ? escapeHtml(String(primary.leagueCount)) : '—'
      )}
      ${weeklyMetricCell('Origen', escapeHtml(weeklyPricingShort(pricing)))}
      ${weeklyMetricCell('Book', escapeHtml(noBook ? 'Sin' : 'Sí'))}
    </div>`;
}

let cachedWeeklyPayload = null;
let weeklyPickIndex = 0;
let weeklySeenIds = [];


const WEEKLY_LEAGUE_LABELS = {
  39: 'Premier League',
  140: 'LaLiga',
  141: 'LaLiga Hypermotion',
  135: 'Serie A',
  78: 'Bundesliga',
  61: 'Ligue 1',
  2: 'Champions League',
  3: 'Europa League',
  5: 'Liga de Naciones',
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
    <div class="weekly-summary__stats weekly-summary__stats--quad">
      ${weeklyMetricCell(
        'Cuota',
        hbCensorWrap(escapeHtml(Number(combo.combinedOdds).toFixed(2)))
      )}
      ${weeklyMetricCell(
        'Prob. combinada',
        hbCensorWrap(
          `<span class="${confClass(Number(combo.jointProbAdj) * 100)}">${pAdj}</span>`
        )
      )}
      ${weeklyMetricCell('Selecciones', escapeHtml(String(combo.nLegs)))}
      ${weeklyMetricCell('Origen', escapeHtml(weeklyPricingShort(combo.pricing)))}
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
              <td>${hbCensorWrap(
                `<span class="tip-accent">${escapeHtml(
                  labelBet(leg.suggestedBet, home, away)
                )}</span>`
              )}</td>
              <td>${hbCensorWrap(
                leg.tipOdds != null ? Number(leg.tipOdds).toFixed(2) : '—'
              )}</td>
              <td>${hbCensorWrap(
                leg.prob != null ? `${(Number(leg.prob) * 100).toFixed(0)}%` : '—'
              )}</td>
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
  openPanel(`<div class="muted">${escapeHtml(t('empty.loadingAnalysis'))}</div>`);
  try {
    const bundle = await api(`/api/v1/matches/${id}/prediction`);
    const p = bundle.prediction || {};
    const m = bundle.match || {};
    const homeName = m.homeTeam?.name || '';
    const awayName = m.awayTeam?.name || '';
    panelLiveCtx = { id: Number(id), homeName, awayName };
    const home = escapeHtml(homeName);
    const away = escapeHtml(awayName);
    const leagueLine = formatLeagueLine(
      m.leagueCountry || m.country || '',
      m.leagueName || m.league || '',
      m.leagueApiId ?? m.apiId
    );
    const tipOdds =
      bundle.tipOdds != null
        ? Number(bundle.tipOdds).toFixed(2)
        : tipOddsFromBundle(p.suggested_bet, bundle.odds);
    const tipTierBundle = bundle.tipTier || null;
    const tipProb = tipProbPct({
      ...p,
      suggestedBet: p.suggested_bet,
      suggested_bet: p.suggested_bet,
      confidenceScore: p.confidence_score,
      confidence_score: p.confidence_score,
      tipTier: tipTierBundle,
    });
    const goalsAvg =
      bundle.xg?.home != null && bundle.xg?.away != null
        ? Number((Number(bundle.xg.home) + Number(bundle.xg.away)).toFixed(2))
        : null;
    const cornersAvg =
      bundle.expected?.corners?.match ?? sumRecentAvg(bundle.recentAvgs, 'corners');
    const cardsAvg =
      bundle.expected?.cards?.match ?? sumRecentAvg(bundle.recentAvgs, 'yellows');
    const la = bundle.leagueAvgs || {};
    // Always 6 fixed General cards (placeholders —) — never filter empties.
    const keyCards = [
      pctStatCard(t('panel.over25'), p.over25_prob, la.over25Rate, MP_STAT_ICONS.o25),
      pctStatCard(t('panel.over15'), p.over15_prob, la.over15Rate, MP_STAT_ICONS.o15),
      pctStatCard(t('panel.btts'), p.btts_yes_prob, la.bttsRate, MP_STAT_ICONS.btts),
      avgStatCard(t('panel.avgGoals'), goalsAvg, 5, la.goals, MP_STAT_ICONS.goals),
      avgStatCard(t('panel.avgCorners'), cornersAvg, 12, la.corners, MP_STAT_ICONS.corners),
      avgStatCard(t('panel.avgCards'), cardsAvg, 6, la.cards, MP_STAT_ICONS.cards),
    ].join('');

    const tabBtns = [
      ['general', t('panel.tabGeneral')],
      ['goles', t('panel.tabGoals')],
      ['tiros', t('panel.tabShots')],
      ['tiros-puerta', t('panel.tabSot')],
      ['corners', t('panel.tabCorners')],
      ['tarjetas', t('panel.tabCards')],
    ].map(
        ([id, lab], i) =>
          `<button type="button" class="mp-tabs__btn${i === 0 ? ' is-active' : ''}" role="tab" data-mp-tab="${id}" aria-selected="${i === 0 ? 'true' : 'false'}">${lab}</button>`
      )
      .join('');

    const goalsXgHome = bundle.xg?.home != null ? Number(bundle.xg.home) : null;
    const goalsXgAway = bundle.xg?.away != null ? Number(bundle.xg.away) : null;
    const goalsRows = goalsTrendRows(p);
    const goalsUnderRows = goalsTrendUnderRows(p);
    const bttsBlock = bttsPanelHtml(p, { leagueRate: la.bttsRate });
    const goalsPanel = contentUnlocked()
      ? `${marketTrendUnlockedHtml({
          title: t('panel.goalsTitle'),
          totalLabel: t('panel.goalsExpected'),
          homeName,
          awayName,
          homeCrest: m.homeTeam?.logo,
          awayCrest: m.awayTeam?.logo,
          expected: {
            home: goalsXgHome,
            away: goalsXgAway,
            match:
              goalsXgHome != null && goalsXgAway != null
                ? Number((goalsXgHome + goalsXgAway).toFixed(2))
                : null,
          },
          beforeTablesHtml: bttsBlock,
          ladderRows: goalsRows,
          underRows: goalsUnderRows,
        })}${scoreGridHtml(bundle.scoreGrid, bundle.topScores, homeName, awayName)}`
      : `${hbCensorWrap(bttsBlock, { block: true })}${lockedTrendTableHtml({
          title: t('panel.trendsOf', { title: t('panel.goalsTitle') }),
          homeName,
          awayName,
          metrics: goalsRows,
        })}${lockedTrendTableHtml({
          title: t('panel.underTrendsOf', { title: t('panel.goalsTitle') }),
          homeName,
          awayName,
          metrics: goalsUnderRows,
        })}`;

    const totLines = [14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5, 21.5, 22.5, 23.5, 24.5];
    const sotLines = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5];
    const cornerLines = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5];
    const cardLines = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
    const tot = bundle.ladders?.totalShots || {};
    const totExp = bundle.expected?.totalShots || null;
    const totOuOpts = {
      homeLadder: tot.home,
      awayLadder: tot.away,
      matchLadder: tot.match,
      lambdaHome: totExp?.home,
      lambdaAway: totExp?.away,
      lambdaMatch: totExp?.match,
    };
    const totRows = buildOverRows(totLines, totOuOpts);
    const totUnderRows = buildUnderRows(totLines, totOuOpts);
    const sot = bundle.ladders?.shotsOnTarget || {};
    const sotExp = bundle.expected?.shotsOnTarget || null;
    const sotOuOpts = {
      homeLadder: sot.home,
      awayLadder: sot.away,
      matchLadder: sot.match,
      lambdaHome: sotExp?.home,
      lambdaAway: sotExp?.away,
      lambdaMatch: sotExp?.match,
    };
    const sotRows = buildOverRows(sotLines, sotOuOpts);
    const sotUnderRows = buildUnderRows(sotLines, sotOuOpts);
    const offTargetNote = (() => {
      const sides = ['home', 'away', 'match'];
      const parts = [];
      for (const side of sides) {
        const totL = totExp?.[side];
        const sotL = sotExp?.[side];
        if (totL == null || sotL == null) continue;
        const off = Math.max(0, Number(totL) - Number(sotL));
        if (!Number.isFinite(off)) continue;
        parts.push(off.toFixed(1));
      }
      if (parts.length < 3) return '';
      return escapeHtml(t('panel.offTarget', { h: parts[0], a: parts[1], m: parts[2] }));
    })();
    const shotsPanel = contentUnlocked()
      ? marketTrendUnlockedHtml({
          title: t('panel.shotsTitle'),
          totalLabel: t('panel.shotsExpected'),
          homeName,
          awayName,
          homeCrest: m.homeTeam?.logo,
          awayCrest: m.awayTeam?.logo,
          expected: totExp,
          ladderRows: totRows,
          underRows: totUnderRows,
          footerNote: offTargetNote,
        })
      : `${lockedTrendTableHtml({
          title: t('panel.trendsOf', { title: t('panel.shotsTitle') }),
          homeName,
          awayName,
          metrics: totRows,
        })}${lockedTrendTableHtml({
          title: t('panel.underTrendsOf', { title: t('panel.shotsTitle') }),
          homeName,
          awayName,
          metrics: totUnderRows,
        })}`;
    const sotPanel = contentUnlocked()
      ? marketTrendUnlockedHtml({
          title: t('panel.sotTitle'),
          totalLabel: t('panel.sotExpected'),
          homeName,
          awayName,
          homeCrest: m.homeTeam?.logo,
          awayCrest: m.awayTeam?.logo,
          expected: sotExp,
          ladderRows: sotRows,
          underRows: sotUnderRows,
        })
      : `${lockedTrendTableHtml({
          title: t('panel.trendsOf', { title: t('panel.sotTitle') }),
          homeName,
          awayName,
          metrics: sotRows,
        })}${lockedTrendTableHtml({
          title: t('panel.underTrendsOf', { title: t('panel.sotTitle') }),
          homeName,
          awayName,
          metrics: sotUnderRows,
        })}`;

    const cor = bundle.ladders?.corners || {};
    const corExp = bundle.expected?.corners || null;
    const corOuOpts = {
      homeLadder: cor.home,
      awayLadder: cor.away,
      matchLadder: cor.match,
      lambdaHome: corExp?.home,
      lambdaAway: corExp?.away,
      lambdaMatch: corExp?.match,
    };
    const cornerRows = buildOverRows(cornerLines, corOuOpts);
    const cornerUnderRows = buildUnderRows(cornerLines, corOuOpts);
    const cornersPanel = contentUnlocked()
      ? marketTrendUnlockedHtml({
          title: t('panel.cornersTitle'),
          totalLabel: t('panel.cornersExpected'),
          homeName,
          awayName,
          homeCrest: m.homeTeam?.logo,
          awayCrest: m.awayTeam?.logo,
          expected: corExp,
          ladderRows: cornerRows,
          underRows: cornerUnderRows,
        })
      : `${lockedTrendTableHtml({
          title: t('panel.trendsOf', { title: t('panel.cornersTitle') }),
          homeName,
          awayName,
          metrics: cornerRows,
        })}${lockedTrendTableHtml({
          title: t('panel.underTrendsOf', { title: t('panel.cornersTitle') }),
          homeName,
          awayName,
          metrics: cornerUnderRows,
        })}`;

    const cardL = bundle.ladders?.cards || {};
    const cardExp = bundle.expected?.cards || null;
    const cardOuOpts = {
      homeLadder: cardL.home,
      awayLadder: cardL.away,
      matchLadder: cardL.match,
      lambdaHome: cardExp?.home,
      lambdaAway: cardExp?.away,
      lambdaMatch: cardExp?.match,
    };
    const cardRows = buildOverRows(cardLines, cardOuOpts);
    const cardUnderRows = buildUnderRows(cardLines, cardOuOpts);
    const cardsPanel = contentUnlocked()
      ? marketTrendUnlockedHtml({
          title: t('panel.cardsTitle'),
          totalLabel: t('panel.cardsExpected'),
          homeName,
          awayName,
          homeCrest: m.homeTeam?.logo,
          awayCrest: m.awayTeam?.logo,
          expected: cardExp,
          ladderRows: cardRows,
          underRows: cardUnderRows,
        })
      : `${lockedTrendTableHtml({
          title: t('panel.trendsOf', { title: t('panel.cardsTitle') }),
          homeName,
          awayName,
          metrics: cardRows,
        })}${lockedTrendTableHtml({
          title: t('panel.underTrendsOf', { title: t('panel.cardsTitle') }),
          homeName,
          awayName,
          metrics: cardUnderRows,
        })}`;

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
          ${mpVsMidHtml(m, bundle.live)}
          ${mpTeamCol(awayName, m.awayTeam?.logo, 'away', bundle.form?.away)}
          ${liveEvents}
        </div>
        ${hbCensorWrap(
          `<div class="panel-suggest">
          <div class="panel-suggest__bet">${escapeHtml(
            labelBet(p.suggested_bet, homeName, awayName)
          )}</div>
          <div class="panel-suggest__meta">
            ${tipConfMetaHtml(tipProb, bundle.oddsSource || 'model')}
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
        </div>`,
          { block: true }
        )}
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
            <h3 class="mp-section-title">${escapeHtml(t('panel.keyProbs'))}</h3>
            <div class="mp-grid">${keyCards}</div>
            ${h2hHtml(bundle.h2h, homeName)}
            ${leagueTableHtml(bundle.leagueTable, homeName, awayName)}
          </div>
          <div class="mp-panel" data-mp-panel="goles" role="tabpanel" hidden>${goalsPanel}</div>
          <div class="mp-panel" data-mp-panel="tiros" role="tabpanel" hidden>${shotsPanel}</div>
          <div class="mp-panel" data-mp-panel="tiros-puerta" role="tabpanel" hidden>${sotPanel}</div>
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
  box.innerHTML = `<div class="search-panel__status">${escapeHtml(t('search.loading'))}</div>`;
  try {
    const data = await api(`/api/v1/teams/search?q=${encodeURIComponent(q.trim())}`);
    const teams = data.teams || [];
    if (!teams.length) {
      box.innerHTML = `<div class="search-panel__status">${escapeHtml(t('search.empty'))}</div>`;
      return;
    }
    box.innerHTML = teams
      .map(
        (t) => `
    <button class="search-hit" type="button" data-team="${Number(t.id)}" role="option">
      ${crestHtml(t.name, t.logo_url || t.logo, 'sm')}
      <span>
        <span class="search-hit__name">${escapeHtml(t.name)}</span>
        <span class="search-hit__meta">${escapeHtml(
          formatLeagueLine(t.league_country || t.country || '', t.league_name || '', t.league_api_id)
        )}</span>
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
    return summary;
  } catch (_) {
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
      refreshMpVsMid(root, freshMatch, data.live);
      refreshMpLiveEvents(root, freshMatch.events || [], freshMatch);
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

/** —— Auth modal (UI placeholder until real login/register) —— */
const AUTH_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let authLastFocus = null;
let authTab = 'login';
/** @type {{ id: string, username?: string|null, name: string, email: string, phone?: string|null, provider?: string } | null} */
let authUser = null;
let premiumUpsellTimer = null;
let premiumLastFocus = null;

function isAuthModalOpen() {
  const modal = document.getElementById('auth-modal');
  return Boolean(modal && !modal.hidden && modal.classList.contains('is-open'));
}

function setAuthModalNote(msg, isError = false) {
  const note = document.getElementById('auth-modal-note');
  if (!note) return;
  note.textContent = msg || '';
  note.classList.toggle('auth-modal__note--error', Boolean(isError && msg));
}

function setAuthTab(tab) {
  authTab = tab === 'register' ? 'register' : 'login';
  const title = document.getElementById('auth-modal-title');
  if (title) title.textContent = authTab === 'register' ? 'Registrarse' : 'Inicio de sesión';
  setAuthModalNote('');

  document.querySelectorAll('[data-auth-tab]').forEach((el) => {
    if (el.getAttribute('role') !== 'tab') return;
    const on = el.getAttribute('data-auth-tab') === authTab;
    el.classList.toggle('is-active', on);
    el.setAttribute('aria-selected', on ? 'true' : 'false');
    el.tabIndex = on ? 0 : -1;
  });

  document.querySelectorAll('[data-auth-panel]').forEach((panel) => {
    const on = panel.getAttribute('data-auth-panel') === authTab;
    panel.hidden = !on;
  });

  if (isAuthModalOpen()) {
    const first = document.getElementById(
      authTab === 'register' ? 'auth-register-username' : 'auth-login-identifier'
    );
    first?.focus({ preventScroll: true });
  }
}

function closeAccountMenu() {
  const menu = document.getElementById('account-menu');
  const trigger = document.getElementById('account-btn');
  if (menu) menu.hidden = true;
  if (trigger && !isAuthModalOpen()) trigger.setAttribute('aria-expanded', 'false');
}

async function openAccountMenu() {
  const menu = document.getElementById('account-menu');
  const trigger = document.getElementById('account-btn');
  if (!menu || !authUser) return;
  try {
    if (!premiumState.loaded) await loadPremiumState();
  } catch (_) {
    /* ignore */
  }
  const nameEl = document.getElementById('account-menu-name');
  const userEl = document.getElementById('account-menu-user');
  const emailEl = document.getElementById('account-menu-email');
  const premEl = document.getElementById('account-menu-premium');
  if (nameEl) nameEl.textContent = authUser.name || 'Cuenta';
  if (userEl) {
    userEl.textContent = authUser.username ? `@${authUser.username}` : '';
    userEl.hidden = !authUser.username;
  }
  if (emailEl) {
    emailEl.textContent = authUser.email || '';
    emailEl.hidden = !authUser.email;
  }
  syncPlanBadge(premEl, Boolean(premiumState.premium));
  menu.hidden = false;
  trigger?.setAttribute('aria-expanded', 'true');
  trigger?.setAttribute('aria-haspopup', 'menu');
  trigger?.setAttribute('aria-controls', 'account-menu');
}

function syncAccountButton() {
  const btn = document.getElementById('account-btn');
  const initial = document.getElementById('account-initial');
  if (!btn) return;
  if (authUser) {
    const letter = String(authUser.name || authUser.email || '?')
      .trim()
      .charAt(0)
      .toUpperCase();
    btn.classList.add('account-btn--user');
    btn.setAttribute('aria-label', `Cuenta de ${authUser.name || authUser.email}`);
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-controls', 'account-menu');
    if (initial) {
      initial.textContent = letter || '?';
      initial.hidden = false;
    }
  } else {
    btn.classList.remove('account-btn--user');
    btn.setAttribute('aria-label', 'Cuenta');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-controls', 'auth-modal');
    if (initial) {
      initial.textContent = '';
      initial.hidden = true;
    }
    closeAccountMenu();
  }
}

function setAuthUser(user) {
  const prev = authUser;
  authUser = user || null;
  syncAccountButton();
  if (Boolean(prev) !== Boolean(authUser)) {
    refreshTipsLockedViews();
  }
}

async function refreshAuthMe() {
  try {
    const data = await api('/api/v1/auth/me');
    setAuthUser(data.user || null);
    if (data.user?.premiumSanction) {
      showSanctionOverlay();
    }
    return authUser;
  } catch (_) {
    setAuthUser(null);
    return null;
  }
}

function isSanctionModalOpen() {
  const modal = document.getElementById('sanction-modal');
  return Boolean(modal && !modal.hidden && modal.classList.contains('is-open'));
}

function showSanctionOverlay() {
  const modal = document.getElementById('sanction-modal');
  if (!modal || isSanctionModalOpen()) return;
  const title = document.getElementById('sanction-modal-title');
  const copy = document.getElementById('sanction-modal-copy');
  const ack = document.getElementById('sanction-modal-ack');
  if (title) title.textContent = t('sanction.title');
  if (copy) copy.textContent = t('sanction.copy');
  if (ack) ack.textContent = t('sanction.ack');
  modal.hidden = false;
  modal.classList.add('is-open');
  document.body.classList.add('auth-open');
  requestAnimationFrame(() => {
    ack?.focus({ preventScroll: true });
  });
}

function closeSanctionOverlay() {
  const modal = document.getElementById('sanction-modal');
  if (!modal || !isSanctionModalOpen()) return;
  modal.classList.remove('is-open');
  modal.hidden = true;
  if (!isAuthModalOpen() && !isPremiumModalOpen() && !isSettingsModalOpen()) {
    document.body.classList.remove('auth-open');
  }
}

async function ackPremiumSanction() {
  try {
    await api('/api/v1/auth/premium-sanction/ack', { method: 'POST' });
  } catch (_) {
    /* still dismiss locally */
  }
  if (authUser) authUser.premiumSanction = false;
  closeSanctionOverlay();
}

function openAuthModal(tab = 'login') {
  if (!hasValidConsent()) return;
  if (authUser && !document.body.classList.contains('auth-required')) {
    openAccountMenu();
    return;
  }
  const modal = document.getElementById('auth-modal');
  const trigger = document.getElementById('account-btn');
  if (!modal) return;
  closeAccountMenu();
  authLastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : trigger;
  setAuthTab(tab);
  setAuthModalNote('');
  modal.hidden = false;
  modal.classList.add('is-open');
  document.body.classList.add('auth-open');
  trigger?.setAttribute('aria-expanded', 'true');
  trigger?.setAttribute('aria-haspopup', 'dialog');
  trigger?.setAttribute('aria-controls', 'auth-modal');
  requestAnimationFrame(() => {
    const first = document.getElementById(
      authTab === 'register' ? 'auth-register-username' : 'auth-login-identifier'
    );
    (first || document.getElementById('auth-modal-close'))?.focus({ preventScroll: true });
  });
}

function closeAuthModal() {
  if (document.body.classList.contains('auth-required') && !authUser) return;
  const modal = document.getElementById('auth-modal');
  const trigger = document.getElementById('account-btn');
  if (!modal || !isAuthModalOpen()) return;
  modal.classList.remove('is-open');
  modal.hidden = true;
  document.body.classList.remove('auth-open');
  trigger?.setAttribute('aria-expanded', 'false');
  syncAccountButton();
  const restore = authLastFocus && document.contains(authLastFocus) ? authLastFocus : trigger;
  restore?.focus({ preventScroll: true });
  authLastFocus = null;
}

function trapAuthFocus(e) {
  if (e.key !== 'Tab' || !isAuthModalOpen()) return;
  const modal = document.getElementById('auth-modal');
  const card = modal?.querySelector('.auth-modal__card');
  if (!card) return;
  const nodes = [...card.querySelectorAll(AUTH_FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  );
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

async function handleAuthLogin(e) {
  e.preventDefault();
  const form = e.target;
  const submit = document.getElementById('auth-login-submit');
  const identifier = form.identifier?.value || form.email?.value || '';
  const password = form.password?.value || '';
  setAuthModalNote('');
  if (submit) submit.disabled = true;
  try {
    const data = await api('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    setAuthUser(data.user);
    closeAuthModal();
    if (data.user?.premiumSanction) showSanctionOverlay();
    if (bootAwaitingAuth) {
      finishBootAfterAuth().catch(() => {});
    } else {
      loadPremiumState().then(() => refreshTipsLockedViews()).catch(() => {});
    }
  } catch (err) {
    setAuthModalNote(err.message || 'No se pudo iniciar sesión', true);
  } finally {
    if (submit) submit.disabled = false;
  }
}

function isPremiumModalOpen() {
  const modal = document.getElementById('premium-modal');
  return Boolean(modal && !modal.hidden && modal.classList.contains('is-open'));
}

function setPremiumModalNote(msg) {
  const note = document.getElementById('premium-modal-note');
  if (!note) return;
  note.textContent = msg || '';
}

async function openPremiumUpsellModal() {
  if (!premiumState.loaded) await loadPremiumState();
  if (premiumState.premium) return;
  const modal = document.getElementById('premium-modal');
  if (!modal) return;
  premiumLastFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : document.getElementById('account-btn');
  setPremiumModalNote('');
  const activate = document.getElementById('premium-modal-activate');
  if (activate) {
    activate.disabled = !premiumState.stripeConfigured;
    if (!premiumState.stripeConfigured) {
      setPremiumModalNote('Pago no configurado todavía. Podrás activarlo más adelante.');
    }
  }
  modal.hidden = false;
  modal.classList.add('is-open');
  document.body.classList.add('auth-open');
  requestAnimationFrame(() => {
    const focusEl = premiumState.stripeConfigured
      ? activate
      : document.getElementById('premium-modal-skip') || document.getElementById('premium-modal-close');
    focusEl?.focus({ preventScroll: true });
  });
}

function closePremiumUpsellModal() {
  const modal = document.getElementById('premium-modal');
  if (!modal || !isPremiumModalOpen()) return;
  modal.classList.remove('is-open');
  modal.hidden = true;
  if (!isAuthModalOpen() && !isSanctionModalOpen() && !isSettingsModalOpen()) {
    document.body.classList.remove('auth-open');
  }
  const restore =
    premiumLastFocus && document.contains(premiumLastFocus)
      ? premiumLastFocus
      : document.getElementById('account-btn');
  restore?.focus({ preventScroll: true });
  premiumLastFocus = null;
}

function trapPremiumFocus(e) {
  if (e.key !== 'Tab' || !isPremiumModalOpen()) return;
  const modal = document.getElementById('premium-modal');
  const card = modal?.querySelector('.auth-modal__card');
  if (!card) return;
  const nodes = [...card.querySelectorAll(AUTH_FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  );
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function schedulePostRegisterPremiumUpsell() {
  if (premiumUpsellTimer) clearTimeout(premiumUpsellTimer);
  premiumUpsellTimer = setTimeout(() => {
    premiumUpsellTimer = null;
    openPremiumUpsellModal().catch(() => {});
  }, 3000);
}

async function handleAuthRegister(e) {
  e.preventDefault();
  const form = e.target;
  const submit = document.getElementById('auth-register-submit');
  const payload = {
    username: form.username?.value || '',
    name: form.name?.value || '',
    phone: form.phone?.value || '',
    email: form.email?.value || '',
    password: form.password?.value || '',
    password2: form.password2?.value || '',
  };
  setAuthModalNote('');
  if (payload.password !== payload.password2) {
    setAuthModalNote('Las contraseñas no coinciden', true);
    return;
  }
  if (submit) submit.disabled = true;
  try {
    const data = await api('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setAuthUser(data.user);
    closeAuthModal();
    if (bootAwaitingAuth) {
      finishBootAfterAuth().catch(() => {});
    } else {
      loadPremiumState().then(() => refreshTipsLockedViews()).catch(() => {});
    }
    schedulePostRegisterPremiumUpsell();
  } catch (err) {
    setAuthModalNote(err.message || 'No se pudo crear la cuenta', true);
  } finally {
    if (submit) submit.disabled = false;
  }
}

function handleAuthGoogle(e) {
  e.preventDefault();
  setAuthModalNote('');
  window.location.href = '/api/v1/auth/google/start';
}

async function handleAuthLogout() {
  closeAccountMenu();
  closeSettingsModal();
  try {
    await api('/api/v1/auth/logout', { method: 'POST' });
  } catch (_) {
    /* still clear local */
  }
  setAuthUser(null);
  premiumState.premium = false;
  premiumState.plan = 'free';
  bootAwaitingAuth = true;
  openAuthRequiredGate();
}

function handleAuthQueryFlags() {
  const params = new URLSearchParams(location.search);
  const flag = params.get('auth');
  if (!flag) return;
  params.delete('auth');
  const next = `${location.pathname}${params.toString() ? `?${params}` : ''}${location.hash || ''}`;
  history.replaceState(null, '', next || '/');
  if (flag === 'ok') {
    /* Google return — session cookie set; boot continues via refreshAuthMe */
  } else if (flag === 'google_unconfigured') {
    showBanner('Google no está configurado en el servidor todavía.', 'error');
  } else if (flag === 'google_state' || flag === 'google_error') {
    showBanner(t('toast.googleFail'), 'error');
  }
}

function goPremiumFromCensor(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (!authUser) {
    openAuthModal('login');
    return;
  }
  const panel = document.getElementById('panel');
  if (panel?.classList.contains('is-open')) closePanel();
  navigateAppHash('#premium');
}

document.addEventListener(
  'click',
  (e) => {
    const goPrem = e.target.closest?.('[data-go-premium], [data-hb-censor]');
    if (!goPrem) return;
    goPremiumFromCensor(e);
  },
  true
);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const goPrem = e.target.closest?.('[data-go-premium], [data-hb-censor]');
  if (!goPrem) return;
  goPremiumFromCensor(e);
});

document.getElementById('account-btn')?.addEventListener('click', () => {
  if (authUser) {
    const menu = document.getElementById('account-menu');
    if (menu && !menu.hidden) closeAccountMenu();
    else openAccountMenu();
    return;
  }
  openAuthModal('login');
});
document.getElementById('account-logout')?.addEventListener('click', () => {
  handleAuthLogout().catch(() => {});
});
document.getElementById('account-perfil')?.addEventListener('click', (e) => {
  e.preventDefault();
  closeAccountMenu();
  navigateAppHash('#perfil');
});
document.getElementById('account-settings')?.addEventListener('click', () => {
  closeAccountMenu();
  openSettingsModal();
});
document.getElementById('account-telegram')?.addEventListener('click', (e) => {
  e.preventDefault();
  showBanner(t('toast.telegramSoon'), 'info');
});
document.getElementById('account-ajustes')?.addEventListener('click', (e) => {
  e.preventDefault();
  closeAccountMenu();
  navigateAppHash('#ajustes');
});
async function redeemPerfilPromo() {
  if (!authUser) {
    showBanner(t('perfil.promoNeedAuth'), 'error');
    return;
  }
  const input = document.getElementById('perfil-promo-input');
  const btn = document.getElementById('perfil-promo-btn');
  const code = String(input?.value || '').trim();
  if (!code) {
    showBanner(t('perfil.promoBad'), 'error');
    return;
  }
  if (btn) btn.disabled = true;
  try {
    const data = await api('/api/v1/premium/promo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (input) input.value = '';
    await loadPremiumState();
    syncPerfilView();
    syncPremiumView();
    refreshTipsLockedViews();
    let okMsg = t('perfil.promoOk');
    if (data.kind === 'discount' || data.percentOff) {
      okMsg = t('perfil.promoOkDiscount', { pct: String(data.percentOff || '') });
      navigateAppHash('#premium');
    } else if (data.type === 'free_month') {
      okMsg = t('perfil.promoOkMonth');
    } else if (data.days) {
      okMsg = t('perfil.promoOkDays', { days: String(data.days) });
    }
    showBanner(okMsg, 'ok');
  } catch (err) {
    const codeErr = err?.code || '';
    let msg = t('perfil.promoBad');
    if (codeErr === 'already_used') msg = t('perfil.promoUsed');
    else if (codeErr === 'expired' || codeErr === 'exhausted') msg = t('perfil.promoExpired');
    else if (codeErr === 'auth_required' || err?.message?.includes?.('autentic')) {
      msg = t('perfil.promoNeedAuth');
    } else if (err?.message) msg = err.message;
    showBanner(msg, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}
document.getElementById('perfil-promo-btn')?.addEventListener('click', () => {
  redeemPerfilPromo();
});
document.getElementById('perfil-promo-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    redeemPerfilPromo();
  }
});
document.getElementById('perfil-logout')?.addEventListener('click', () => {
  handleAuthLogout().catch(() => {});
});
document.getElementById('perfil-delete')?.addEventListener('click', () => {
  deleteOwnAccount().catch(() => {});
});
document.getElementById('perfil-open-settings')?.addEventListener('click', () => {
  openSettingsModal();
});
document.getElementById('perfil-telegram')?.addEventListener('click', () => {
  showBanner(t('toast.telegramSoon'), 'info');
});
document.getElementById('settings-modal-close')?.addEventListener('click', closeSettingsModal);
document.querySelectorAll('[data-settings-close]').forEach((el) => {
  el.addEventListener('click', (e) => {
    if (el.hasAttribute('data-go-ajustes')) {
      e.preventDefault();
      closeSettingsModal();
      navigateAppHash('#ajustes');
      return;
    }
    closeSettingsModal();
  });
});
document.getElementById('settings-save')?.addEventListener('click', () => {
  const lang =
    document.querySelector('[name="settings-lang"]:checked')?.value || 'es';
  const timezone =
    document.querySelector('[name="settings-tz"]:checked')?.value || 'Europe/Madrid';
  saveUiSettings({ lang, theme: 'dark', timezone });
  refreshUiAfterLangChange();
  closeSettingsModal();
  showBanner(t('settings.saved'), 'info');
});
document.getElementById('ajustes-close')?.addEventListener('click', () => {
  navigateAppHash('#partidos');
});
document.addEventListener('click', (e) => {
  const wrap = document.querySelector('.account-wrap');
  if (!wrap || wrap.contains(e.target)) return;
  closeAccountMenu();
});
document.getElementById('ligas-panel-close')?.addEventListener('click', () => {
  hideLigasTable({ pushHash: true });
});
document.getElementById('ligas-panel-backdrop')?.addEventListener('click', () => {
  hideLigasTable({ pushHash: true });
});
document.getElementById('auth-modal-close')?.addEventListener('click', closeAuthModal);
document.querySelector('#auth-modal [data-auth-close]')?.addEventListener('click', (e) => {
  if (document.body.classList.contains('auth-required') && !authUser) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  closeAuthModal();
});
document.querySelectorAll('[data-auth-tab]').forEach((el) => {
  el.addEventListener('click', () => setAuthTab(el.getAttribute('data-auth-tab') || 'login'));
});
document.getElementById('auth-form-login')?.addEventListener('submit', (e) => {
  handleAuthLogin(e).catch(() => {});
});
document.getElementById('auth-form-register')?.addEventListener('submit', (e) => {
  handleAuthRegister(e).catch(() => {});
});
document.getElementById('auth-google')?.addEventListener('click', handleAuthGoogle);
document.getElementById('auth-telegram')?.addEventListener('click', (e) => {
  e.preventDefault();
  showBanner(t('toast.telegramSoon'), 'info');
});

document.getElementById('premium-modal-close')?.addEventListener('click', closePremiumUpsellModal);
document.querySelectorAll('[data-premium-close]').forEach((el) => {
  el.addEventListener('click', closePremiumUpsellModal);
});
document.getElementById('premium-modal-activate')?.addEventListener('click', () => {
  startPremiumCheckout().catch(() => {});
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (isSettingsModalOpen()) {
      e.preventDefault();
      closeSettingsModal();
      return;
    }
    if (isPremiumModalOpen()) {
      e.preventDefault();
      closePremiumUpsellModal();
      return;
    }
    if (isAuthModalOpen()) {
      e.preventDefault();
      closeAuthModal();
      return;
    }
    const menu = document.getElementById('account-menu');
    if (menu && !menu.hidden) {
      e.preventDefault();
      closeAccountMenu();
      return;
    }
    if (document.getElementById('ligas-panel')?.classList.contains('is-open')) {
      e.preventDefault();
      hideLigasTable({ pushHash: true });
      return;
    }
    if (document.getElementById('panel')?.classList.contains('is-open')) {
      closePanel();
    }
    return;
  }
  if (isPremiumModalOpen()) trapPremiumFocus(e);
  else trapAuthFocus(e);
});

document
  .querySelectorAll(
    'a.v2-nav__link, a.dock__link, a.app-tabbar__link, a.brand, a.premium-chip, a.aciertos-sub__link, a.aciertos-bar__link, a.ajustes-bar__link, a.site-footer__link, a.legal-nav__link'
  )
  .forEach((link) => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href') || '';
      if (!href.startsWith('#')) return;
      e.preventDefault();
      navigateAppHash(href);
    });
  });

document.getElementById('consent-accept-all')?.addEventListener('click', () => {
  acceptConsent('all');
});
document.getElementById('consent-necessary')?.addEventListener('click', () => {
  acceptConsent('necessary');
});
document.getElementById('consent-customize')?.addEventListener('click', () => {
  openConsentCustom();
});
document.getElementById('consent-custom-back')?.addEventListener('click', () => {
  closeConsentCustom();
});
document.getElementById('consent-save-custom')?.addEventListener('click', () => {
  acceptConsent('custom');
});
document.getElementById('consent-age')?.addEventListener('change', () => {
  syncConsentAgeCheckboxes('main');
});
document.getElementById('consent-age-custom')?.addEventListener('change', () => {
  syncConsentAgeCheckboxes('custom');
});
document.getElementById('consent-doc-back')?.addEventListener('click', () => {
  closeConsentDoc();
});
document.querySelectorAll('[data-consent-doc]').forEach((btn) => {
  btn.addEventListener('click', () => {
    openConsentDoc(btn.getAttribute('data-consent-doc') || 'privacidad');
  });
});
/* Backdrop must never dismiss the gate — refusal leaves the app locked. */
document.querySelector('#consent-gate .consent-gate__backdrop')?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
});
document.getElementById('btn-manage-cookies')?.addEventListener('click', () => {
  navigateAppHash('#ajustes');
  requestAnimationFrame(() => {
    document.getElementById('privacy-toggles')?.scrollIntoView({
      block: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
    document.getElementById('pref-analytics')?.focus();
  });
});
document.getElementById('btn-clear-device-data')?.addEventListener('click', () => {
  const ok = window.confirm(
    '¿Borrar consentimiento, preferencias, búsqueda y filtros de este dispositivo? Tendrás que aceptar de nuevo.'
  );
  if (!ok) return;
  clearDevicePrivacyData();
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
  if (
    v === 'bandas' ||
    v === 'ajustes' ||
    v === 'premium' ||
    v === 'privacidad' ||
    v === 'cookies' ||
    v === 'aviso' ||
    v === 'condiciones'
  ) {
    return -1;
  }
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
  if (!hasValidConsent()) return;
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
  if (!hasValidConsent()) {
    const view = normalizeViewHash(h);
    openConsentGate({ docId: isLegalViewId(view) ? view : null });
    return;
  }
  setActiveNav(h, { pushHash: false });
  reportPageHit();
});

window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    loadConsent();
    if (!hasValidConsent()) {
      const view = normalizeViewHash(location.hash || '');
      openConsentGate({ docId: isLegalViewId(view) ? view : null });
      return;
    }
    setActiveNav(location.hash || '#partidos', { pushHash: false });
  }
});

loadConsent();
loadPrivacyPrefs();
if (hasValidConsent()) {
  document.documentElement.classList.remove('consent-needed');
} else {
  document.documentElement.classList.add('consent-needed');
}
restoreFiltersIfAllowed();
syncWindowChips();
syncLiveChip();
syncPrivacyToggles();

bindCuotasTargetControls();
{
  const bootHash = location.hash || '#partidos';
  const bootView = normalizeViewHash(bootHash);
  if (!hasValidConsent()) {
    setActiveNav('#partidos', { pushHash: false });
    openConsentGate({ docId: isLegalViewId(bootView) ? bootView : null });
  } else {
    setActiveNav(bootHash, { pushHash: false });
  }
}

(function bindNavIndicatorLayout() {
  const nav = document.querySelector('.v2-nav');
  if (!nav) return;
  const snap = () => syncNavIndicator({ instant: true });
  window.addEventListener('resize', snap);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(snap);
    ro.observe(nav);
  }
  document.fonts?.ready?.then?.(snap);
})();

document.querySelectorAll('.market-tabs__btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    hoyMarketTab = btn.dataset.market || 'top';
    syncMarketTabs();
    renderHoyBoard();
  });
});

const ADMIN_SECRET_KEY = 'hb_admin_sync_secret';

function getStoredAdminSecret() {
  try {
    return sessionStorage.getItem(ADMIN_SECRET_KEY) || '';
  } catch (_) {
    return '';
  }
}

function setStoredAdminSecret(secret) {
  try {
    if (secret) sessionStorage.setItem(ADMIN_SECRET_KEY, secret);
    else sessionStorage.removeItem(ADMIN_SECRET_KEY);
  } catch (_) {
    /* ignore */
  }
}

function askSyncSecret() {
  const cached = getStoredAdminSecret();
  const entered = prompt('Clave de actualización (SYNC_SECRET):', cached || '');
  if (entered == null) return null;
  const secret = String(entered).trim();
  if (secret) setStoredAdminSecret(secret);
  return secret;
}

function escapeAdminHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatAdminDate(iso) {
  if (!iso) return '—';
  const d = String(iso);
  return d.length >= 16 ? d.slice(0, 16).replace('T', ' ') : d;
}

async function adminApi(path, { method = 'GET', body, secret } = {}) {
  const key = secret != null ? secret : askSyncSecret();
  if (key == null || !key) throw new Error('Clave cancelada');
  const opts = {
    method,
    headers: { 'x-sync-secret': key },
  };
  if (body != null) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return api(path, opts);
}

function renderAdminUsage(data) {
  const el = document.getElementById('admin-usage');
  if (!el) return;
  if (!data || data.configured === false) {
    el.innerHTML =
      '<p><strong>Métricas CF no configuradas</strong></p><p class="muted">Añade secrets <code>CF_ACCOUNT_ID</code> y <code>CF_API_TOKEN</code> en Wrangler.</p>';
    return;
  }
  if (data.error) {
    el.innerHTML = `<p><strong>Error de métricas</strong></p><p class="muted">${escapeAdminHtml(data.error)}</p>`;
    return;
  }
  el.innerHTML = `
    <p class="muted">Worker <code>${escapeAdminHtml(data.scriptName || 'houdini-bet')}</code> · hoy UTC ${escapeAdminHtml(data.day || '')}</p>
    <p><strong>${Number(data.requests) || 0}</strong> consultas</p>
    <p class="muted">Errores: ${Number(data.errors) || 0}</p>`;
}

function renderAdminUsers(users) {
  const body = document.getElementById('admin-users-body');
  if (!body) return;
  const list = Array.isArray(users) ? users : [];
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="9" class="muted">Sin cuentas</td></tr>';
    return;
  }
  body.innerHTML = list
    .map((u) => {
      const id = escapeAdminHtml(u.id);
      const handle = escapeAdminHtml(u.username || '—');
      const disabled = Boolean(u.disabled);
      const status = disabled
        ? '<span class="admin-badge admin-badge--off">Deshabilitado</span>'
        : '<span class="admin-badge admin-badge--ok">Activo</span>';
      const toggleBtn = disabled
        ? `<button type="button" class="btn" data-admin-enable="${id}">Reactivar</button>`
        : `<button type="button" class="btn" data-admin-revoke="${id}">Cerrar acceso</button>`;
      return `<tr data-user-id="${id}">
        <td>${handle}</td>
        <td>${escapeAdminHtml(u.name)}</td>
        <td>${escapeAdminHtml(u.email)}</td>
        <td>${escapeAdminHtml(u.phone || '—')}</td>
        <td>${escapeAdminHtml(u.provider || '—')}</td>
        <td>${escapeAdminHtml(formatAdminDate(u.created_at))}</td>
        <td>N/A</td>
        <td>${status}</td>
        <td><div class="admin-users-table__actions">${toggleBtn}
          <button type="button" class="btn" data-admin-delete="${id}" data-admin-confirm="${escapeAdminHtml(u.username || u.id)}">Eliminar</button>
        </div></td>
      </tr>`;
    })
    .join('');
}

async function loadAdminPanel() {
  if (!isAdminQueryEnabled()) return;
  const usageEl = document.getElementById('admin-usage');
  const body = document.getElementById('admin-users-body');
  if (usageEl) usageEl.innerHTML = '<p class="muted">Cargando métricas…</p>';
  if (body) body.innerHTML = '<tr><td colspan="9" class="muted">Cargando…</td></tr>';
  const secret = askSyncSecret();
  if (secret == null || !secret) {
    if (usageEl) usageEl.innerHTML = '<p class="muted">Clave cancelada</p>';
    if (body) body.innerHTML = '<tr><td colspan="9" class="muted">Clave cancelada</td></tr>';
    return;
  }
  try {
    const [usage, usersRes] = await Promise.all([
      adminApi('/api/v1/admin/usage/today', { secret }),
      adminApi('/api/v1/admin/users', { secret }),
    ]);
    renderAdminUsage(usage);
    renderAdminUsers(usersRes.users || []);
  } catch (err) {
    if (usageEl) {
      usageEl.innerHTML = `<p class="muted">${escapeAdminHtml(err.message || 'Error')}</p>`;
    }
    if (body) {
      body.innerHTML = `<tr><td colspan="9" class="muted">${escapeAdminHtml(err.message || 'Error')}</td></tr>`;
    }
    showBanner(err.message || 'Error admin', 'error');
  }
}

async function adminRevokeUser(id) {
  if (!confirm('¿Cerrar acceso a esta cuenta? Se invalidarán sus sesiones.')) return;
  await adminApi(`/api/v1/admin/users/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
  showBanner('Acceso cerrado', 'ok');
  await loadAdminPanel();
}

async function adminEnableUser(id) {
  if (!confirm('¿Reactivar esta cuenta?')) return;
  await adminApi(`/api/v1/admin/users/${encodeURIComponent(id)}/enable`, { method: 'POST' });
  showBanner('Cuenta reactivada', 'ok');
  await loadAdminPanel();
}

async function adminDeleteUser(id, confirmToken) {
  const token = String(confirmToken || id);
  if (
    !confirm(
      `¿Eliminar permanentemente la cuenta «${token}»?\n\nNo se puede deshacer. En el siguiente paso deberás escribir el usuario (o el id).`
    )
  ) {
    return;
  }
  const typed = prompt(`Escribe exactamente el usuario «${token}» (o el id) para confirmar el borrado:`);
  if (typed == null) {
    showBanner('Eliminación cancelada', 'error');
    return;
  }
  const raw = String(typed).trim();
  const norm = (s) => String(s || '').trim().toLowerCase();
  if (norm(raw) !== norm(token) && raw !== String(id).trim()) {
    showBanner('Confirmación incorrecta; no se eliminó', 'error');
    return;
  }
  await adminApi(`/api/v1/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
  showBanner('Cuenta eliminada', 'ok');
  await loadAdminPanel();
}

(function initAdminFold() {
  const fold = document.getElementById('admin-fold');
  const adminView = document.getElementById('admin');
  const adminOn = isAdminQueryEnabled();
  if (fold && adminOn) {
    fold.classList.remove('hidden');
    fold.open = true;
    fold.style.opacity = '1';
  }
  if (adminView) {
    if (adminOn) {
      adminView.hidden = false;
      adminView.removeAttribute('hidden');
      let robots = document.querySelector('meta[name="robots"]');
      if (!robots) {
        robots = document.createElement('meta');
        robots.setAttribute('name', 'robots');
        document.head.appendChild(robots);
      }
      robots.setAttribute('content', 'noindex,nofollow');
      if ((location.hash || '').replace('#', '').split('/')[0] === 'admin') {
        setActiveNav('#admin', { pushHash: false });
      }
    } else {
      adminView.hidden = true;
    }
  }
})();

document.getElementById('admin-refresh')?.addEventListener('click', () => {
  loadAdminPanel().catch((err) => showBanner(err.message || 'Error', 'error'));
});

document.getElementById('admin-users-body')?.addEventListener('click', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  const revoke = t.getAttribute('data-admin-revoke');
  const enable = t.getAttribute('data-admin-enable');
  const del = t.getAttribute('data-admin-delete');
  if (revoke) {
    adminRevokeUser(revoke).catch((err) => showBanner(err.message || 'Error', 'error'));
  } else if (enable) {
    adminEnableUser(enable).catch((err) => showBanner(err.message || 'Error', 'error'));
  } else if (del) {
    const confirmTok = t.getAttribute('data-admin-confirm') || del;
    adminDeleteUser(del, confirmTok).catch((err) => showBanner(err.message || 'Error', 'error'));
  }
});

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

window.addEventListener('resize', () => {
  if (!document.body.classList.contains('has-ligas-selection')) return;
  if (isLigasDesktopSplit()) {
    closeLigasMobileOverlay();
    mountLigasDetailHost();
    const detail = document.getElementById('ligas-detail');
    if (detail) detail.hidden = false;
  } else {
    openLigasMobileOverlay();
  }
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
  leaguesPanelOpen = true;
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
  syncConsentChoiceFromPrefs();
  trackEvent('privacy_analytics', { enabled: privacyPrefs.analytics });
});

document.getElementById('pref-save-search')?.addEventListener('change', (e) => {
  privacyPrefs.saveSearch = !!e.target.checked;
  savePrivacyPrefs();
  syncPrivacyToggles();
  syncConsentChoiceFromPrefs();
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
  syncConsentChoiceFromPrefs();
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
  if (!hasValidConsent()) {
    const view = normalizeViewHash(location.hash || '');
    openConsentGate({ docId: isLegalViewId(view) ? view : null });
  }
  if (!splash) return;
  splash.classList.add('is-done');
  const finish = () => {
    splash.hidden = true;
    splash.setAttribute('aria-hidden', 'true');
  };
  splash.addEventListener('transitionend', finish, { once: true });
  window.setTimeout(finish, 450);
}

let bootAwaitingAuth = false;

function openAuthRequiredGate() {
  document.body.classList.add('auth-required');
  const closeBtn = document.getElementById('auth-modal-close');
  if (closeBtn) closeBtn.hidden = true;
  openAuthModal('login');
}

function closeAuthRequiredGate() {
  document.body.classList.remove('auth-required');
  const closeBtn = document.getElementById('auth-modal-close');
  if (closeBtn) closeBtn.hidden = false;
  closeAuthModal();
}

function startAppAfterConsent() {
  if (!hasValidConsent() || appBootStarted) return;
  appBootStarted = true;
  startLivePoll();
  trackEvent('session_start');
  reportPageHit();
  bootApp().catch(() => {});
}

async function finishBootAfterAuth() {
  bootAwaitingAuth = false;
  closeAuthRequiredGate();
  const splashLabel = document.querySelector('.boot-splash__label');
  try {
    await handlePremiumReturn();
    await loadPremiumState();
    applyUiSettings();
    syncPremiumView();
    syncPerfilView();
    if (authUser?.premiumSanction) showSanctionOverlay();
    await load();
    if (splashLabel) splashLabel.textContent = 'Listo';
    await waitForFirstPaint();
    dismissBootSplash();
  } catch (err) {
    showBanner(err.message || 'Error al cargar', 'error');
    dismissBootSplash();
  }
}

document.getElementById('sanction-modal-ack')?.addEventListener('click', () => {
  ackPremiumSanction().catch(() => {});
});

applyUiSettings();

async function bootApp() {
  const splashLabel = document.querySelector('.boot-splash__label');
  if (splashLabel) splashLabel.textContent = 'Cargando partidos y datos…';
  try {
    await waitForBootAssets();
    applyUiSettings();
    handleAuthQueryFlags();
    await refreshAuthMe();
    if (!authUser) {
      bootAwaitingAuth = true;
      dismissBootSplash();
      openAuthRequiredGate();
      return;
    }
    /* Google OAuth return (?auth=ok) lands here with session already set */
    await finishBootAfterAuth();
  } catch (err) {
    showBanner(err.message || 'Error al cargar', 'error');
    const el = document.getElementById('matches');
    if (el) {
      el.innerHTML = `<div class="empty-board conf-lo">No se pudo iniciar la página. Recarga e inténtalo de nuevo.</div>`;
    }
    dismissBootSplash();
  }
}

if (hasValidConsent()) {
  startAppAfterConsent();
} else {
  // Splash stays hidden under consent lock; dismiss so gate is the only surface.
  dismissBootSplash();
}
