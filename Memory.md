# Memory — Houdini Bet

## Decisiones
- CF Worker + D1; FD + FotMob + AF enrich
- Tips: anti-trivial (no O0.5 / U4.5); **nunca SHOTS_***; lane **P≥75%** + cuota≥1.25; **solo playable** en `tip_results`; display **P≥75%**; tipTier `none` → schema + `tip_tier`; BTTS secondary-only; secondary diversa
- UI: Partidos · Top 10 · Stats · Semanal · Ligas; `#top3` / `#ligas/<apiId>` / `#premium` / `#perfil`
- Auth bloqueante tras consent (sin sesión no hay app); cookie `hb_auth`; register/login/Google; Telegram UI **Pronto**
- Free vs Premium: tip/winProb/live probs/tabs = Premium; **General key cards free**; H2H + tabla liga + chrome OK; censor → `closePanel` + `#premium`
- Nav: desktop header icons; mobile `.app-tabbar` bottom (safe-area); SW `hb86`
- General key cards: o25/o15 portería; goals balón; btts 2 balones; corners/cards intactos; Tiros ≠ SOT; i18n ES↔EN P0+P1
- Top 10 = solo primary (`suggestedBet`); panel-suggest misma tip (sin ALL CAPS); trend summary total centrado
- URL producto: solo `houdini-bet.pages.dev` (workers.dev = origen técnico)
- SOT Overs 0.5–11.5; córners 1.5–11.5; totalShots display degraded si n<4; FotMob stats prioriza equipos ventana
- Premium tabs Oddster-style (rojo): summary + trend Metric|H|A|Partido; free = `lockedTrendTableHtml`; goles + scoregrid debajo
- Promo (0036+0037): types `free_days`|`free_month`|`discount_20`|`discount_40`; soft-delete `active=0`; discount → `users.pending_promo_*` + Stripe `%_off` en checkout; admin create/list/delete
- Badge unificado `.plan-badge` «Premium»/«Gratuito»; settings sin tema (dark forzado); `#ajustes` ✕ → `#partidos`
- Planes UI: Weekly 9,99 € / Monthly 19,90 € → Stripe o toast «Pago no configurado»
- Display ES: `countryLabel` + `leagueLabelEs`; Panel General Media liga n≥20
- Crests: FotMob PSG/Elche/Deportivo/Leverkusen/Schalke/Racing/Paris FC + BL; AF broken list
- Dominio: **pages.dev** día a día; **no** pagar `houdini-bet.dev` hasta producto listo
- Consent v2 hard gate; Cooperación → GitHub ivanmarrtin27
- Market tabs: misma L H/A/Match; Over+Under; goles 0.5–3.5; BTTS bloque Sí(+No sutil); SOT 0.5–11.5; córners 1.5–11.5; tarjetas 0.5–5.5; Tiros 14.5–24.5; General 6 cards; Poisson cliente si ladder falta
- Panel % count-up: `data-target` pills + scoregrid + `animatePercents` (ease-out ~560ms; skip blur/reduced-motion)

## Hecho
- Onboarding: consent → auth gate → app; logout/delete → re-gate
- Premium tables + promo + badge + dark-only + `#premium` compact
- `#premium` / `#perfil` / settings / menú cuenta; admin hits/stats/users/promo + Activar/Quitar Premium
- Auth v1 + Google; Ligas explorer; live cron; tip lock; ban SHOTS_*
- Free General key cards + icons; tabs Tiros; i18n P0+P1; SOT/córners ranges; promo types+delete; admin Stats cards homogéneas; tip sync Top10=panel; Under tables + BTTS block; Tiros 14.5–24.5; `hb86`

## Pendiente
- **API_FOOTBALL_KEY** válida (book real)
- Stripe webhook + suscripciones reales; email verify / reset password
- Google OAuth secrets/redirect si faltan; self-host fonts
- Stats público `#stats` se retirará cuando admin Stats esté consolidado
- Dominio custom `houdini-bet.dev` más adelante

## Deploy
- Worker: `cd cloudflare; npx wrangler deploy`
- Migrate: `npx wrangler d1 migrations apply houdini-bet-db --remote`
- Admin: `npx wrangler pages deploy admin-pages --project-name houdini-bet-admin --branch main`
