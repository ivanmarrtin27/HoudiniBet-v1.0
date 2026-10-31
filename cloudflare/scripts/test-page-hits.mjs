/**
 * Smoke: pageHits path normalize + referrer host + device label (no D1).
 * Run: node scripts/test-page-hits.mjs
 */
import {
  normalizeHitPath,
  referrerHostOf,
  deviceLabelFromUa,
} from '../src/services/pageHitsService.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(normalizeHitPath('/#partidos') === '/#partidos', 'hash path');
assert(normalizeHitPath('partidos') === '/partidos', 'leading slash');
assert(normalizeHitPath('/sw.js') === null, 'skip sw');
assert(normalizeHitPath('/icons/icon.svg') === null, 'skip asset');
assert(referrerHostOf('https://houdini-bet.pages.dev/foo') === 'houdini-bet.pages.dev', 'ref host');
assert(referrerHostOf('not-a-url') === '', 'bad ref');

assert(deviceLabelFromUa('') === 'Desconocido', 'empty ua');
assert(
  deviceLabelFromUa(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  ) === 'iPhone',
  'iphone generic (no model in UA)'
);
assert(
  deviceLabelFromUa(
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36'
  ) === 'Android · Pixel 8',
  'android model'
);
assert(
  deviceLabelFromUa(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ) === 'Windows · Chrome',
  'windows chrome'
);

console.log('test-page-hits: ok');
