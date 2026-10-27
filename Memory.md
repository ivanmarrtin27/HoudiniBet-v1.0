# Memory — Houdini Bet

## Decisiones
- CF Worker + D1; FD + FotMob + AF enrich
- Tips: anti-trivial (no O0.5 / U4.5); **nunca SHOTS_***; lane **P≥75%** + cuota≥1.25; **solo playable** entra en `tip_results`; tipTier `none` → `displayPrimary` en `predictions.suggested_bet` (NOT NULL, conf=0, no ledger/backfill); BTTS secondary-only (ok display); secondary diversa / no misma `tipFamily` que primary/display
- UI: Partidos · **Top 10** (P≥75% cuota 1.30–3.50; máx 3/familia; pool primary+secondary) · Stats · Semanal · **Ligas** explorador; `#top3` / `#ligas/<apiId>`
- UNDO tip-policy: baseline `a31f4b5`; tip-policy commit `48738e8` → `git revert 48738e8` + `wrangler deploy` (no wipe tip_results)
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
- Consent v2 (`houdini_consent_v1` key, version 2 + ageConfirmed): Personalizar, 18+, `#condiciones`; borrar datos locales en Ajustes
- Al activar Stripe/auth: reescribir privacidad/cookies/ToS (pago, `hb_prem`, baja); si analytics real → gate antes del script; valorar self-host fonts

## Pendiente
- **API_FOOTBALL_KEY** válida (book real)
- Dominio custom `houdini-bet.dev` — opcional más adelante (no bloquea trabajo diario en pages.dev)
- Auth (registro/login) + Premium de pago — tras producto OK; Stripe webhook
- Self-host Google Fonts (quitar fonts.googleapis) cuando toque privacidad dura

## Deploy
- Worker: `cd cloudflare && npx wrangler deploy`
- Admin: `?admin=1`; crests audit / stats reset con `x-sync-secret`
