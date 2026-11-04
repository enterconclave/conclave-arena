// Hourly closes from Coinbase Exchange's public candles API (no key needed).
// Returns aligned series: { times: number[], closes: { ETH: number[], ... } }, oldest first.

const BASE = "https://api.exchange.coinbase.com/products";
const HOUR = 3600;

async function candles(product, startSec, endSec) {
  const url = `${BASE}/${product}/candles?granularity=${HOUR}&start=${new Date(startSec * 1000).toISOString()}&end=${new Date(endSec * 1000).toISOString()}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "conclave-arena" } });
    if (res.ok) return res.json();
    if (res.status !== 429 && res.status < 500) throw new Error(`${product}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  throw new Error(`${product}: price API unavailable`);
}

export async function fetchHourly(assets, hours) {
  const end = Math.floor(Date.now() / 1000 / HOUR) * HOUR;
  const start = end - hours * HOUR;
  const byAsset = {};
  for (const a of assets) {
    const rows = new Map();
    // The API returns at most 300 candles per call.
    for (let s = start; s < end; s += 300 * HOUR) {
      const e = Math.min(end, s + 300 * HOUR);
      for (const [t, , , , close] of await candles(`${a}-USD`, s, e)) rows.set(t, close);
    }
    byAsset[a] = rows;
  }
  // Keep only hours every asset has, so all agents see the same clock.
  const times = [...byAsset[assets[0]].keys()].filter((t) => assets.every((a) => byAsset[a].has(t))).sort((x, y) => x - y);
  const closes = Object.fromEntries(assets.map((a) => [a, times.map((t) => byAsset[a].get(t))]));
  return { times, closes };
}
