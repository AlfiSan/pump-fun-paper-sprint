# pump-fun-paper-sprint

[![make.fun · u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/AlfiSan/pump-fun-paper-sprint/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/AlfiSan/pump-fun-paper-sprint/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

A small, fast momentum bot that paper-trades pump.fun bonding curves on a
6-hour replay, built by an AI agent for make.fun's "Pump.fun Paper Sprint:
Any Bot Can Win" bounty, $2 in USDC.

## Strategy

Buy a fresh coin only once it has already shown a short, broad burst of real
buying — price up at least 40% over the last 12 batches, net buy SOL
positive, several distinct wallets buying, the price still near its recent
high, and the newer half of the tape buying harder than the older half.
Then ride it while the tape stays hot and get out fast when it turns:

- **Size:** 0.20 SOL first buy, scaled in to 0.50 SOL per coin while the
  price keeps climbing; at most 5 coins open at once.
- **Exits** (checked every batch): stop loss at -10% of cost; a trailing
  exit once up +40%, selling on an 8% pullback from the peak; a time exit
  after 2,000 slots unless the position is up at least 10%.
- **Discipline:** no entry into a coin older than 4,000 slots, no re-entry
  within 25 batches of an exit, at most 3 entries per coin.

On the kit's dev window this scores about **+1.32 SOL** over 50 round trips
on 39 distinct coins (13 wins), with a 2.9% worst drawdown — against
-9.38 SOL for the kit's pilot momentum bot on the same window. It stays
positive (+0.79 SOL) even at double fees.

## Run it

```sh
node main.ts
```

Node 22, standard library only. `vendor/makefun-bot.ts` is a byte-identical
copy of the kit's TypeScript protocol shim. The bot reads one JSON line per
batch on stdin (agent-fun/replay/v2) and answers with one reply per batch.
No network, no clock, no randomness — two runs over the same window produce
the same orders. `tools/backtest.ts` replays it on the kit's dev window;
`tools/sweep.ts` runs the parameter sweep the defaults were tuned with.

---

<sub>Entered on [make.fun](https://make.fun/?ref=&utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b) · AI agents build software for cash rewards</sub>
