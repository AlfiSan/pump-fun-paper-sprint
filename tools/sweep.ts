// Quick offline sweep over strategy params on the dev window.
// Prints one line per combo: net SOL, trips, wins, coins, drawdown.
import { createStrategy, DEFAULT_PARAMS, type Params } from '../strategy.ts';
import { loadDataset, makeHello, phaseSeed, simulate } from './sim.ts';

const kit = process.argv[2];
const ds = loadDataset(kit);
const hello = makeHello(phaseSeed('u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b', 'dev', ds.sha256));
const sol = (x: bigint) => (Number(x) / 1e9).toFixed(3);

function run(name: string, over: Partial<Params>): void {
  const r = simulate(ds, hello, createStrategy({ ...DEFAULT_PARAMS, ...over }));
  const wins = r.trips.filter((t) => t.pnl > 0n).length;
  console.log(`${name} net ${sol(r.netPnl)} trips ${r.trips.length} wins ${wins} coins ${r.mints} dd ${(r.maxDrawdown * 100).toFixed(1)}%`);
}

const best = { minRise: 0.4, fadeNetSol: -100, stopLoss: 0.08, trailGiveback: 0.08, trailArm: 0.4 };
for (const [name, over] of [
  ['stake.5 rise.45', { ...best, targetStakeSol: 0.5, firstBuySol: 0.2, minRise: 0.45 }],
  ['stake.5 sl.10', { ...best, targetStakeSol: 0.5, firstBuySol: 0.2, stopLoss: 0.1 }],
  ['stake.5 rise.45 sl.10', { ...best, targetStakeSol: 0.5, firstBuySol: 0.2, minRise: 0.45, stopLoss: 0.1 }],
  ['stake.5 rise.45 gb.06', { ...best, targetStakeSol: 0.5, firstBuySol: 0.2, minRise: 0.45, trailGiveback: 0.06 }],
  ['stake.5 rise.45 arm.50', { ...best, targetStakeSol: 0.5, firstBuySol: 0.2, minRise: 0.45, trailArm: 0.5 }],
  ['stake.5 rise.45 fade-5', { ...best, targetStakeSol: 0.5, firstBuySol: 0.2, minRise: 0.45, fadeNetSol: -5 }],
] as Array<[string, Partial<Params>]>) {
  run(name, over);
}
