/** Regression tests for mobile date-swipe intent and gesture ownership. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_PATH = resolve(HERE, '../public/app.js');
const CSS_PATH = resolve(HERE, '../public/styles.css');
const src = readFileSync(APP_PATH, 'utf8');
const css = readFileSync(CSS_PATH, 'utf8');

function extractFunction(name) {
  const idx = src.indexOf(`function ${name}(`);
  if (idx < 0) throw new Error(`function ${name} not found`);
  const start = src.lastIndexOf('\n', idx) + 1;
  const paren = src.indexOf('(', idx);
  let parenDepth = 0;
  let bodyStart = -1;
  for (let i = paren; i < src.length; i += 1) {
    if (src[i] === '(') parenDepth += 1;
    else if (src[i] === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        bodyStart = src.indexOf('{', i);
        break;
      }
    }
  }
  let depth = 0;
  for (let i = bodyStart; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`function ${name} not closed`);
}

const selectorDecl = src.match(/const DAY_SWIPE_EXCLUDED_SELECTOR\s*=\s*[^;]+;/)?.[0];
if (!selectorDecl) throw new Error('DAY_SWIPE_EXCLUDED_SELECTOR declaration not found');
const api = new Function(
  'window',
  `${selectorDecl}\n${extractFunction('daySwipeIntent')}\n${extractFunction('isDaySwipeExcludedTarget')}\nreturn { daySwipeIntent, isDaySwipeExcludedTarget };`
)({ getComputedStyle: (node) => ({ overflowX: node.overflowX || 'visible' }) });

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

const intent = (values) => api.daySwipeIntent({ width: 390, ...values });
check('clean swipe right is accepted', intent({ dx: 78, dy: 8, dt: 280 }));
check('clean swipe left is accepted', intent({ dx: -78, dy: 8, dt: 280 }));
check('short horizontal movement is ignored', !intent({ dx: 69, dy: 0, dt: 200 }));
check('diagonal scroll is ignored', !intent({ dx: 80, dy: 42, dt: 240 }));
check('slow drag is ignored', !intent({ dx: 120, dy: 5, dt: 551 }));
check('threshold grows on wider screens', !api.daySwipeIntent({ dx: 80, dy: 0, dt: 200, width: 500 }));
check('non-finite gesture values are ignored', !intent({ dx: Infinity, dy: 0, dt: 200 }));

const zone = { nodeType: 1 };
const makeNode = ({ parentElement = null, excluded = false, scrollWidth = 100, clientWidth = 100, overflowX = 'visible' } = {}) => ({
  nodeType: 1,
  parentElement,
  scrollWidth,
  clientWidth,
  overflowX,
  closest: () => (excluded ? {} : null),
});
check('interactive targets are excluded',
  api.isDaySwipeExcludedTarget(makeNode({ excluded: true, parentElement: zone }), zone));
const scroller = makeNode({ parentElement: zone, scrollWidth: 240, clientWidth: 120, overflowX: 'auto' });
check('overflowing horizontal scroller targets are excluded',
  api.isDaySwipeExcludedTarget(makeNode({ parentElement: scroller }), zone));
const nonScroller = makeNode({ parentElement: zone, scrollWidth: 240, clientWidth: 120, overflowX: 'visible' });
check('overflow without horizontal scrolling is not excluded',
  !api.isDaySwipeExcludedTarget(makeNode({ parentElement: nonScroller }), zone));
check('missing event target fails safe', api.isDaySwipeExcludedTarget(null, zone));

check('date handler only shifts after daySwipeIntent approves',
  /if \(locked === 'v' \|\| !daySwipeIntent\([\s\S]*?\)\) return;\s*shiftDay\(/.test(src));
check('main-section swipe ignores gestures started in match list',
  src.includes("if (document.getElementById('listScreen')?.contains(target)) return;"));
check('date swipe is cancelled on touchcancel',
  /zone\.addEventListener\([\s\S]*?'touchcancel'[\s\S]*?tracking = false;/.test(src));

const cssRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
for (const selector of ['.market-tabs', '.mp-tabs', '.odds-stats', '.perf-families--bands']) {
  const hasContain = cssRules.some(
    ([, selectors, declarations]) =>
      selectors.includes(selector) && declarations.includes('overscroll-behavior-x: contain')
  );
  check(`${selector} contains horizontal overscroll`, hasContain);
}

console.log(failed ? `\n${failed} check(s) failed` : `\n${passed}/${passed} checks passed`);
process.exit(failed ? 1 : 0);
