# Memory — Houdini Bet

## Decisiones
- CF Worker + D1; FD + FotMob + AF enrich; tips book-first
- UI browse Oddster-like: **Partidos día a día** (←→ / Ayer Hoy Mañana / swipe)
- Header: Partidos · Top 3 · Stats · Ligas; **sin dock**
- Brand `#0A0A0A` + `#DC2626`
- **ratings_live=0**: prod tune 2026-10-21 holdout Brier 1X2 = shrinkage (0.657); no enable
- Enrich: probe `/status`; surface 401/403 (key inválida hoy)
- FotMob sin key: corners, amarillas, tiros totales y **SOT** (60d incremental)
- Extras book-first secundaria: corners/cards/SOT; mínimo 4 partidos/equipo
- **En vivo**: proyección Poisson+Dixon–Coles pre-partido escalada por minutos restantes (95 = 90+5); estado del tip `secured/alive/fading/dead/unknown` (≥0.995 / ≥0.10 / >0.01 / ≤0.01)
- En vivo: `predictions.home_xg/away_xg` (mig 0022) para reutilizar el xG; fallback `inferLambdas()` si la fila es vieja
- En vivo: partidos domésticos resueltos por nombre contra el feed FotMob (índice por token) → `matches.fotmob_match_id` (mig 0023)
- UI en vivo: tira de 1X2 + chip de estado en la fila y en la card Top3; panel `.mp-live` con barra y delta vs pre-partido
- Mercados (tiros/córners/tarjetas): pestañas con la **misma estructura que "Goles"** → tarjeta Expected + 3 `market-block` (partido/local/visitante) con filas Más/Menos; se derivan de `bundle.ladders.*` (no de `predictions.*`)
- Mercados de conteo: fallback degradado con shrinkage a media de liga solo para `expected`/`ladders` de presentación; los tips guardados mantienen umbral estricto de 4 muestras. Bundle marca `degraded` y `samples` por ladder.
- UI mercados de conteo: barras de probabilidad + promedio reciente local/visitante y media liga por equipo; badge de estimación degradada indica muestras.
- Swipe móvil fase A: gesto de fecha solo con dirección horizontal clara (≥max 70px/18%, 2:1, ≤550ms), excluye controles/scrollers; gesto iniciado en lista no navega también vistas.
- UI móvil fase B: header compacto 2 filas, targets principales ≥44px, safe areas/focus visible, scroll horizontal con inercia y overscroll de paneles contenido.
- Tips fase C: 1X2 local/visitante usa ventana 44–85%; selección aplica cuota diaria 40% por etiqueta y rota empates (≤2pp) a familias menos usadas, secundarios de familia distinta; Top 3 limita repetición exacta a 1 si hay alternativas. Sync recomputa duplicados de menor confianza.
- Fase cuotas F1: fuente autorizada elegida = API-Football Free (100 req/día; código existente). Enriquecimiento limitado según `/status`, 6.2s entre llamadas y reserva diaria; key vigente requerida. FotMob `matchOdds` descartado para polling porque `robots.txt` bloquea `/api/*`; response observada solo trae 1X2.
- F1 budget: 15 odds + 5 stats por enrich como fallback; plan dinámico por cuota restante, 2× daily cron; intentos parciales cacheados 12h, placeholders sin cuota excluidos de cobertura. Prod aún sin precio: `API_FOOTBALL_KEY` responde 403.
- F2 rentabilidad: `tip_results/combo_results.odds_source` (mig 0024) marca 'book' vs 'model'; el ROI (`src/services/roi.js`) solo cuenta cuotas reales (1 ud por apuesta, voids devuelven stake) y Tips/Stats muestran yield, aciertos y nº apostadas; con precio del modelo se rotula "sin cuota de casa".
- F3 cron en vivo: `*/10 15-23 * * *` (UTC) llama a `runLiveCron`, que reutiliza el refresco en vivo (marcador, incidentes, liquidacion de tips) y solo llama a los feeds si hay partido en vivo, tip pendiente o kickoff en ±3 h; `last_live_cron_at` y `liveWork` visibles en `/api/v1/status`.
- F3 saneado: partidos 'live' con kickoff de hace >4h se cierran y sus tips se anulan (void) porque ningun feed ya los cubre y liquidarlos escribiria un marcador inventado.
- F4 PWA: `public/sw.js` (shell con stale-while-revalidate, API con network-first + copia offline, admin/sync sin cachear, fallback SPA offline); aviso de "sin conexion" y refresco al volver la red. Version de assets `hb12` sincronizada con el precache.
- F5 contexto: panel de partido con grid 5x5 de marcadores exactos (Poisson+Dixon-Coles), ultimos enfrentamientos (H2H por nombre entre ligas, excluye el propio partido y sin lookahead) y mini clasificacion desde partidos jugados (copas/selecciones >24 equipos sin pseudotabla). Sigue en root del bundle: `scoreGrid`, `topScores`, `h2h`, `leagueTable`.
- F6 rojas en vivo: `liveSnapshot` cuenta rojas por lado de los incidentes (tipo `red` ya venia de AF/FotMob); `projectLive` escala los xg restantes con RED_SIM_FACTOR 0.75 (equipo con uno menos) y RED_OPP_FACTOR 1.15 (con ventaja), multiples rojas se componen; `buildLiveBlock` expone `redCards` y la UI muestra el marcador de hombres (10v11). Smoke en prod: roja local al 45 baja la prob local 27.9->19.5% y sube la visitante 33.8->42.7%, fila restaurada.

## Hecho
- URL: https://houdini-bet.pages.dev (+ workers.dev origen)
- Cierre hoy+ayer + liquidación; 20/10: 9 FT score + 7/9 tips
- mig 0017–0021; SOT separado de tiros totales
- SOT codes: `SOT_OVER/UNDER_75`, `_85`, `_95`; settle desde stats SOT
- Prod 2026-10-22: 522/520/522 filas corners/yellows/SOT
- admin backtest `tune:true`
- Retune Kalman defaults Q=0.004 R=1.1 MIN_N_OBS=8
- 2026-10-22: feature en vivo completa — mig 0022/0023 aplicadas, xG backfilled (570/570), Worker desplegado, `/matches/today` + `/matches/:id/live` con bloque `live`
- Polling adaptativo: 50 s con partidos en vivo, 120 s sin ellos (cooldown servidor 45 s)

## Pendiente
- **API_FOOTBALL_KEY válida** (`wrangler secret put`) — sin cuotas (0% coverage)
- Pagos Premium

## Notas
- Repo bajo control de versiones: 3 commits por área (engine / ui / tooling) + `npm test` (13 suites) + CI en GitHub Actions (node 22) que corre la suite y el check de sintaxis
- Deploy Worker: `cd cloudflare && npx wrangler deploy`
- Deploy Pages: `cd cloudflare && npx wrangler pages deploy pages --project-name houdini-bet --branch main`
- Admin: `?admin=1`; `x-sync-secret`
- Tests motor en vivo: `node cloudflare/scripts/test-live-model.mjs` (41 checks)
- Tests HTML en vivo: `node cloudflare/scripts/test-live-ui.mjs` (16 checks)
- Tests pestañas de mercados: `node cloudflare/scripts/test-market-panels.mjs` (32 checks: promedios, badge, fallbacks y ladders)
- Tests modelos degradados de conteo: `node cloudflare/scripts/test-display-models.mjs` (41 checks; incluye no contaminación de tips y empaquetado del bundle)
- Tests selección de tips: `node cloudflare/scripts/test-pick-bets.mjs` (10 checks); `node cloudflare/scripts/test-daily-tip-context.mjs` (7); `node cloudflare/scripts/test-daily-tip-diversity.mjs` (6); `node cloudflare/scripts/test-top3-diversity.mjs` (6)
- Tests presupuesto/odds AF: `node cloudflare/scripts/test-af-free-budget.mjs` (10); `node cloudflare/scripts/test-api-football-odds.mjs` (5)
- Tests rentabilidad: `node cloudflare/scripts/test-roi.mjs` (19)
- Tests cron en vivo: `node cloudflare/scripts/test-live-cron.mjs` (24)
- Tests PWA: `node cloudflare/scripts/test-pwa.mjs` (21)
- Tests contexto F5: `node cloudflare/scripts/test-analysis-context.mjs` (23)
- Tests rojas en vivo F6: `node cloudflare/scripts/test-live-red-cards.mjs` (16)
- F7 limpieza: sin ladder-table muerta (`marketLadderPanel`, `ladderTableHtml`, `toneFromPct` y sus CSS borrados), skip-link a `#views`, legacy Express+MySQL archivado en `legacy/backend` y `legacy/database` (historial preservado, referencias actualizadas en README/AGENTS); notas: no quedan '…' huerfanos en UI; `cloudflare/pages/_worker.js` restaurado (faltaba en disco) y el proxy pages.dev sigue vivo.
- F8 premium (sin cuentas): cookie huesped `hb_prem` (id.secret hash SHA-256 en D1 `premium_sessions`, mig 0025); Stripe Checkout con `client_reference_id` = id de sesion, webhook `/api/v1/premium/webhook` verifica firma (`STRIPE_WEBHOOK_SECRET`, 300 s) y concede `premium_until` = compra + `PREMIUM_DAYS` (30); `charge.refunded` revoca. Gate: `best-bets?oddsBand` -> 402 y `/tips/performance` sin roi/recent (premiumRequired). Admin (`x-sync-secret`): POST `/api/v1/admin/premium/grant` {days,id?}. ACTIVACION PENDIENTE DEL USUARIO: secrets `STRIPE_SECRET_KEY` + `STRIPE_PRICE_ID` + `STRIPE_WEBHOOK_SECRET` y webhook en Stripe dashboard (URL anonima predominante: pages.dev). Sin ellas la tabla premium muestra "Sin pago configurado" y el CTA quedan deshabilitados.
- Tests guard swipe: `node cloudflare/scripts/test-swipe-guard.mjs` (19 checks)
- Tests UI móvil: `node cloudflare/scripts/test-mobile-ui.mjs` (17 checks)
- Tests cuota/proveedor F1: `node cloudflare/scripts/test-af-free-budget.mjs` (10) + `node cloudflare/scripts/test-api-football-odds.mjs` (5)
- Backfill xG: `node cloudflare/scripts/backfill-xg.mjs` (idempotente)
