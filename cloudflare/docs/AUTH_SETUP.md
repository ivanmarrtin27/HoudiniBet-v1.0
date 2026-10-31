# Auth setup (Houdini Bet)

## Secrets (nunca en git)

```bash
cd cloudflare
# 32+ bytes random hex
npx wrangler secret put AUTH_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
# optional fixed public origin for OAuth redirect:
# npx wrangler secret put AUTH_PUBLIC_ORIGIN
# value e.g. https://houdini-bet.ivanmarrtin2703.workers.dev
```

## Google Cloud

1. Create OAuth client (Web application).
2. Authorized redirect URIs:
   - `https://houdini-bet.ivanmarrtin2703.workers.dev/api/v1/auth/google/callback`
   - `https://houdini-bet.pages.dev/api/v1/auth/google/callback` (if Host is pages.dev)
3. Enable Google+ / People API / userinfo scopes (openid email profile).

## Migrate

```bash
npx wrangler d1 migrations apply houdini-bet-db --remote
```

Includes `0029_users_auth.sql` (users + sessions) and `0030_users_username.sql` (`username` UNIQUE, nullable for Google).

## Register / login

- Register fields: **username** (ID, `^[a-z0-9_]{3,20}$`, UI example `ej. usuario01`), name, email, phone, password (+ confirm).
- Login accepts **username or email** in `identifier` (legacy body `email` still accepted).
- Password managers: `autocomplete="username"` on ID / login identifier; `new-password` / `current-password` on passwords.
- After email register: welcome banner ~3s, then centered Premium upsell modal (`POST /api/v1/premium/session`).

## Smoke

- Register via UI → `GET /api/v1/auth/me` returns user with `username`
- Login with username or email
- Logout → me returns `{ user: null }`
- Google only works after secrets + redirect URIs

