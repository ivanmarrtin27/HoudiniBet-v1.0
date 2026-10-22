/** Static regression checks for the mobile browse/prediction interface. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(resolve(HERE, '../public/styles.css'), 'utf8');
const HTML = readFileSync(resolve(HERE, '../public/index.html'), 'utf8');
const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => [
  selector.trim(),
  body,
]);

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

function hasRule(selector, declaration) {
  return rules.some(
    ([selectors, body]) =>
      selectors.split(',').some((entry) => entry.trim() === selector) && body.includes(declaration)
  );
}

check('viewport supports notches and edge-to-edge display',
  HTML.includes('viewport-fit=cover') && CSS.includes('color-scheme: dark'));
const appVersion = HTML.match(/\/app\.js\?v=([\w.-]+)/)?.[1];
check('mobile assets bypass stale browser cache',
  Boolean(appVersion) && HTML.includes(`/styles.css?v=${appVersion}`) && HTML.includes(`/app.js?v=${appVersion}`));
check('sticky mobile header respects top safe area',
  /\.v2-header\s*\{[^}]*padding-top:\s*env\(safe-area-inset-top/.test(CSS));
check('mobile header uses a deliberate compact grid',
  /grid-template-areas:\s*"brand actions"\s*"nav nav"/.test(CSS));
check('primary navigation has a 44px mobile hit target',
  hasRule('.v2-nav__link', 'min-height: 44px'));
check('date center has visible keyboard focus', hasRule('.date-center:focus-visible', 'outline: 2px'));
check('section navigation has visible keyboard focus', hasRule('.v2-nav__link:focus-visible', 'outline: 2px'));
check('search focus is visible around its field', hasRule('.search-field:focus-within', 'outline: 2px'));
check('date/filter chips meet the 44px touch target',
  hasRule('.browse-layout .browse-chip', 'min-height: 44px'));
check('match rows have larger mobile hit area',
  hasRule('.browse-layout .league-match', 'min-height: 64px'));
check('prediction tabs meet the 44px touch target',
  hasRule('.browse-layout .mp-tabs__btn', 'min-height: 44px'));
check('league tabs meet the 44px touch target',
  hasRule('.browse-layout .ligas-tabs__btn', 'min-height: 44px'));
check('mobile header nav scrolls with native momentum and containment',
  hasRule('.v2-nav', 'overscroll-behavior-x: contain') &&
    hasRule('.v2-nav', '-webkit-overflow-scrolling: touch'));
check('sheets and search results contain overscroll',
  hasRule('.panel', 'overscroll-behavior-y: contain') &&
    hasRule('.search-panel', 'overscroll-behavior-y: contain'));
check('buttons and links use manipulation touch action',
  CSS.includes('touch-action: manipulation') && CSS.includes('-webkit-tap-highlight-color: rgba(220, 38, 38, 0.16)'));
check('reduced-motion preference remains respected',
  /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*scroll-behavior:\s*auto/.test(CSS));
check('small-phone breakpoint adapts header sizing',
  /@media\s*\(max-width:\s*380px\)[\s\S]*?\.v2-header \.brand__icon/.test(CSS));

console.log(failed ? `\n${failed} checks failed` : `\n${passed}/${passed} checks passed`);
process.exit(failed ? 1 : 0);
