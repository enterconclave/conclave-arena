// House agents for Season 0. Each returns target weights per asset (0..1); the rest is
// held in cash (USD). Agents only see prices up to and including hour `i`.

const sma = (xs, i, n) => {
  if (i + 1 < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += xs[k];
  return s / n;
};

const ret = (xs, i, n) => (i >= n ? xs[i] / xs[i - n] - 1 : null);

function rsi(xs, i, n = 14) {
  if (i < n) return null;
  let up = 0, down = 0;
  for (let k = i - n + 1; k <= i; k++) {
    const d = xs[k] - xs[k - 1];
    if (d > 0) up += d; else down -= d;
  }
  if (down === 0) return 100;
  return 100 - 100 / (1 + up / down);
}

function vol(xs, i, n) {
  if (i < n) return null;
  const r = [];
  for (let k = i - n + 1; k <= i; k++) r.push(Math.log(xs[k] / xs[k - 1]));
  const m = r.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
}

export const STRATEGIES = [
  {
    id: "vigil",
    name: "Vigil",
    strategy: "Trend: holds assets trading above their 72h average",
    decide(c, i, assets) {
      const on = assets.filter((a) => { const m = sma(c[a], i, 72); return m && c[a][i] > m; });
      return Object.fromEntries(assets.map((a) => [a, on.includes(a) ? Math.min(0.6, 0.95 / on.length) : 0]));
    },
  },
  {
    id: "ember",
    name: "Ember",
    strategy: "Momentum: rotates into the strongest 24h performer",
    decide(c, i, assets) {
      const scored = assets.map((a) => [a, ret(c[a], i, 24)]).filter(([, r]) => r !== null);
      if (!scored.length) return {};
      scored.sort((x, y) => y[1] - x[1]);
      const [best, r] = scored[0];
      return { [best]: r > 0 ? 0.6 : 0 };
    },
  },
  {
    id: "tide",
    name: "Tide",
    strategy: "Mean reversion: buys oversold (RSI < 30), sells overbought",
    decide(c, i, assets, prev) {
      const w = { ...prev };
      for (const a of assets) {
        const r = rsi(c[a], i);
        if (r === null) continue;
        if (r < 30) w[a] = 0.3;
        else if (r > 60) w[a] = 0;
      }
      return w;
    },
  },
  {
    id: "ballast",
    name: "Ballast",
    strategy: "Volatility targeting: sizes ETH so risk stays near 2% a day",
    decide(c, i) {
      const v = vol(c.ETH, i, 48);
      if (!v) return {};
      const daily = v * Math.sqrt(24);
      return { ETH: Math.min(0.6, 0.02 / daily) };
    },
  },
  {
    id: "spindle",
    name: "Spindle",
    strategy: "Breakout: enters on a new 48h high, exits on a 24h low",
    decide(c, i, assets, prev) {
      const w = { ...prev };
      for (const a of assets) {
        if (i < 48) continue;
        const hi = Math.max(...c[a].slice(i - 48, i));
        const lo = Math.min(...c[a].slice(i - 24, i));
        if (c[a][i] > hi) w[a] = 0.32;
        else if (c[a][i] < lo) w[a] = 0;
      }
      return w;
    },
  },
];
