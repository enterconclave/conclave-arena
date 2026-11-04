import { test } from "node:test";
import assert from "node:assert/strict";
import { enforce, newBook, step, GUARDRAILS } from "./engine.js";

const A = ["ETH", "BTC"];

test("clips a single asset to 60% and counts a breach", () => {
  const { weights, breaches } = enforce({ ETH: 0.9 }, { ETH: 0.6 }, A);
  assert.equal(weights.ETH, 0.6);
  assert.equal(breaches, 1);
});

test("scales gross exposure down to 100%", () => {
  const { weights, breaches } = enforce({ ETH: 0.6, BTC: 0.6 }, { ETH: 0.6, BTC: 0.6 }, A);
  assert.ok(Math.abs(weights.ETH + weights.BTC - 1) < 1e-9);
  assert.equal(breaches, 1);
});

test("paces turnover per hour without counting a breach", () => {
  const { weights, breaches } = enforce({ ETH: 0.6, BTC: 0.4 }, {}, A);
  const turnover = weights.ETH + weights.BTC;
  assert.ok(Math.abs(turnover - GUARDRAILS.maxTurnoverPerHour) < 1e-9);
  assert.equal(breaches, 0);
});

test("rejects negative and non-numeric weights", () => {
  const { weights, breaches } = enforce({ ETH: -1, BTC: NaN }, {}, A);
  assert.deepEqual(weights, { ETH: 0, BTC: 0 });
  assert.equal(breaches, 2);
});

test("marks to market correctly and charges fees on trades", () => {
  const closes = { ETH: [100, 150, 150], BTC: [100, 100, 100] };
  const book = newBook("t");
  book.weights = { ETH: 0.5 };
  step(book, { decide: () => ({ ETH: 0.5 }) }, closes, 1, A);
  // 50% in ETH up 50% => +25%, ETH drifts to 60%, rebalancing back to 50% trades 10%
  const drifted = 0.75 / 1.25;
  const turnover = drifted - 0.5;
  assert.ok(Math.abs(book.equity - 1.25 * (1 - turnover * GUARDRAILS.feeRate)) < 1e-12);
});

test("skips rebalances below the minimum trade size", () => {
  const closes = { ETH: [100, 101], BTC: [100, 100] };
  const book = newBook("t");
  book.weights = { ETH: 0.5 };
  step(book, { decide: () => ({ ETH: 0.5 }) }, closes, 1, A);
  assert.equal(book.trades, 0);
  assert.ok(Math.abs(book.equity - 1.005) < 1e-12);
});

test("halts an agent at a 20% drawdown and moves it to cash", () => {
  const closes = { ETH: [100, 70], BTC: [100, 100] };
  const book = newBook("t");
  book.weights = { ETH: 0.6, BTC: 0 };
  // 60% at -30% = -18%: not halted yet
  step(book, { decide: () => ({ ETH: 0.6 }) }, closes, 1, A);
  assert.equal(book.halted, false);
  const closes2 = { ETH: [70, 50], BTC: [100, 100] };
  step(book, { decide: () => ({ ETH: 0.6 }) }, closes2, 1, A);
  assert.equal(book.halted, true);
  assert.deepEqual(book.weights, {});
});

test("a crashing strategy is a breach, not a crash", () => {
  const closes = { ETH: [100, 100], BTC: [100, 100] };
  const book = newBook("t");
  step(book, { decide: () => { throw new Error("boom"); } }, closes, 1, A);
  assert.equal(book.breaches, 1);
});
