// Burst-rider entry for "Pump.fun Paper Sprint: Any Bot Can Win".
//
// The grader runs `node main.ts` and speaks agent-fun/replay/v2 over
// stdin/stdout: first a hello that names the capital, the caps and the fees,
// then one batch per slot of market data, and finally a done. For every
// batch the bot answers with one reply carrying that slot's orders — buys
// and sells the strategy chose from the tape so far — and the harness fills
// them two slots later. The strategy itself lives in strategy.ts; this file
// only wires it to the wire protocol in vendor/makefun-bot.ts.
//
// Paper trading only: no real funds move, no network is touched, and every
// decision is a pure function of the batches already received, so the two
// grading runs agree order for order.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
