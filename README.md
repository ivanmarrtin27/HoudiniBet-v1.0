# Houdini Bet

Predicciones de fútbol con modelo **Poisson** (shrinkage + Dixon–Coles).  
Runtime en **Cloudflare Workers + D1** con UI estática (PWA). **En desarrollo activo** (MVP usable).

[![Live](https://img.shields.io/badge/live-pages.dev-DC2626?style=flat-square)](https://houdini-bet.pages.dev)
[![Stack](https://img.shields.io/badge/stack-Workers%20%2B%20D1-0A0A0A?style=flat-square)](./cloudflare)

## Demo

**App (día a día):** https://houdini-bet.pages.dev  

Origen Worker/API: `https://houdini-bet.ivanmarrtin2703.workers.dev`  
Dominio custom `houdini-bet.dev` — opcional cuando el producto esté listo (auth + Premium).

| | |
|---|---|
| UI | Misma URL Pages |
| API | `/api/v1/...` |
| Health | `/health` |

## Qué hace

- **Partidos** día a día (ligas top EU + Segunda + UEFA), con live y panel de análisis
- Tips por partido: **1X2 · DC/DNB · O/U · BTTS · córners / tarjetas / SOT** (sin tiros totales)
- **Top 10** del día (P≥69% + cuota 1.30–3.50; diversidad por familia)
- **Stats** de tips recomendados (aciertos / fallos / pendientes)
- **Semanal**: combinada ~cuota 10 + Conservadora ~cuota 5 (estimación del modelo; botón «Otra» cicla alternativas)
- **Ligas**: explorador por país → clasificación D1 → próximo partido
- Sync automático (FixtureDownload + FotMob; enrich opcional con API-Football)

Los tips son **orientativos**. No garantizan acierto ni beneficio.

## Roadmap

Cuando el producto esté estable:

1. Registro + login (cuentas de usuario)
2. Planes **Premium** con suscripción / pago
3. Dominio custom opcional

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
# alias Pages (proxy):
npx wrangler pages deploy pages --project-name houdini-bet --branch main
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
| GET | `/api/v1/combos/weekly` |
| GET | `/api/v1/matches/:id/prediction` |
| GET | `/api/v1/leagues/:apiId/table` |
| POST | `/api/v1/sync/manual` (`x-sync-secret`) |

## CLI opcional (legacy)

```bash
cd legacy/backend
# API_BASE_URL=https://houdini-bet.pages.dev
npm install && npm run cli
```

Sin `API_BASE_URL` usa MySQL local (legacy, archivado en `legacy/`): el runtime de producción es Cloudflare (`cloudflare/`).

## Autor

[Iván Martín Molina](https://ivanmartin.pages.dev/) · [@ivanmarrtin2703](https://github.com/ivanmarrtin2703)

## Licencia

Uso personal / portfolio. Sin licencia open-source publicada de momento.
