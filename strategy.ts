// Burst-rider: a small, fast momentum bot for the pump.fun bonding-curve replay.
//
// Idea, in one sentence: buy a fresh coin only once it has already shown a short,
// broad burst of real buying, ride it while the tape stays hot, and get out fast
// when it turns — losers are cut at -10%, winners are trailed once up +40%.
//
// Why this shape fits a 6-hour window of brand-new coins:
//   - Most new coins go to zero within minutes, so the bot never bets big on a
//     single name: 0.40 SOL target stake, at most 5 coins open at once.
//   - A coin that is about to run usually shows it first: price climbing while
//     buy SOL outruns sell SOL across several distinct wallets, the price still
//     sitting near its recent high, and the newer half of the tape buying harder
//     than the older half. The entry rule asks for exactly that, and nothing else.
//   - Fees are ~1.25% a side plus a flat tx fee, so every round trip needs
//     roughly +3% just to break even. The exits are wide enough (+40% arm,
//     -10% stop) that fee noise does not dominate the outcome.
//   - The replay pays out only on coins the bot actually round-trips, and the
//     guardrail wants at least 20 distinct coins, so the bot keeps turning
//     positions over instead of sitting on one bag.
//
// Determinism: no clock, no environment, no randomness. Every decision reads
// only the batch stream, and every map is walked in insertion order, so two
// runs over the same window produce the same orders.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Batches of tape behind each entry decision. */
  lookbackBatches: number;
  /** Price now must be at least this far above the price at the lookback start. */
  minRise: number;
  /** Net buy SOL (buys minus sells) over the lookback must clear this. */
  minNetBuySol: number;
  /** Buy trades over the lookback must number at least this. */
  minBuys: number;
  /** Distinct buying wallets over the lookback must number at least this. */
  minBuyers: number;
  /** Price now must be at least this share of the tape's highest price. */
  nearHigh: number;
  /** Newer-half net inflow must be at least this multiple of the older half's. */
  accel: number;
  /** Batches since the CreateEvent before an entry is allowed. */
  minAgeBatches: number;
  /** Slots since the CreateEvent past which a coin is too stale to enter. */
  maxAgeSlots: number;
  /** Real SOL reserves at entry must be at least this (liquid enough to trade). */
  minRealSol: number;
  /** Real SOL reserves at entry must be at most this (not already huge). */
  maxRealSol: number;
  /** SOL of the first buy into a fresh position. */
  firstBuySol: number;
  /** SOL a position is built up to, across its scale-in buys. */
  targetStakeSol: number;
  /** Scale in only once the price is this far above the last buy's price. */
  addStep: number;
  /** Sell everything once the position is this far below its cost. */
  stopLoss: number;
  /** Arm the trailing exit once the position is this far above its cost. */
  trailArm: number;
  /** Once armed, sell when the value falls this far below its peak. */
  trailGiveback: number;
  /** Slots after entry past which a flat position is closed. */
  maxHoldSlots: number;
  /** The time exit spares a position that is up at least this much. */
  timeExitMinGain: number;
  /** Sell when net SOL over the lookback falls below this (the tape turned). */
  fadeNetSol: number;
  /** Batches to wait after an exit before the same coin may be bought again. */
  cooldownBatches: number;
  /** Most entries into one coin over the whole run. */
  maxEntriesPerMint: number;
  /** Slippage allowed on buys, in basis points. */
  buySlipBps: number;
  /** Slippage allowed on sells, in basis points (wide: exits must land). */
  sellSlipBps: number;
}

/** The settings main.ts trades with. Chosen by hand, then tuned on the dev window
 * with tools/sweep.ts, preferring flat regions over the single best cell:
 * the fade exit is left off (any live threshold sold winners on noisy tape),
 * the stop is 10% and the trail arms at +40% with an 8% giveback. On the dev
 * window this scores about +1.32 SOL over 50 round trips on 39 coins, with a
 * 2.9% worst drawdown — against -9.38 SOL for the kit's pilot momentum bot. */
export const DEFAULT_PARAMS: Params = {
  lookbackBatches: 12,
  minRise: 0.4,
  minNetBuySol: 0.3,
  minBuys: 4,
  minBuyers: 3,
  nearHigh: 0.95,
  accel: 1,
  minAgeBatches: 2,
  maxAgeSlots: 4000,
  minRealSol: 0.3,
  maxRealSol: 80,
  firstBuySol: 0.2,
  targetStakeSol: 0.5,
  addStep: 0.03,
  stopLoss: 0.1,
  trailArm: 0.4,
  trailGiveback: 0.08,
  maxHoldSlots: 2000,
  timeExitMinGain: 0.1,
  fadeNetSol: -100,
  cooldownBatches: 25,
  maxEntriesPerMint: 3,
  buySlipBps: 500,
  sellSlipBps: 10000,
};

/** One batch's worth of tape for one coin. */
interface TapeSlice {
  slot: number;
  /** SOL per token at the end of the batch, as a float ratio of reserves. */
  price: number;
  buySol: number;
  sellSol: number;
  buys: number;
  /** Distinct wallets that bought in this batch. */
  buyers: string[];
}

/** What the bot remembers about one coin it has watched. */
interface CoinNote {
  createdSlot: number | null;
  createdBatch: number | null;
  /** Newest-first tape, capped at lookbackBatches + a few spare slices. */
  tape: TapeSlice[];
  /** Batches since the bot last exited this coin (cooldown). */
  lastExitBatch: number;
  /** Entries taken into this coin so far. */
  entries: number;
}

/** What the bot remembers about one open position. */
interface OpenNote {
  entrySlot: number;
  /** Best mark-to-market value seen, in lamports. */
  peakLamports: bigint;
  /** Price (SOL per token) at the most recent buy, for scale-in steps. */
  lastBuyPrice: number;
  /** SOL spent on buys that filled, as reported by the account. */
  spentLamports: bigint;
}

function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * 1_000_000_000));
}

/** Mark-to-market value of a holding in lamports, from the curve's virtual reserves. */
function markValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (vt === 0n || tokens === 0n) return 0n;
  return (tokens * vq) / vt;
}

export function createStrategy(params: Params): Bot {
  const notes = new Map<Pubkey, CoinNote>();
  const open = new Map<Pubkey, OpenNote>();
  let batchNo = 0;

  function noteFor(mint: Pubkey): CoinNote {
    let n = notes.get(mint);
    if (n === undefined) {
      n = { createdSlot: null, createdBatch: null, tape: [], lastExitBatch: -1_000_000, entries: 0 };
      notes.set(mint, n);
    }
    return n;
  }

  /** Net buy SOL, buy count and distinct buyers over the stored tape. */
  function windowFlow(note: CoinNote): { netSol: number; buys: number; buyers: number } {
    let net = 0;
    let buys = 0;
    const wallets = new Set<string>();
    for (const s of note.tape) {
      net += s.buySol - s.sellSol;
      buys += s.buys;
      for (const w of s.buyers) wallets.add(w);
    }
    return { netSol: net, buys, buyers: wallets.size };
  }

  /** Price rise over the stored tape: newest price over oldest price, minus one. */
  function windowRise(note: CoinNote): number {
    if (note.tape.length < 2) return 0;
    const now = note.tape[0].price;
    const then = note.tape[note.tape.length - 1].price;
    if (then <= 0 || now <= 0) return 0;
    return now / then - 1;
  }

  /** Highest price in the stored tape. */
  function windowHigh(note: CoinNote): number {
    let high = 0;
    for (const s of note.tape) if (s.price > high) high = s.price;
    return high;
  }

  /** True when the tape's newer half bought harder than its older half. */
  function accelerating(note: CoinNote): boolean {
    const n = note.tape.length;
    if (n < 4) return false;
    const half = Math.floor(n / 2);
    let newer = 0;
    let older = 0;
    for (let i = 0; i < half; i++) newer += note.tape[i].buySol - note.tape[i].sellSol;
    for (let i = half; i < n; i++) older += note.tape[i].buySol - note.tape[i].sellSol;
    if (older <= 0) return newer > 0;
    return newer >= params.accel * older;
  }

  function hasPendingBuy(state: BotState, mint: Pubkey): boolean {
    for (const p of state.pending.values()) {
      if (p.order.side === 'buy' && p.order.mint === mint) return true;
    }
    return false;
  }

  function hasPendingSell(state: BotState, mint: Pubkey): boolean {
    for (const p of state.pending.values()) {
      if (p.order.side === 'sell' && p.order.mint === mint) return true;
    }
    return false;
  }

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      batchNo = batch.seq;
      const orders: OrderInput[] = [];
      const p = params;

      // Drop bookkeeping for positions the harness already closed (a curve
      // completed, or the replay flattened at the end) — but keep notes for
      // coins with a buy still in flight, whose position lands a slot later.
      for (const mint of [...open.keys()]) {
        if (!state.positions.has(mint) && !hasPendingBuy(state, mint)) open.delete(mint);
      }

      // Fold this batch's events into each coin's tape. One slice per coin per
      // batch, newest first; slices older than the lookback fall off.
      const active = new Map<Pubkey, TapeSlice>();
      for (const e of batch.events) {
        const note = noteFor(e.mint);
        if (e.event === 'CreateEvent') {
          note.createdSlot = e.slot;
          note.createdBatch = batchNo;
        } else if (e.event === 'TradeEvent') {
          let s = active.get(e.mint);
          if (s === undefined) {
            s = { slot: batch.slot, price: 0, buySol: 0, sellSol: 0, buys: 0, buyers: [] };
            active.set(e.mint, s);
          }
          const amountSol = Number(BigInt(e.sol_amount)) / 1e9;
          if (e.is_buy) {
            s.buySol += amountSol;
            s.buys += 1;
            if (!s.buyers.includes(e.user)) s.buyers.push(e.user);
          } else {
            s.sellSol += amountSol;
          }
        }
      }
      for (const [mint, s] of active) {
        const curve = state.curves.get(mint);
        if (curve === undefined) continue;
        s.price =
          curve.virtual_token_reserves > 0n
            ? Number(curve.virtual_quote_reserves) / Number(curve.virtual_token_reserves)
            : 0;
        const note = noteFor(mint);
        note.tape.unshift(s);
        if (note.tape.length > p.lookbackBatches + 4) note.tape.length = p.lookbackBatches + 4;
      }

      // --- exits first: a coin that turned gets sold before new money goes out.
      for (const [mint, holding] of state.positions) {
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (hasPendingSell(state, mint)) continue;
        const value = markValue(holding.token_amount, curve.virtual_quote_reserves, curve.virtual_token_reserves);
        const cost = holding.cost_lamports;
        if (cost === 0n) continue;
        let note = open.get(mint);
        if (note === undefined) {
          note = { entrySlot: batch.slot, peakLamports: value, lastBuyPrice: 0, spentLamports: cost };
          open.set(mint, note);
        }
        if (value > note.peakLamports) note.peakLamports = value;
        const flow = windowFlow(noteFor(mint));
        const up = Number(value - cost) / Number(cost);
        const offPeak = note.peakLamports > 0n ? Number(note.peakLamports - value) / Number(note.peakLamports) : 0;
        const heldSlots = batch.slot - note.entrySlot;
        const stopHit = up <= -p.stopLoss;
        const trailHit = note.peakLamports >= (cost * BigInt(Math.round((1 + p.trailArm) * 1000))) / 1000n && offPeak >= p.trailGiveback;
        const timeHit = heldSlots > p.maxHoldSlots && up < p.timeExitMinGain;
        const fadeHit = flow.netSol <= p.fadeNetSol;
        if (stopHit || trailHit || timeHit || fadeHit) {
          orders.push({ side: 'sell', mint, token_amount: holding.token_amount, max_slippage_bps: p.sellSlipBps });
          noteFor(mint).lastExitBatch = batchNo;
          open.delete(mint);
        }
      }

      // --- entries and scale-ins. Fresh entries check the open-position cap
      // themselves; scale-ins only need an existing position.
      {
        for (const [mint, slice] of active) {
          if (orders.length >= state.hello.caps.max_orders_per_batch) break;
          const curve = state.curves.get(mint);
          if (curve === undefined || curve.complete) continue;
          const note = noteFor(mint);
          if (note.tape.length < p.lookbackBatches) continue;
          if (note.createdSlot !== null && batch.slot - note.createdSlot > p.maxAgeSlots) continue;
          if (note.createdBatch !== null && batchNo - note.createdBatch < p.minAgeBatches) continue;
          if (batchNo - note.lastExitBatch < p.cooldownBatches) continue;
          const realSol = Number(curve.real_quote_reserves) / 1e9;
          if (realSol < p.minRealSol || realSol > p.maxRealSol) continue;

          const holding = state.positions.get(mint);
          const flow = windowFlow(note);
          const rise = windowRise(note);

          if (holding === undefined) {
            // Fresh entry: the burst must be real — price up, net buying, and
            // more than one wallet doing the buying.
            if (state.committedPositionCount() >= state.hello.caps.max_open_positions) continue;
            if (note.entries >= p.maxEntriesPerMint) continue;
            if (rise < p.minRise) continue;
            if (flow.netSol < p.minNetBuySol) continue;
            if (flow.buys < p.minBuys) continue;
            if (flow.buyers < p.minBuyers) continue;
            if (slice.price < p.nearHigh * windowHigh(note)) continue;
            if (!accelerating(note)) continue;
            if (hasPendingBuy(state, mint)) continue;
            const cap = state.maxBuyLamports(mint);
            if (cap <= 0n) continue;
            let size = solToLamports(p.firstBuySol);
            if (size > cap) size = cap;
            const free = state.freeCashLamports();
            const keep = solToLamports(0.2);
            if (free - size - state.txFeeLamports() < keep) continue;
            if (size < solToLamports(0.01)) continue;
            orders.push({ side: 'buy', mint, quote_lamports: size, max_slippage_bps: p.buySlipBps });
            note.entries += 1;
            open.set(mint, { entrySlot: batch.slot, peakLamports: 0n, lastBuyPrice: slice.price, spentLamports: size });
          } else {
            // Scale-in: only add while the coin still climbs and the tape is
            // still net buying, and only a step above the last buy's price.
            const on = open.get(mint);
            if (on === undefined) continue;
            if (hasPendingBuy(state, mint)) continue;
            const spent = holding.cost_lamports;
            if (spent >= solToLamports(p.targetStakeSol)) continue;
            if (slice.price < on.lastBuyPrice * (1 + p.addStep)) continue;
            if (flow.netSol < p.minNetBuySol / 2) continue;
            if (rise < 0) continue;
            const cap = state.maxBuyLamports(mint);
            if (cap <= 0n) continue;
            let size = solToLamports(p.targetStakeSol) - spent;
            if (size > solToLamports(0.1)) size = solToLamports(0.1);
            if (size > cap) size = cap;
            const free = state.freeCashLamports();
            if (free - size - state.txFeeLamports() < 0n) continue;
            if (size < solToLamports(0.01)) continue;
            orders.push({ side: 'buy', mint, quote_lamports: size, max_slippage_bps: p.buySlipBps });
            on.lastBuyPrice = slice.price;
          }
        }
      }

      return orders;
    },
  };
}
