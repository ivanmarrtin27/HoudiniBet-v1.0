/**
 * Checks for the live (in-play) projection.
 *
 *   node scripts/test-live-model.mjs
 *
 * No test runner needed: the script exits with code 1 on the first failure.
 */
import {
  remainingMinutes,
  liveSnapshot,
  projectLive,
  liveTipStatus,
  inferLambdas,
  buildLiveBlock,
} from '../src/services/liveModel.js';
import { buildScoreMatrix, marketsFromMatrix } from '../src/services/matchModel.js';

let failures = 0;
let checks = 0;

function check(name, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`ok   ${name}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

function near(a, b, tol = 0.02) {
  return Math.abs(Number(a) - Number(b)) <= tol;
}

const HOME_XG = 1.8;
const AWAY_XG = 1.0;

/* --- remaining minutes ------------------------------------------------- */
check('remaining at kickoff is the whole match', remainingMinutes(0) === 95);
check('remaining at half time is about half', remainingMinutes(45) === 50);
check('remaining at 90 is the stoppage tail', remainingMinutes(90) === 5);
check('remaining inside stoppage is short', remainingMinutes(92) === 0);
check('remaining never goes negative', remainingMinutes(120) === 0);

/* --- live snapshot ----------------------------------------------------- */
const snap = liveSnapshot({
  status: 'live',
  elapsedMinute: 63,
  homeGoals: 2,
  awayGoals: 1,
  events: [
    { type: 'goal', minute: 12, isHome: true },
    { type: 'goal', minute: 40, isHome: false },
    { type: 'goal', minute: 55, isHome: true },
  ],
});
check('snapshot keeps the scoreline', snap.homeGoals === 2 && snap.awayGoals === 1, JSON.stringify(snap));
check('snapshot keeps the minute', snap.minute === 63);
check('snapshot counts remaining minutes', snap.remaining === remainingMinutes(63));

const snapNoScore = liveSnapshot({
  status: 'live',
  elapsedMinute: null,
  events: [
    { type: 'goal', minute: 8, isHome: true },
    { type: 'red', minute: 30, isHome: false },
  ],
});
check('snapshot falls back to the timeline score', snapNoScore.homeGoals === 1 && snapNoScore.awayGoals === 0);
check('snapshot falls back to the last event minute', snapNoScore.minute === 30);

const snapFinished = liveSnapshot({ status: 'finished', homeGoals: 3, awayGoals: 0, elapsedMinute: null });
check('finished matches have no remaining time', snapFinished.remaining === 0);

/* --- projection -------------------------------------------------------- */
const preMatrix = buildScoreMatrix(HOME_XG, AWAY_XG, 8, -0.08);
const pre = marketsFromMatrix(preMatrix);

const atKickoff = projectLive({
  homeXg: HOME_XG,
  awayXg: AWAY_XG,
  homeGoals: 0,
  awayGoals: 0,
  minute: 0,
});
check(
  'at kickoff the projection matches the pre-match model',
  near(atKickoff.markets.homeWin, pre.homeWin, 0.03) &&
    near(atKickoff.markets.draw, pre.draw, 0.03) &&
    near(atKickoff.markets.awayWin, pre.awayWin, 0.03),
  `live ${atKickoff.markets.homeWin.toFixed(3)} vs pre ${pre.homeWin.toFixed(3)}`
);

const late = projectLive({
  homeXg: HOME_XG,
  awayXg: AWAY_XG,
  homeGoals: 2,
  awayGoals: 0,
  minute: 88,
});
check('two goals up at 88 minutes is a certain home win', late.markets.homeWin > 0.99, String(late.markets.homeWin));
check('two goals up at 88 minutes is a certain draw=no', late.markets.draw < 0.005, String(late.markets.draw));
check('two goals up at 88 minutes still allows one more goal', late.markets.over25 > 0.05 && late.markets.over25 < 0.5, String(late.markets.over25));

const hatTrick = projectLive({
  homeXg: HOME_XG,
  awayXg: AWAY_XG,
  homeGoals: 3,
  awayGoals: 0,
  minute: 60,
});
check('three goals already means over 2.5 is decided', hatTrick.markets.over25 > 0.999, String(hatTrick.markets.over25));

const lateDraw = projectLive({
  homeXg: HOME_XG,
  awayXg: AWAY_XG,
  homeGoals: 0,
  awayGoals: 0,
  minute: 88,
});
check('goalless at 88 minutes is a very likely draw', lateDraw.markets.draw > 0.75, String(lateDraw.markets.draw));
check('goalless at 88 minutes leaves the home win barely alive', lateDraw.markets.homeWin < 0.2, String(lateDraw.markets.homeWin));

const veryLate = projectLive({
  homeXg: HOME_XG,
  awayXg: AWAY_XG,
  homeGoals: 0,
  awayGoals: 0,
  minute: 94,
});
check('goalless at 94 minutes is a decided draw', veryLate.markets.draw > 0.99, String(veryLate.markets.draw));
check('goalless at 94 minutes kills the home win', veryLate.markets.homeWin < 0.01, String(veryLate.markets.homeWin));

const oneNil = projectLive({
  homeXg: HOME_XG,
  awayXg: AWAY_XG,
  homeGoals: 1,
  awayGoals: 0,
  minute: 20,
});
check('early lead still favours the home side', oneNil.markets.homeWin > pre.homeWin, String(oneNil.markets.homeWin));
check('early lead still allows a draw', oneNil.markets.draw > 0.05, String(oneNil.markets.draw));

const bttsDone = projectLive({
  homeXg: HOME_XG,
  awayXg: AWAY_XG,
  homeGoals: 1,
  awayGoals: 1,
  minute: 30,
});
check('both teams scored means BTTS yes is certain', bttsDone.markets.bttsYes > 0.999, String(bttsDone.markets.bttsYes));
check('both teams scored means BTTS no is dead', bttsDone.markets.bttsNo < 0.001, String(bttsDone.markets.bttsNo));

/* --- tip status -------------------------------------------------------- */
check('home win is secured when two goals up late', liveTipStatus('HOME_WIN', late.markets) === 'secured');
check('home win is dead when goalless at the very end', liveTipStatus('HOME_WIN', veryLate.markets) === 'dead');
check('home win is alive with an early lead', liveTipStatus('HOME_WIN', oneNil.markets) === 'alive');
check('over 2.5 is secured with three goals', liveTipStatus('OVER_25', hatTrick.markets) === 'secured');
check('BTTS yes is secured when both scored', liveTipStatus('BTTS_YES', bttsDone.markets) === 'secured');
check('BTTS no is dead when both scored', liveTipStatus('BTTS_NO', bttsDone.markets) === 'dead');
check('count markets have no live status', liveTipStatus('CORNERS_OVER_95', late.markets) === 'unknown');

/* --- lambda recovery --------------------------------------------------- */
const stored = {
  home_win_prob: pre.homeWin,
  draw_prob: pre.draw,
  away_win_prob: pre.awayWin,
  over25_prob: pre.over25,
  btts_yes_prob: pre.bttsYes,
};
const inferred = inferLambdas(stored);
check('lambdas are recovered from the pre-match probabilities', inferred != null);
if (inferred) {
  check(
    'recovered home xG is close to the original',
    near(inferred.homeXg, HOME_XG, 0.12),
    `${inferred.homeXg} vs ${HOME_XG}`
  );
  check(
    'recovered away xG is close to the original',
    near(inferred.awayXg, AWAY_XG, 0.12),
    `${inferred.awayXg} vs ${AWAY_XG}`
  );
}

/* --- payload ----------------------------------------------------------- */
const block = buildLiveBlock(
  {
    status: 'live',
    elapsedMinute: 70,
    homeGoals: 1,
    awayGoals: 0,
    events: [{ type: 'goal', minute: 20, isHome: true }],
  },
  {
    ...stored,
    home_xg: HOME_XG,
    away_xg: AWAY_XG,
    suggested_bet: 'HOME_WIN',
    secondary_bet: 'OVER_25',
  }
);
check('live block is built for a running match', block != null);
check('live block exposes the minute', block?.minute === 70);
check('live block exposes the live 1X2', block?.homeWin > 0 && block?.homeWin < 1);
check('live block carries the tip status', block?.tip?.status === 'alive');
check('live block carries the secondary tip status', block?.secondary?.status === 'alive');
check(
  'live block keeps the pre-match reference',
  block?.preMatch?.homeWin != null && block.preMatch.homeWin !== block.homeWin
);

const noLive = buildLiveBlock({ status: 'scheduled' }, stored);
check('no live block for a scheduled match', noLive === null);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
