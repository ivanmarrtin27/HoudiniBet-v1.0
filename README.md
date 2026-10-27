<p align="center">
  <img src="cloudflare/public/brand/houdini-bet-logo.png" alt="Houdini Bet" width="360" />
</p>

<h1 align="center">Houdini Bet</h1>

<p align="center">
  <strong>Predicciones de fútbol con modelo Poisson</strong> (shrinkage + Dixon–Coles) · Worker + D1 en Cloudflare · PWA estática
</p>

<p align="center">
  <a href="https://houdini-bet.pages.dev"><img src="https://img.shields.io/badge/demo-pages.dev-DC2626?style=for-the-badge" alt="Live demo"></a>
  <a href="./cloudflare"><img src="https://img.shields.io/badge/runtime-Workers%20%2B%20D1-0A0A0A?style=for-the-badge" alt="Stack"></a>
  <img src="https://img.shields.io/badge/status-MVP%20%2F%20beta-F59E0B?style=for-the-badge" alt="Status">
</p>

<p align="center">
  <a href="https://houdini-bet.pages.dev">Abrir app</a>
  ·
  <a href="#desarrollo">Desarrollo local</a>
  ·
  <a href="#api-resumen">API</a>
</p>

---

## Enlaces

| | URL |
|---|---|
| **App (día a día)** | https://houdini-bet.pages.dev |
| **Worker / API** | https://houdini-bet.ivanmarrtin2703.workers.dev |
| **Health** | `/health` |
| **REST** | `/api/v1/...` |

Dominio custom `houdini-bet.dev` — previsto cuando auth y Premium estén listos para producción.

## Características

- **Partidos** — ventana hoy + 14 días; ligas top europeas, Segunda y competiciones UEFA; live con refresco y proyección en tiempo real
- **Mercados** — 1X2 · doble oportunidad / DNB · over/under · BTTS · córners, tarjetas y tiros a puerta (sin mercados de tiros totales)
- **Top 10 del día** — probabilidad ≥69% y cuota en rango razonable; diversidad por familia de mercado
- **Semanal** — combinada ~cuota 10 y conservadora ~cuota 5 (estimación del modelo; alternativas con «Otra»)
- **Stats** — seguimiento de tips recomendados (aciertos, fallos, pendientes)
- **Ligas** — explorador por país, clasificación y acceso al próximo partido del equipo
- **UI** — interfaz móvil pulida (cabecera compacta, navegación con indicador deslizante, PWA instalable)
- **Datos** — sync programado (FixtureDownload + FotMob; enriquecimiento opcional vía API-Football)

**Premium / pagos:** hay trabajo previo de activación con Stripe; el producto público en Pages sigue en fase **beta gratuita** — no prometemos funciones de pago hasta el lanzamiento formal.

## Aviso

Los pronósticos y tips son **informativos y orientativos**. No constituyen asesoramiento financiero ni garantizan resultados. Juega con responsabilidad y dentro de tus límites.

## Stack

| Pieza | Detalle |
|-------|---------|
| Runtime | Cloudflare Worker `houdini-bet` |
| Base de datos | D1 `houdini-bet-db` |
| Frontend | `cloudflare/public` — HTML, CSS, JS (sin framework) |
| Cron | sync `0 6 * * *` · enrich `30 6 * * *` (con clave API) |
| Ligas allowlist | `LEAGUE_IDS=140,141,39,135,78,61,5,2,3` |

Código de producción: [`cloudflare/`](./cloudflare). Backend Express + MySQL archivado en [`legacy/`](./legacy/).

## Estructura del proyecto

```
Houdini Bet/
├── cloudflare/          # Worker, D1, UI estática, scripts de test
│   ├── public/          # PWA (app.js, styles, brand, icons)
│   ├── src/             # index.js, servicios, modelo live
│   └── migrations/      # esquema D1
├── legacy/              # CLI / backend local (referencia)
├── AGENTS.md            # guía para agentes de código
└── Memory.md            # notas internas del proyecto
```

## Desarrollo

Requisitos: Node.js LTS, cuenta Cloudflare, [Wrangler](https://developers.cloudflare.com/workers/wrangler/).

```bash
cd cloudflare
npm install
npx wrangler d1 migrations apply houdini-bet-db --local
npm run dev
# o: npx wrangler dev
```

**Deploy Worker:**

```bash
cd cloudflare
npm run deploy
# alias Pages (proxy estático):
npx wrangler pages deploy pages --project-name houdini-bet --branch main
```

**Migraciones remotas:**

```bash
npx wrangler d1 migrations apply houdini-bet-db --remote
```

**Secrets (Wrangler):** `SYNC_SECRET` (sync manual); opcional `API_FOOTBALL_KEY` (cuotas/stats).

**Tests:**

```bash
cd cloudflare && npm test
```

## API (resumen)

| Método | Ruta |
|--------|------|
| GET | `/api/v1/status` |
| GET | `/api/v1/matches/today?days=0\|14` |
| GET | `/api/v1/matches/best-bets` |
| GET | `/api/v1/combos/weekly` |
| GET | `/api/v1/matches/:id/prediction` |
| GET | `/api/v1/leagues/:apiId/table` |
| POST | `/api/v1/sync/manual` (header `x-sync-secret`) |

## CLI opcional (legacy)

```bash
cd legacy/backend
# API_BASE_URL=https://houdini-bet.pages.dev
npm install && npm run cli
```

Sin `API_BASE_URL` apunta a MySQL local (solo desarrollo legacy).

## Roadmap

1. Registro e inicio de sesión
2. Planes Premium con suscripción
3. Dominio custom opcional

## Autor

[Iván Martín Molina](https://ivanmartin.pages.dev/) · [@ivanmarrtin2703](https://github.com/ivanmarrtin2703)

## Licencia

Uso personal / portfolio. No hay licencia open-source publicada por el momento.
