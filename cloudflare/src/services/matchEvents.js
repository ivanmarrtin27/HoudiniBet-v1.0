/**
 * Normalize match incidents (goals / red cards / missed pens) from AF or FotMob.
 */

import { FOTMOB_MATCH_API_BASE, FOTMOB_LEAGUE_API_BASE } from './fotmobInternationals.js';
import { FOTMOB_DOMESTIC_MATCH_BASE } from './fotmobDomestic.js';

export function fotmobMatchIdFromApiId(apiId) {
  const n = Number(apiId);
  if (!Number.isFinite(n)) return null;
  if (n >= FOTMOB_DOMESTIC_MATCH_BASE && n < FOTMOB_DOMESTIC_MATCH_BASE + 50_000_000) {
    return n - FOTMOB_DOMESTIC_MATCH_BASE;
  }
  if (n >= FOTMOB_MATCH_API_BASE && n < FOTMOB_LEAGUE_API_BASE) {
    return n - FOTMOB_MATCH_API_BASE;
  }
  return null;
}

function pushEvent(out, ev) {
  if (!ev || !ev.type || ev.minute == null) return;
  out.push({
    type: ev.type,
    minute: Number(ev.minute),
    player: ev.player || null,
    isHome: Boolean(ev.isHome),
    detail: ev.detail || null,
  });
}

function namesMatch(a, b) {
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/** API-Football fixtures/events response → compact list. */
export function normalizeAfEvents(response, homeTeamId, awayTeamId, homeName = '', awayName = '') {
  const rows = response?.response || response || [];
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    const type = String(row.type || '');
    const detail = String(row.detail || '');
    const minute = row.time?.elapsed != null ? Number(row.time.elapsed) : null;
    const player = row.player?.name || null;
    const teamId = row.team?.id != null ? Number(row.team.id) : null;
    const teamName = row.team?.name || '';
    let isHome = true;
    if (homeTeamId != null && teamId === Number(homeTeamId)) isHome = true;
    else if (awayTeamId != null && teamId === Number(awayTeamId)) isHome = false;
    else if (namesMatch(teamName, awayName)) isHome = false;
    else if (namesMatch(teamName, homeName)) isHome = true;
    else isHome = true;

    if (type === 'Goal') {
      if (/Missed Penalty/i.test(detail)) {
        pushEvent(out, { type: 'missed_pen', minute, player, isHome, detail });
      } else if (/Own Goal/i.test(detail)) {
        pushEvent(out, { type: 'goal', minute, player, isHome, detail: 'own' });
      } else {
        pushEvent(out, {
          type: 'goal',
          minute,
          player,
          isHome,
          detail: /Penalty/i.test(detail) ? 'pen' : null,
        });
      }
    } else if (type === 'Card' && /Red|Second Yellow/i.test(detail)) {
      pushEvent(out, { type: 'red', minute, player, isHome, detail });
    }
  }
  return out.sort((a, b) => a.minute - b.minute || String(a.type).localeCompare(b.type));
}

/** Flatten FotMob goal/card maps: { "Surname": [ event, ... ] } or []. */
function flattenFotmobSide(bucket) {
  if (!bucket) return [];
  if (Array.isArray(bucket)) return bucket;
  if (typeof bucket === 'object') {
    return Object.values(bucket).flatMap((v) => (Array.isArray(v) ? v : [v]));
  }
  return [];
}

function fotmobGoalEvent(g, isHome) {
  const minute = Number(g.time ?? g.minute ?? g.timeStr ?? g.clock?.minute);
  const player =
    g.fullName || g.nameStr || g.name || g.playerName || g.player?.name || null;
  const gt = String(g.goalDescription || g.goalDescriptionKey || g.type || '');
  const own = g.ownGoal === true || /Own|own/i.test(gt);
  const pen = /Pen|pen/i.test(gt) || g.isPenalty === true;
  if (/Missed|missed/i.test(gt) || g.type === 'MissedPenalty') {
    return { type: 'missed_pen', minute, player, isHome };
  }
  return {
    type: 'goal',
    minute,
    player,
    isHome,
    detail: own ? 'own' : pen ? 'pen' : null,
  };
}

/** FotMob matchDetails header.events → compact list. */
export function normalizeFotmobEvents(details) {
  const events = details?.header?.events;
  if (!events) return [];
  const out = [];
  for (const g of flattenFotmobSide(events.homeTeamGoals || events.homeGoals)) {
    pushEvent(out, fotmobGoalEvent(g, true));
  }
  for (const g of flattenFotmobSide(events.awayTeamGoals || events.awayGoals)) {
    pushEvent(out, fotmobGoalEvent(g, false));
  }
  for (const c of flattenFotmobSide(events.homeTeamRedCards)) {
    const minute = Number(c.time ?? c.minute ?? c.timeStr);
    const player = c.fullName || c.nameStr || c.name || c.player?.name || null;
    pushEvent(out, { type: 'red', minute, player, isHome: true });
  }
  for (const c of flattenFotmobSide(events.awayTeamRedCards)) {
    const minute = Number(c.time ?? c.minute ?? c.timeStr);
    const player = c.fullName || c.nameStr || c.name || c.player?.name || null;
    pushEvent(out, { type: 'red', minute, player, isHome: false });
  }
  for (const c of flattenFotmobSide(events.cardEvents || events.cards)) {
    const card = String(c.card || c.type || '');
    if (!/Red|Second Yellow/i.test(card)) continue;
    const minute = Number(c.time ?? c.minute);
    const player = c.fullName || c.name || c.playerName || null;
    const isHome = c.isHome != null ? Boolean(c.isHome) : c.team === 1;
    pushEvent(out, { type: 'red', minute, player, isHome });
  }
  return out.sort((a, b) => a.minute - b.minute || String(a.type).localeCompare(b.type));
}

function fotmobStatRows(details) {
  const groups = details?.content?.stats?.Periods?.All?.stats || [];
  return groups.flatMap((group) => (Array.isArray(group?.stats) ? group.stats : []));
}

function fotmobStatPair(details, keys) {
  const wanted = new Set((keys || []).map((key) => String(key).toLowerCase()));
  const row = fotmobStatRows(details).find((item) => {
    const key = String(item?.key || '').toLowerCase();
    const title = String(item?.title || '').toLowerCase();
    return wanted.has(key) || wanted.has(title);
  });
  const values = row?.rawStats || row?.stats;
  if (!Array.isArray(values) || values.length < 2) return [null, null];
  return values.slice(0, 2).map((value) => {
    if (value && typeof value === 'object' && 'value' in value) value = value.value;
    if (value == null || value === '') return null;
    const match = String(value).match(/-?\d+(?:\.\d+)?/);
    const n = match ? Number(match[0]) : NaN;
    return Number.isFinite(n) ? n : null;
  });
}

/** FotMob matchDetails → home/away totals used by the extra-market models. */
export function normalizeFotmobStats(details) {
  const [homeCorners, awayCorners] = fotmobStatPair(details, ['corners', 'corner kicks']);
  const [homeYellows, awayYellows] = fotmobStatPair(details, [
    'yellow_cards',
    'yellow cards',
  ]);
  const [homeShots, awayShots] = fotmobStatPair(details, ['total_shots', 'total shots']);
  const [homeSot, awaySot] = fotmobStatPair(details, [
    'shotsontarget',
    'shots on target',
  ]);
  return {
    home: {
      corners: homeCorners,
      yellows: homeYellows,
      shots: homeShots,
      shotsOnTarget: homeSot,
    },
    away: {
      corners: awayCorners,
      yellows: awayYellows,
      shots: awayShots,
      shotsOnTarget: awaySot,
    },
  };
}

export async function fetchFotmobMatchDetails(fotmobId) {
  const url = `https://www.fotmob.com/api/data/matchDetails?matchId=${fotmobId}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'HoudiniBet/1.0',
    },
  });
  if (!res.ok) throw new Error(`FotMob matchDetails ${res.status}`);
  return res.json();
}

export function parseEventsJson(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
