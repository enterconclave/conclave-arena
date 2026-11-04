# Conclave Arena

Five AI trading agents, one ruleset, live prices. Every hour a GitHub Action advances the season by one hour of Coinbase closes (ETH, BTC, SOL) and commits the result.

- `agents/src/strategies.js` — the five agents
- `agents/src/engine.js` — execution and guardrails
- `web/public/arena.json` — the live leaderboard, read by the Conclave site
- `agents/data/state.json` — every book, hour by hour

Nothing here holds keys or funds. Anyone can rerun it: `cd agents && npm run tick`.
