/** Tests for the PWA layer: service worker strategy, registration and manifest. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(HERE, '../public');
const SW = readFileSync(resolve(PUBLIC, 'sw.js'), 'utf8');
const APP = readFileSync(resolve(PUBLIC, 'app.js'), 'utf8');
const HTML = readFileSync(resolve(PUBLIC, 'index.html'), 'utf8');
const MANIFEST = JSON.parse(readFileSync(resolve(PUBLIC, 'manifest.webmanifest'), 'utf8'));

let passed = 0;
let failed = 0;
function check(label, condition) {
  if (condition) {
    passed += 1;
    console.log(`ok   ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL ${label}`);
  }
}

check('service worker precaches the app shell', SW.includes('SHELL_ASSETS') && SW.includes('/index.html'));
const appVersion = HTML.match(/\/app\.js\?v=([\w.-]+)/)?.[1];
check('shell precache matches the versions used by the page',
  Boolean(appVersion) &&
    SW.includes(`'/app.js?v=${appVersion}'`) &&
    SW.includes(`'/styles.css?v=${appVersion}'`) &&
    HTML.includes(`/app.js?v=${appVersion}`) &&
    HTML.includes(`/styles.css?v=${appVersion}`));
check('shell assets are cached one by one so a miss cannot break install',
  SW.includes('Promise.all') && SW.includes('cache.put(url, res.clone())'));
check('old caches are removed on activate', SW.includes('caches.delete(key)'));
check('new worker takes over immediately', SW.includes('self.skipWaiting()') && SW.includes('self.clients.claim()'));
check('api requests are network first with an offline fallback',
  SW.includes('networkFirstApi') && SW.includes('caches.open(DATA_CACHE)'));
check('offline api fallback answers with json, not html',
  SW.includes("'content-type': 'application/json; charset=utf-8'") && SW.includes('status: 503'));
check('admin and sync endpoints are never cached',
  SW.includes("'/api/v1/admin'") && SW.includes("'/api/v1/sync'") && SW.includes('isNeverCached(url)'));
check('navigations fall back to the cached shell',
  SW.includes('networkFirstNavigation') && SW.includes("cache.match('/index.html')"));
check('static assets use stale-while-revalidate', SW.includes('staleWhileRevalidate'));
check('spa html fallback is never cached as an asset',
  SW.includes('looksLikeSpaFallback') && SW.includes('!looksLikeSpaFallback(res)'));
check('only same-origin GET requests are intercepted',
  SW.includes("request.method !== 'GET'") && SW.includes('url.origin !== self.location.origin'));

check('app registers the service worker', APP.includes("navigator.serviceWorker.register('/sw.js'"));
check('registration is skipped outside secure contexts', APP.includes('location.protocol'));
check('offline state is announced to the user',
  APP.includes("window.addEventListener('offline'") && APP.includes('Sin conexión'));
check('reconnection triggers a refresh', APP.includes("window.addEventListener('online'"));

check('manifest declares an installable app',
  MANIFEST.display === 'standalone' && MANIFEST.start_url === '/' && MANIFEST.name);
check('manifest has a 192 and a 512 icon',
  MANIFEST.icons.some((i) => i.sizes === '192x192') && MANIFEST.icons.some((i) => i.sizes === '512x512'));
check('manifest keeps the brand theme', MANIFEST.theme_color === '#0A0A0A' && MANIFEST.background_color === '#0A0A0A');
check('page links the manifest and the apple touch icon',
  HTML.includes('/manifest.webmanifest') && HTML.includes('apple-touch-icon.png'));
check('page sets a dark theme colour and a notch friendly viewport',
  HTML.includes('name="theme-color"') && HTML.includes('viewport-fit=cover'));

console.log(failed ? `\n${failed} checks failed` : `\n${passed}/${passed} checks passed`);
process.exit(failed ? 1 : 0);
