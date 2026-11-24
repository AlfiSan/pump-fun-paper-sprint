// Offline replay of strategy.ts on the kit's dev window, using the vendored
// local engine in tools/sim.ts (a port of the kit's replay model; the grader's
// own engine is what scores, this is only for tuning here).
//
//   node tools/backtest.ts <kit dir> ['{"firstBuySol":0.2}'] [--trips]
//
// Prints net PnL in SOL, fills, distinct coins, round trips, win count,
// worst drawdown and why orders were rejected; --trips lists each round trip.

import { createStrategy, DEFAULT_PARAMS, type Params } from '../strategy.ts';
import { loadDataset, makeHello, phaseSeed, simulate } from './sim.ts';

const kit = process.argv[2];
if (kit === undefined) {
  console.error('usage: node tools/backtest.ts <kit dir> [params json] [--trips]');
  process.exit(2);
}
const overrides =
  process.argv[3] !== undefined && process.argv[3].startsWith('{') ? (JSON.parse(process.argv[3]) as Partial<Params>) : {};
const ds = loadDataset(kit);
const hello = makeHello(phaseSeed('u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b', 'dev', ds.sha256));
const params = { ...DEFAULT_PARAMS, ...overrides };
const r = simulate(ds, hello, createStrategy(params));
const sol = (x: bigint) => (Number(x) / 1e9).toFixed(6);
const wins = r.trips.filter((t) => t.pnl > 0n).length;
console.log(
  `net ${sol(r.netPnl)} SOL  fills ${r.fills}  coins ${r.mints}  trips ${r.trips.length}  wins ${wins}  dd ${(r.maxDrawdown * 100).toFixed(2)}%  rejected ${r.rejected} ${JSON.stringify(r.rejectReasons)}  failed ${r.failed}`,
);
const calm = simulate(ds, hello, createStrategy(params), { failKey: null });
const pricey = simulate(ds, hello, createStrategy(params), { feeMultiplier: 2n });
console.log(`no failed txs ${sol(calm.netPnl)}  at 2x fees ${sol(pricey.netPnl)}`);
if (process.argv.includes('--trips')) {
  for (const t of r.trips) console.log(t.mint.slice(0, 8), 'held', t.close - t.open, 'slots  pnl', sol(t.pnl));
}
