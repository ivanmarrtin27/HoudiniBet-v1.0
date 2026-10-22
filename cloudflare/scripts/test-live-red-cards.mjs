/** Tests for the live red-card adjustment of the goal projection (F6). */
import { liveSnapshot, projectLive, buildLiveBlock } from '../src/services/liveModel.js';

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

/* ------------------------------------------------------------ event counting */
const snap = liveSnapshot({
  status: 'live',
  elapsedMinute: 45,
  events: [
    { type: 'goal', minute: 10, isHome: true },
    { type: 'red', minute: 20, isHome: true },
    { type: 'red', minute: 30, isHome: true },
    { type: 'red', minute: 35, isHome: false },
    { type: 'missed_pen', minute: 40, isHome: true },
    { type: 'yellow-card-unknown', minute: 42, isHome: true },
  ],
});
check('red cards are counted per side from the incidents', snap.redsHome === 2 && snap.redsAway === 1);
const quiet = liveSnapshot({ status: 'live', elapsedMinute: 30, events: [] });
check('a live match without incidents has no red cards', quiet.redsHome === 0 && quiet.redsAway === 0);

/* ------------------------------------------------------------ projection shift */
const L = { homeXg: 1.4, awayXg: 1.1, homeGoals: 0, awayGoals: 0, remaining: 60 };
const base = projectLive({ ...L, minute: 30 });
const redHome = projectLive({ ...L, minute: 30, redsHome: 1 });
const redAway = projectLive({ ...L, minute: 30, redsAway: 1 });
check('a home red lowers the home win probability in play', redHome.markets.homeWin < base.markets.homeWin);
check('a home red raises the away win probability in play', redHome.markets.awayWin > base.markets.awayWin);
check('a home red raises the draw probability in play', redHome.markets.draw > base.markets.draw);
check('the effect is mirrored for an away red', redAway.markets.awayWin < base.markets.awayWin && redAway.markets.homeWin > base.markets.homeWin);
check('the 1x2 projection stays normalized',
  Math.abs(base.markets.homeWin + base.markets.draw + base.markets.awayWin - 1) < 1e-6);

const swapA = projectLive({ homeXg: 1.4, awayXg: 1.1, homeGoals: 0, awayGoals: 0, remaining: 60, redsHome: 1 });
const swapB = projectLive({ homeXg: 1.1, awayXg: 1.4, homeGoals: 0, awayGoals: 0, remaining: 60, redsAway: 1 });
check('the adjustment is symmetric under venue swap',
  Math.abs(swapA.markets.homeWin - swapB.markets.awayWin) < 1e-9 &&
    Math.abs(swapA.markets.awayWin - swapB.markets.homeWin) < 1e-9 &&
    Math.abs(swapA.markets.draw - swapB.markets.draw) < 1e-9);

const twoReds = projectLive({ ...L, minute: 30, redsHome: 2 });
check('several red cards for a side compound', twoReds.markets.homeWin < redHome.markets.homeWin);
check('even extreme multi-red keeps valid probabilities',
  Number.isFinite(twoReds.markets.homeWin) && twoReds.markets.homeWin >= 0 && twoReds.markets.awayWin <= 1);

/* -------------------------------------------- only the minutes ahead are hit */
const late = projectLive({ ...L, minute: 80, remaining: 10 });
const lateRed = projectLive({ ...L, minute: 80, remaining: 10, redsHome: 1 });
const shiftEarly = Math.abs(redHome.markets.homeWin - base.markets.homeWin);
const shiftLate = Math.abs(lateRed.markets.homeWin - late.markets.homeWin);
check('a red in the last minutes moves the projection less than an early one', shiftLate < shiftEarly);

/* ------------------------------------------------------------ live block */
const prediction = {
  home_xg: 1.4,
  away_xg: 1.1,
  suggested_bet: 'OVER_25',
  secondary_bet: null,
  home_win_prob: 0.5,
  draw_prob: 0.25,
  away_win_prob: 0.25,
};
const liveMatch = (events) => ({
  status: 'live',
  elapsedMinute: 45,
  homeGoals: 0,
  awayGoals: 0,
  events,
});
const blockRed = buildLiveBlock(liveMatch([{ type: 'red', minute: 20, isHome: true }]), prediction);
const blockClean = buildLiveBlock(liveMatch([]), prediction);
check('the live block exposes the red card state',
  blockRed.redCards?.home === 1 && blockRed.redCards?.away === 0);
check('a clean live match reports zero red cards',
  blockClean.redCards?.home === 0 && blockClean.redCards?.away === 0);
check('the red card lowers the win probability inside the live block',
  blockRed.homeWin < blockClean.homeWin);
check('the tip status still comes out with valid fields',
  blockRed.tip?.label === 'OVER_25' && typeof blockRed.tip?.status === 'string');
check('a non-live match keeps returning no live block', buildLiveBlock({ status: 'finished' }, prediction) === null);

console.log(failed ? `\n${failed} checks failed` : `\n${passed}/${passed} checks passed`);
process.exit(failed ? 1 : 0);
