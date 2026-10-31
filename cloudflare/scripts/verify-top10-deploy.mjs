const base = 'https://houdini-bet.ivanmarrtin2703.workers.dev';
const html = await (await fetch(`${base}/`)).text();
const m = html.match(/app\.js\?v=([\w.-]+)/);
console.log('workers script', m?.[1] || null);
const app = await (await fetch(`${base}/app.js?v=${m?.[1] || 'hb45'}`)).text();
console.log('has WINDOW', app.includes('TOP10_WINDOW_DAYS'));
console.log('has days fetch', app.includes('days=${TOP10_WINDOW_DAYS}'));
console.log(
  'render uses date=',
  /async function renderTop3[\s\S]{0,900}matches\/today\?date=/.test(app)
);
console.log('uses resolveSelectedDate', /async function renderTop3[\s\S]{0,900}resolveSelectedDate\(/.test(app));
try {
  const ph = await (await fetch('https://houdini-bet.pages.dev/')).text();
  const pm = ph.match(/app\.js\?v=([\w.-]+)/);
  console.log('pages script', pm?.[1] || null);
} catch (e) {
  console.log('pages', e.message);
}
