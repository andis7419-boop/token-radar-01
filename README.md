# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/andis7419-boop/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/andis7419-boop/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

The best token launch radar: a program that reads a sealed snapshot of every protocol DefiLlama tracks, finds the ones that still record no token, ranks them by what their launch would be worth, and hands in a web dashboard with the board, a detail view for every protocol, and the steps to farm it.

## How the value is worked out

Implied value = TVL × category multiple × growth multiplier × maturity multiplier. The category multiple is the median market-cap-to-TVL of the live protocols in that category, computed from the snapshot itself — the market's own pricing for that kind of protocol. Growth follows the protocol's 7-day TVL change; maturity follows how long it has run with no token. No protocol name is ever special-cased. The board covers all 40 watchlist protocols plus every other rankable pre-token protocol (198 rows). Protocols whose token already trades are kept apart as live comparables, never mixed into the ranked board.

## Run it

```sh
node main.ts
```

Requires Node.js 22.18 or later, standard library only. The program reads `/input/snapshot.json` and writes the board, dashboard data, dashboard, screenshots and dossier to `/output`. Locally: `MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>`, then open `out/dashboard/index.html` in a browser (it loads `../data.js`, no network).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
