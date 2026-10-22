# AGENTS.md — Houdini Bet

## Qué es
App de predicciones de fútbol (Poisson).

## Runtime de producción (Cloudflare)
- URL pública (Pages): `https://houdini-bet.pages.dev`
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
- Express + MySQL en [`backend/`](backend/)
- CLI: `API_BASE_URL` → usa API Cloudflare; sin URL → MySQL local

## UI
HTML/JS en `cloudflare/public` (mínima). Pulir con `frontend-design` / `web-design-guidelines` después. Angular descartado.

## Mercados Houdini
- Top 3 del día; por partido 1 principal + 1 secundaria
- 1X2 · O/U 2.5 · BTTS · corners · value ≥5%

## Convenciones
- Nunca mezclar D1/DB con proyecto QR
- Memory ≤100 líneas (ideal ≤70)
- Secrets fuera del repo
- Deploy Worker: `cd cloudflare && npx wrangler deploy`
- Deploy alias Pages: `cd cloudflare && npx wrangler pages deploy pages --project-name houdini-bet --branch main`
