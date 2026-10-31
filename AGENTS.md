# AGENTS.md — Houdini Bet

## Qué es
App de predicciones de fútbol (Poisson).

## Runtime de producción (Cloudflare)
- URL día a día: **`https://houdini-bet.pages.dev`** (única URL de producto); custom `houdini-bet.dev` opcional cuando producto listo (auth + Premium pago)
- Worker origen (API/deploy técnico, no día a día): `https://houdini-bet.ivanmarrtin2703.workers.dev`
- D1: `houdini-bet-db` (ID `b6ee98e6-2397-45e5-83cb-33d1370656ae`) — **aislado del proyecto QR**
- Cron sync: `0 6 * * *`
- Código: carpeta [`cloudflare/`](cloudflare/)
- Secrets: `SYNC_SECRET`, opcional `API_FOOTBALL_KEY`
- Vars: `LEAGUE_IDS=140,141,39,135,78,61,5,2,3` (top5 + Segunda + UNL + UCL + UEL)
- Sync sin key: FixtureDownload (domésticas + UNL + Champions + Europa) + FotMob Friendlies + **Segunda** (LaLiga2); con `API_FOOTBALL_KEY`: odds/stats AF vía `POST /api/v1/sync/enrich` (cron `30 6 * * *`)
- Lista: ventana **hoy + 14 días**; solo ligas allowlist (sin ASEAN / AFC / CAF / CONCACAF NL / WCQ / etc.)
- Auto-sync si stale >12h
- En vivo: `POST /api/v1/matches/refresh-live` (cooldown 45 s) + `POST /api/v1/matches/:id/live`; proyección en `src/services/liveModel.js`

## Stack local (legacy / CLI)
- Express + MySQL en [`legacy/backend/`](legacy/backend/) (archivado)
- CLI: `API_BASE_URL` → usa API Cloudflare; sin URL → MySQL local

## UI
HTML/JS en `cloudflare/public` (mínima). Pulir con `frontend-design` / `web-design-guidelines` después. Angular descartado.
- Auth: D1 `users`/`auth_sessions`; cookie `hb_auth`; register (username+name+email+phone+password) / login (username|email) /me/logout + Google OAuth; post-register welcome 3s + Premium modal; secrets `AUTH_SECRET` + Google; Stats vía nav `#stats`
- Admin microsite: `https://houdini-bet-admin.pages.dev` ([`cloudflare/admin-pages/`](cloudflare/admin-pages/); DocuForge dark+red; PIN=`SYNC_SECRET`); usage today + daily chart + Web Analytics + D1 `page_hits` (preview 5 + `#hits` historial/búsqueda, limit≤500) + panel Stats tips (`/tips/performance`; público se retirará luego); promo create/list/delete (tipos free_days|free_month|discount_20|40); users search + revoke/enable/delete; secrets `CF_ACCOUNT_ID`/`CF_API_TOKEN` (+ opc. `CF_WEB_ANALYTICS_SITE_TAG`); dominio `houdini-bet.dev` later; ver `cloudflare/docs/ADMIN_PANEL.md`
- Consent v2 obligatorio: sin `houdini_consent_v1` (choice + ageConfirmed) la app pública queda bloqueada (shell oculto); legales leíbles dentro del gate
- Nav: desktop `.v2-nav` + icons; mobile bottom `.app-tabbar` (Partidos/Top 10/Stats/Semanal/Ligas); hash routing unchanged
- Ligas móvil: tabla slide-desde-derecha (mismo patrón que panel análisis); `#ligas/<apiId>` + atrás
- Partidos chrome: chips estado (Todos/En vivo/Finalizados/Próximos); **sin** scope Todas/clubs/intl (siempre all)
- Display ES: países/ligas vía `countryLabel` + `leagueLabelEs` (no inglés crudo en UI)
- **Ligas** (`#ligas`): split Partidos (países+banderas | tabla) Europeas (2/3/5) + top5 → `GET /leagues/:apiId/table` → tap equipo → nextMatch; `#ligas/<apiId>`
- Live: name-match umbral 85; no pintar scores si kickoff futuro; `POST /api/v1/admin/matches/repair-future-finished`

## Mercados Houdini
- Top 10 (hash `#top3`): **día seleccionado** (`/matches/today?date=` = chip Partidos); fill `min(10, N)`; P≥75% + backfill ≥69%; cuota **max 3.50** (book o modelo `1/p`); **no hard-min 1.30** (high-P shorts OK); anti-trivial / no SHOTS_*; prefer 1 label / máx 3 familia, luego fill 1/partido (labels duplicados OK); scheduled/live; **solo tip primary** (`suggestedBet` — misma etiqueta que panel-suggest; secondary no entra en Top 10); tipTier none OK en UI; Stats `tip_results` sigue solo playable
- Panel General: O1.5 / O2.5 / BTTS + **Media liga** (tasa histórica finished de la liga, n≥20)
- 1X2 · DC/DNB · O/U 0.5–4.5 · BTTS (secondary) · corners/cards/SOT · value ≥5% (book); **nunca SHOTS_*** (tiros totales)
- Panel ladders: SOT 0.5–11.5; córners 1.5–11.5; tarjetas 0.5–5.5; Tiros totales 14.5–24.5 (display degraded si n<4); Over + Under tables; BTTS bloque propio en Goles; cache shell `hb86`
- Tips: anti-trivial (no O0.5 / U4.5); lane jugable **P≥75%** + cuota≥1.25; display tips también **P≥75%** (no ~50% como tip); **solo playable** en Stats (`tip_results`); BTTS no primary; secondary diversa (malus diario BTTS/O-U)
- Semanal cuota 10 (+ Conservadora cuota 5): top5; UI sin `@`/«piernas»; Prob. combinada; Valor solo con book
- Crests: FotMob PSG/Elche/Deportivo/Leverkusen/Schalke/Racing Santander/Paris FC + BL roster; audit `node scripts/audit-crests.mjs`
- Admin reset Stats: `POST /api/v1/admin/stats/reset` (wipe + `stats_reset_at`)

## Convenciones
- Nunca mezclar D1/DB con proyecto QR
- Memory ≤100 líneas (ideal ≤70)
- Secrets fuera del repo
- Deploy Worker: `cd cloudflare && npx wrangler deploy`
- Deploy alias Pages: `cd cloudflare && npx wrangler pages deploy pages --project-name houdini-bet --branch main`
- Deploy admin microsite: `cd cloudflare && npx wrangler pages deploy admin-pages --project-name houdini-bet-admin --branch main`
