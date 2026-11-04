// Paper-trading engine with the same guardrails the real treasury roles will enforce.

export const GUARDRAILS = {
  maxWeightPerAsset: 0.6, // no single asset above 60% of equity
  maxGross: 1.0, // no leverage
  maxTurnoverPerHour: 0.5, // at most 50% of equity traded in one hour
  haltDrawdown: 0.2, // a 20% drawdown from peak halts the agent for the season
  feeRate: 0.003, // 0.3% per trade: swap fee plus slippage
  minTradeTurnover: 0.02, // ignore rebalances smaller than 2% of equity
};

/**
 * Clips proposed weights to the guardrails. Returns the weights that may execute and
 * how many hard rules the proposal broke (per-asset cap, leverage, invalid weights).
 * The turnover limit only paces execution over several hours; it is not a breach.
 */
export function enforce(proposed, current, assets, g = GUARDRAILS) {
  let breaches = 0;
  const w = {};
  for (const a of assets) {
    let x = Number(proposed[a] ?? 0);
    if (!Number.isFinite(x) || x < 0) { x = 0; breaches++; }
    if (x > g.maxWeightPerAsset + 1e-9) { x = g.maxWeightPerAsset; breaches++; }
    w[a] = x;
  }
  const gross = assets.reduce((s, a) => s + w[a], 0);
  if (gross > g.maxGross + 1e-9) {
    for (const a of assets) w[a] *= g.maxGross / gross;
    breaches++;
  }
  const turnover = assets.reduce((s, a) => s + Math.abs(w[a] - (current[a] ?? 0)), 0);
  if (turnover > g.maxTurnoverPerHour + 1e-9) {
    const k = g.maxTurnoverPerHour / turnover;
    for (const a of assets) w[a] = (current[a] ?? 0) + (w[a] - (current[a] ?? 0)) * k;
  }
  return { weights: w, breaches };
}

export function newBook(id) {
  return { id, equity: 1, peak: 1, maxDrawdown: 0, weights: {}, trades: 0, breaches: 0, halted: false, curve: [1] };
}

/** Advances one book from hour i-1 to hour i: mark to market, then rebalance. */
export function step(book, strat, closes, i, assets, g = GUARDRAILS) {
  // 1. Mark to market with the move from i-1 to i.
  let growth = 1 - assets.reduce((s, a) => s + (book.weights[a] ?? 0), 0); // cash part
  const drifted = {};
  for (const a of assets) {
    const w = book.weights[a] ?? 0;
    const r = closes[a][i] / closes[a][i - 1];
    drifted[a] = w * r;
    growth += w * r;
  }
  for (const a of assets) drifted[a] = growth > 0 ? drifted[a] / growth : 0;
  book.equity *= growth;
  book.peak = Math.max(book.peak, book.equity);
  book.maxDrawdown = Math.max(book.maxDrawdown, 1 - book.equity / book.peak);
  book.weights = drifted;

  if (book.halted) return;
  if (book.maxDrawdown >= g.haltDrawdown) {
    // Circuit breaker: liquidate to cash and stop.
    const turnover = assets.reduce((s, a) => s + (book.weights[a] ?? 0), 0);
    book.equity *= 1 - turnover * g.feeRate;
    book.weights = {};
    book.halted = true;
    book.breaches++;
    return;
  }

  // 2. Agent proposes, guardrails clip, trade executes with fees.
  let proposal;
  try {
    proposal = strat.decide(closes, i, assets, { ...book.weights }) ?? {};
  } catch {
    proposal = book.weights;
    book.breaches++;
  }
  const { weights, breaches } = enforce(proposal, book.weights, assets, g);
  book.breaches += breaches;
  const turnover = assets.reduce((s, a) => s + Math.abs(weights[a] - (book.weights[a] ?? 0)), 0);
  if (turnover < g.minTradeTurnover) return; // too small to be worth the fee
  book.trades++;
  book.equity *= 1 - turnover * g.feeRate;
  book.weights = weights;
}

/** Annualised Sharpe of hourly returns taken from the after-fee equity curve. */
export function sharpe(curve) {
  const hourly = curve.slice(1).map((v, k) => v / curve[k] - 1);
  if (hourly.length < 48) return null;
  const m = hourly.reduce((a, b) => a + b, 0) / hourly.length;
  const sd = Math.sqrt(hourly.reduce((a, b) => a + (b - m) ** 2, 0) / (hourly.length - 1));
  return sd === 0 ? null : (m / sd) * Math.sqrt(24 * 365);
}
