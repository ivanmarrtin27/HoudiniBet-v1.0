# Panel admin Houdini

## Microsite (recomendado)

1. Abre **`https://houdini-bet-admin.pages.dev`** (proyecto Pages `houdini-bet-admin`).
2. Introduce el **PIN numérico** (= Worker `SYNC_SECRET`), campo enmascarado (`type=password` + `inputmode=numeric`). Se envía como header `x-sync-secret`; se guarda en `sessionStorage` solo para esa pestaña.
3. Tras validar: dashboard (uso CF hoy + visitantes preview 5 + Stats tips + gráfico consultas/día + cuentas con búsqueda + revoke/enable/delete). `#hits` = historial completo (búsqueda tipo Cuentas).
4. UI: DocuForge layout, fondo negro `#0a0a0a`, primary rojo `#DC2626`. Código: [`cloudflare/admin-pages/`](../admin-pages/).
5. API base: `https://houdini-bet.ivanmarrtin2703.workers.dev`.
6. QR privado: carpeta local [`admin-qr/`](../../admin-qr/) (`mi-qr.html` + PNG). Apunta al microsite **sin** embeber el secret. Está en `.gitignore`.
7. **Stats (tips):** el panel admin consume `GET /api/v1/tips/performance` (misma API pública). La casa a largo plazo de Stats es el admin; la vista pública `#stats` se retirará más adelante (aún no eliminada).

Cambiar acceso admin (solo Wrangler; **nunca** en git):

```bash
cd cloudflare
npx wrangler secret put SYNC_SECRET
```

Deploy:

```bash
cd cloudflare
npx wrangler pages deploy admin-pages --project-name houdini-bet-admin --branch main
```

## Acceso legacy (app principal)

1. `https://houdini-bet.pages.dev/?admin=1#admin` (o workers.dev).
2. La UI pide `SYNC_SECRET` una vez por pestaña (`sessionStorage`).

Sin `?admin=1`, la vista `#admin` no se muestra ni se enruta.

## APIs

### Públicas

- `POST /api/v1/telemetry/hit` — body `{ path, referrer? }`; el Worker guarda IP (`CF-Connecting-IP`), país, UA truncado, host. Dedup 60s por `(ip, path)`. Retención 30 días.

### Admin (`x-sync-secret`)

- `GET /api/v1/admin/usage/today` — requests Worker hoy UTC + **`loginsToday`** (D1)
- `GET /api/v1/admin/usage/daily?from=&to=` — serie diaria Worker; default 7 días UTC; máx. 90
- `GET /api/v1/admin/usage/visits?day=` — Web Analytics agregadas; requiere `CF_WEB_ANALYTICS_SITE_TAG`
- `GET /api/v1/admin/visits/recent?limit=` — hits D1 con IP + `uniqueIpsToday` + `device` (label best-effort desde UA; no modelo iPhone exacto ni nombre del aparato). `limit` máx. **500** (default 50). Preview UI = 5; `#hits` carga el historial.
- `GET /api/v1/admin/users` — listado (sin password_hash)
- `POST /api/v1/admin/users/:id/revoke` — `disabled=1` + revoca sesiones
- `POST /api/v1/admin/users/:id/enable` — reactiva
- `DELETE /api/v1/admin/users/:id` — hard delete user + sessions

### Definición de métricas

| Métrica | Qué cuenta | Nota |
|---------|------------|------|
| Visitas (tarjeta) | CF Web Analytics `sum.visits` (+ page views) | Agregado; sin IP |
| Hits con IP | Beacon app → D1 `page_hits` | Path + IP + país + UA; 30d |
| Inicios de sesión | Filas `auth_sessions` creadas hoy UTC | Solo login auth |
| Consultas Worker | Invocaciones del script | API + assets; ≠ visitantes únicos |

## Secrets Wrangler (métricas)

```bash
cd cloudflare
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put CF_API_TOKEN
# visitas agregadas (opcional):
npx wrangler secret put CF_WEB_ANALYTICS_SITE_TAG
# opcional:
# npx wrangler secret put CF_WORKER_SCRIPT_NAME
# valor por defecto: houdini-bet
```

Token: permiso **Account Analytics · Read**.  
Site tag: activar **Web Analytics** en Pages `houdini-bet` y copiar el `siteTag`.

Sin `CF_ACCOUNT_ID`/`CF_API_TOKEN`: UI corta «Métricas CF no configuradas» (logins + hits D1 sí).  
Sin site tag: Visitas «No configuradas». Comprobar: `npx wrangler secret list`.

`CF_ACCOUNT_ID` ya suele estar; `CF_API_TOKEN` se crea en Dashboard → API Tokens (**Account Analytics · Read**):

```bash
cd cloudflare
npx wrangler secret put CF_API_TOKEN
npx wrangler secret put CF_WEB_ANALYTICS_SITE_TAG
```

Sin redeploy tras `secret put`.

## Privacidad (checklist)

Los hits con IP son datos personales. Antes de producto público / dominio custom:

1. Actualizar política de privacidad (qué se guarda, cuánto tiempo, para qué).
2. Base legal / interés legítimo o consentimiento según tu jurisdicción.
3. Acceso al log solo vía panel admin (secret).
4. Retención automática 30 días (`page_hits`).

## Dominio custom (fase posterior)

Cuando actives `houdini-bet.dev`:

1. Añadir el hostname al sitio Web Analytics.
2. Revisar filtros `requestHost` si un tag cubre varios hosts.
3. El beacon ya usa la API del Worker; no bloquea métricas actuales.

## Migración

```bash
npx wrangler d1 migrations apply houdini-bet-db --remote
```

Incluye `0031_users_disabled.sql` y `0032_page_hits.sql`.
