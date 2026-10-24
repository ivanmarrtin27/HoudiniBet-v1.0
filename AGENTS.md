# AGENTS.md — Houdini Bet

## Qué es
App de predicciones de fútbol (Poisson).

## Runtime de producción (Cloudflare)
- URL día a día: `https://houdini-bet.pages.dev` (+ workers.dev); custom `houdini-bet.dev` opcional cuando producto listo (auth + Premium pago)
- Worker + assets (origen): `https://houdini-bet.ivanmarrtin2703.workers.dev`
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
- **Ligas** (`#ligas`): split Partidos (países+banderas | tabla) Europeas (2/3/5) + top5 → `GET /leagues/:apiId/table` → tap equipo → nextMatch; `#ligas/<apiId>`
- Live: name-match umbral 85; no pintar scores si kickoff futuro; `POST /api/v1/admin/matches/repair-future-finished`

## Mercados Houdini
- Top 10 del día (P≥69% + cuota 1.30–3.50; hash `#top3`); hasta 10; máx 1 label / máx 3 familia; pool primary+secondary
- 1X2 · DC/DNB · O/U 0.5–4.5 · BTTS · corners/cards/SOT · value ≥5% (book); **nunca SHOTS_*** (tiros totales)
- Tips: anti-trivial (no O0.5 / U4.5); lane jugable P≥69% + cuota≥1.25; secondary diversa (malus diario BTTS/O-U)
- Semanal cuota 10 (+ Conservadora cuota 5): top5; UI sin `@`/«piernas»; Prob. combinada; Valor solo con book
- Crests: FotMob PSG/Elche/Deportivo/Leverkusen; audit `node scripts/audit-crests.mjs`
- Admin reset Stats: `POST /api/v1/admin/stats/reset` (wipe + `stats_reset_at`)

## Convenciones
- Nunca mezclar D1/DB con proyecto QR
- Memory ≤100 líneas (ideal ≤70)
- Secrets fuera del repo
- Deploy Worker: `cd cloudflare && npx wrangler deploy`
- Deploy alias Pages: `cd cloudflare && npx wrangler pages deploy pages --project-name houdini-bet --branch main`
