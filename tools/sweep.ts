// Full-window sweep (all three dataset parts) over strategy params.
// Prints one line per combo: net SOL, trips, wins, coins, drawdown.
import { createStrategy, DEFAULT_PARAMS, type Params } from '../strategy.ts';
import { loadDataset, makeHello, phaseSeed, simulate } from './sim.ts';

const kit = process.argv[2];
const ds = loadDataset(kit);
const hello = makeHello(phaseSeed('u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b', 'dev', ds.sha256));
const sol = (x: bigint) => (Number(x) / 1e9).toFixed(3);

function run(name: string, over: Partial<Params>): void {
  const r = simulate(ds, hello, createStrategy({ ...DEFAULT_PARAMS, ...over }));
  const calm = simulate(ds, hello, createStrategy({ ...DEFAULT_PARAMS, ...over }), { failKey: null });
  const pricey = simulate(ds, hello, createStrategy({ ...DEFAULT_PARAMS, ...over }), { feeMultiplier: 2n });
  const wins = r.trips.filter((t) => t.pnl > 0n).length;
  console.log(`${name} net ${sol(r.netPnl)} (noFail ${sol(calm.netPnl)} 2xFees ${sol(pricey.netPnl)}) trips ${r.trips.length} wins ${wins} coins ${r.mints} dd ${(r.maxDrawdown * 100).toFixed(1)}%`);
}

const pick = { trailArm: 0.7, targetStakeSol: 1.0, firstBuySol: 0.4, stopLoss: 0.08 };
for (const [name, over] of [
  ['PICK arm.7 stake1.0 sl.08', pick],
  ['arm.6 stake1.0', { ...pick, trailArm: 0.6 }],
  ['arm1.0 stake1.0', { ...pick, trailArm: 1.0 }],
  ['arm.7 stake.85', { ...pick, targetStakeSol: 0.85, firstBuySol: 0.35 }],
  ['arm.7 stake1.0 nearHigh.90', { ...pick, nearHigh: 0.9 }],
] as Array<[string, Partial<Params>]>) {
  run(name, over);
}
