// Conclave Arena runner.
//   node src/run.js --backtest 30   replays the last 30 days (published as sample data)
//   node src/run.js --tick          live mode: run hourly from a scheduler (cron, GitHub Actions)
// Writes web/public/arena.json for the site and data/state.json for live continuity.
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchHourly } from "./prices.js";
import { STRATEGIES } from "./strategies.js";
import { newBook, step, sharpe } from "./engine.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "..", "..", "web", "public", "arena.json");
const STATE = path.join(here, "..", "data", "state.json");
const ASSETS = ["ETH", "BTC", "SOL"];
const SEASON = "Season 0";

const bps = (x) => Math.round(x * 10000);

function publish({ books, benchCurve, updatedAt, mode, startedAt }) {
  const every = Math.max(1, Math.floor(books[0].curve.length / 60));
  const sample = (curve) => curve.filter((_, k) => k % every === 0 || k === curve.length - 1).map((v) => Math.round(v * 10000) / 10000);
  return {
    sample: mode !== "live",
    mode,
    season: SEASON,
    startedAt,
    updatedAt,
    // ETH buy-and-hold, on the same clock and sampling as the agent curves.
    benchmark: { name: "ETH hold", returnBps: bps(benchCurve[benchCurve.length - 1] - 1), equity: sample(benchCurve) },
    guardrails: "max 60% per asset · no leverage · 50% turnover per hour · halt at 20% drawdown",
    agents: books.map((b) => {
      const s = STRATEGIES.find((x) => x.id === b.id);
      return {
        id: b.id,
        name: s.name,
        strategy: s.strategy,
        returnBps: bps(b.equity - 1),
        maxDrawdownBps: bps(b.maxDrawdown),
        sharpe: sharpe(b.curve) === null ? null : Math.round(sharpe(b.curve) * 100) / 100,
        trades: b.trades,
        breaches: b.breaches,
        halted: b.halted,
        equity: sample(b.curve),
      };
    }),
  };
}

async function backtest(days) {
  const warmup = 72;
  const { times, closes } = await fetchHourly(ASSETS, days * 24 + warmup);
  const startIndex = warmup;
  const books = STRATEGIES.map((s) => newBook(s.id));
  for (let i = startIndex + 1; i < times.length; i++) {
    for (let k = 0; k < books.length; k++) {
      step(books[k], STRATEGIES[k], closes, i, ASSETS);
      books[k].curve.push(books[k].equity);
    }
  }
  const benchCurve = closes.ETH.slice(startIndex).map((p) => p / closes.ETH[startIndex]);
  const out = publish({
    books, benchCurve, mode: "backtest",
    startedAt: new Date(times[startIndex] * 1000).toISOString(),
    updatedAt: new Date(times[times.length - 1] * 1000).toISOString(),
  });
  await fs.writeFile(OUT, JSON.stringify(out, null, 2));
  console.log(`backtest ${days}d written to ${OUT}`);
  for (const a of out.agents) console.log(`${a.name.padEnd(8)} ${(a.returnBps / 100).toFixed(2).padStart(7)}%  dd ${(a.maxDrawdownBps / 100).toFixed(2)}%  trades ${a.trades}  breaches ${a.breaches}`);
  console.log(`benchmark ETH hold ${(out.benchmark.returnBps / 100).toFixed(2)}%`);
}

async function tick() {
  // Live mode keeps books in data/state.json and advances them hour by hour.
  const { times, closes } = await fetchHourly(ASSETS, 96);
  let state;
  try {
    state = JSON.parse(await fs.readFile(STATE, "utf8"));
  } catch {
    const startIdx = times.length - 1;
    state = { startedAt: new Date(times[startIdx] * 1000).toISOString(), startPrice: closes.ETH[startIdx], benchCurve: [1], lastTime: times[startIdx], books: STRATEGIES.map((s) => newBook(s.id)) };
    await fs.mkdir(path.dirname(STATE), { recursive: true });
    console.log("live season started", state.startedAt);
  }
  let advanced = 0;
  for (let i = 1; i < times.length; i++) {
    if (times[i] <= state.lastTime) continue;
    if (times[i - 1] !== state.lastTime) continue; // only advance contiguously from the last processed hour
    for (let k = 0; k < state.books.length; k++) {
      step(state.books[k], STRATEGIES[k], closes, i, ASSETS);
      state.books[k].curve.push(state.books[k].equity);
    }
    state.benchCurve.push(closes.ETH[i] / state.startPrice);
    state.lastTime = times[i];
    advanced++;
  }
  await fs.writeFile(STATE, JSON.stringify(state));
  if (state.lastTime < times[0]) console.warn("warning: more than 96h since the last tick; the season is paused until it is restarted");
  const out = publish({ books: state.books, benchCurve: state.benchCurve, mode: "live", startedAt: state.startedAt, updatedAt: new Date(state.lastTime * 1000).toISOString() });
  await fs.writeFile(OUT, JSON.stringify(out, null, 2));
  console.log(`tick: advanced ${advanced}h, last ${new Date(state.lastTime * 1000).toISOString()}`);
}

const args = process.argv.slice(2);
if (args[0] === "--backtest") await backtest(Number(args[1] || 30));
else if (args[0] === "--tick") await tick();
else console.log("usage: node src/run.js --backtest <days> | --tick");
