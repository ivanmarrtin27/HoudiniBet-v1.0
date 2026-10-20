# Houdini Bet

Predicciones de fútbol con modelo **Poisson** (shrinkage + Dixon–Coles).  
Producción en **Cloudflare Workers + D1** con UI estática (PWA).

[![Live](https://img.shields.io/badge/live-houdini--bet-DC2626?style=flat-square)](https://houdini-bet.ivanmarrtin2703.workers.dev)
[![Stack](https://img.shields.io/badge/stack-Workers%20%2B%20D1-0A0A0A?style=flat-square)](./cloudflare)

## Demo

**App:** https://houdini-bet.ivanmarrtin2703.workers.dev  

| | |
|---|---|
| UI | Misma URL |
| API | `/api/v1/...` |
| Health | `/health` |

## Qué hace

- Lista de partidos **día a día** (ligas top EU + Segunda + UEFA)
- Tips por partido: **1X2 · O/U · BTTS · córners / tarjetas / tiros**
- **Top 3** del día ordenado por valor book (≥5%)
- Sync automático (FixtureDownload + FotMob; enrich opcional con API-Football)
- Stats de aciertos y panel de análisis

## Stack

| Pieza | Detalle |
|-------|---------|
| Runtime | Cloudflare Worker `houdini-bet` |
| DB | D1 `houdini-bet-db` |
| Front | `cloudflare/public` (HTML/CSS/JS) |
| Cron | sync `0 6 * * *` · enrich `30 6 * * *` |
| Ligas | `LEAGUE_IDS=140,141,39,135,78,61,5,2,3` |

Código de producción: carpeta [`cloudflare/`](./cloudflare).

## Desarrollo

```bash
cd cloudflare
npm install
npx wrangler d1 migrations apply houdini-bet-db --local
npx wrangler dev
```

Deploy:

```bash
cd cloudflare
npx wrangler deploy
```

Migraciones remotas:

```bash
npx wrangler d1 migrations apply houdini-bet-db --remote
```

Secrets (Wrangler): `SYNC_SECRET`, opcional `API_FOOTBALL_KEY`.

## API (resumen)

| Método | Ruta |
|--------|------|
| GET | `/api/v1/status` |
| GET | `/api/v1/matches/today?days=0\|14` |
| GET | `/api/v1/matches/best-bets` |
| GET | `/api/v1/matches/:id/prediction` |
| POST | `/api/v1/sync/manual` (`x-sync-secret`) |

## CLI opcional

```bash
cd backend
# API_BASE_URL=https://houdini-bet.ivanmarrtin2703.workers.dev
npm install && npm run cli
```

Sin `API_BASE_URL` usa MySQL local (legacy).

## Autor

[Iván Martín Molina](https://ivanmartin.pages.dev/) · [@ivanmarrtin2703](https://github.com/ivanmarrtin2703)

## Licencia

Uso personal / portfolio. Sin licencia open-source publicada de momento.
