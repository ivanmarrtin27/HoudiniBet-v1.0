# Memory — Houdini Bet

## Decisiones
- CF Worker + D1; FD + FotMob + AF enrich
- Tips: anti-trivial (no O0.5 / U4.5); **nunca SHOTS_*** (tiros totales; SOT ok); lane **P≥69%** + cuota≥1.25; secondary con `secondaryCounts` anti-BTTS-spam; secondary excluye misma `tipFamily` (1X2+DC/DNB) que primary
- UI: Partidos · **Top 10** (P≥69% cuota 1.30–3.50; máx 3/familia; pool primary+secondary) · Stats · Semanal · **Ligas** explorador (Europeas+top5 → tabla D1+crests → próximo partido); `#top3` / `#ligas/<apiId>`
- Crests: FotMob PSG/Elche/Deportivo/**Leverkusen 8178**; AF 85/3751/1102/168 broken
- Reset Stats: `POST /api/v1/admin/stats/reset` → wipe + `stats_reset_at`; backfill solo scheduled/live (no finished)
- Odds: sin key → sin book; Semanal cuota 10 + Conservadora 5
- **Dominio**: trabajar en free (`houdini-bet.pages.dev` / workers.dev); **no** pagar `houdini-bet.dev` hasta producto listo
- Cuando todo funcione como se quiere: (1) registro+login (2) plan Premium con pago

## Hecho
- Ban SHOTS_* + secondary diversity (tipFamily vs primary); Leverkusen crest; Top 10 caps; Stats epoch wipe
- Unlock público si `PREMIUM_UNLOCKED`
- Ligas explorer: split países+banderas | tabla; nextMatch/análisis; `#ligas/<apiId>`
- pages.dev: SW `hb24` brand + `og-share.png` negro 1200×630 (WA); Semanal Otra; track sin premium/ajustes
- Live cron `*/10 11-23` UTC + lookback 2d; alias Man City; Stats historial paginado (Cargar más); Partidos sin marcador (sí en análisis)

## Pendiente
- **API_FOOTBALL_KEY** válida (book real)
- Dominio custom `houdini-bet.dev` — opcional más adelante (no bloquea trabajo diario en pages.dev)
- Auth (registro/login) + Premium de pago — tras producto OK; Stripe webhook

## Deploy
- Worker: `cd cloudflare && npx wrangler deploy`
- Admin: `?admin=1`; crests audit / stats reset con `x-sync-secret`
