import { describe, expect, it } from 'vitest';
import { computeIndicators, findLevels } from '../src/indicators/index.js';
import { detectEvents } from '../src/signals/events.js';
import { compositeScore, readRules, STATE_RULES } from '../src/signals/rules.js';
import { summarize, toVerdict } from '../src/signals/summary.js';
import { makeBars, randomWalk } from './helpers.js';

/** Smooth uptrend with small pullbacks so RSI stays below overbought. */
const uptrend = () => makeBars(Array.from({ length: 300 }, (_, i) => 100 + i * 0.5 + Math.sin(i / 3) * 3));
const downtrend = () => makeBars(Array.from({ length: 300 }, (_, i) => 300 - i * 0.5 + Math.sin(i / 3) * 3));

describe('state rules', () => {
  it('reads an uptrend as bullish on trend and moving averages', () => {
    const ind = computeIndicators(uptrend());
    const readings = readRules(ind, ind.bars.length - 1);
    expect(readings.find((r) => r.id === 'trend')?.stance).toBe(1);
    expect(readings.find((r) => r.id === 'ma_regime')?.stance).toBe(1);
    expect(readings.find((r) => r.id === 'trend')?.explanation).toMatch(/above its 200-day average/);
  });

  it('reads a downtrend as bearish on trend and moving averages', () => {
    const ind = computeIndicators(downtrend());
    const readings = readRules(ind, ind.bars.length - 1);
    expect(readings.find((r) => r.id === 'trend')?.stance).toBe(-1);
    expect(readings.find((r) => r.id === 'ma_regime')?.stance).toBe(-1);
  });

  it('flags RSI oversold after a sharp drop', () => {
    const closes = [...Array.from({ length: 60 }, () => 100), ...Array.from({ length: 15 }, (_, i) => 100 - (i + 1) * 2)];
    const ind = computeIndicators(makeBars(closes));
    const reading = readRules(ind, closes.length - 1).find((r) => r.id === 'rsi');
    expect(reading?.stance).toBe(1);
    expect(reading?.explanation).toMatch(/oversold/);
  });

  it('only scores bars where every rule has data', () => {
    const ind = computeIndicators(uptrend());
    expect(compositeScore(ind, 198)).toBeNull(); // 200-day average not ready yet
    const score = compositeScore(ind, 299) as number;
    expect(score).toBeGreaterThanOrEqual(-1);
    expect(score).toBeLessThanOrEqual(1);
    // The score is the mean of the rule stances, so it moves in steps of 1/rules.
    expect(Math.round(score * STATE_RULES.length)).toBeCloseTo(score * STATE_RULES.length, 10);
  });

  it('never looks ahead: a rule on bar i ignores bars after i', () => {
    const bars = makeBars(randomWalk(400, 3));
    const full = computeIndicators(bars);
    const truncated = computeIndicators(bars.slice(0, 301));
    for (const rule of STATE_RULES) {
      expect(rule.stance(full, 300)).toBe(rule.stance(truncated, 300));
    }
  });
});

describe('verdicts', () => {
  it('maps scores to verdict bands', () => {
    expect(toVerdict(1)).toBe('Strongly bullish');
    expect(toVerdict(0.4)).toBe('Bullish');
    expect(toVerdict(0)).toBe('Neutral');
    expect(toVerdict(-0.4)).toBe('Bearish');
    expect(toVerdict(-1)).toBe('Strongly bearish');
  });

  it('summarizes with a headline that counts the readings', () => {
    const bars = uptrend();
    const ind = computeIndicators(bars);
    const summary = summarize(ind, findLevels(bars), detectEvents(ind));
    expect(summary.asOf).toBe(bars.at(-1)?.date);
    expect(summary.readings).toHaveLength(STATE_RULES.length);
    expect(summary.verdict).not.toBeNull();
    expect(summary.headline).toMatch(/of 5 indicators are bullish/);
  });

  it('explains that the verdict needs more history on short series', () => {
    const bars = makeBars(randomWalk(50));
    const ind = computeIndicators(bars);
    const summary = summarize(ind, findLevels(bars), detectEvents(ind));
    expect(summary.verdict).toBeNull();
    expect(summary.headline).toMatch(/200-day average needs 200/);
  });
});

describe('events', () => {
  it('detects a golden cross when a downtrend turns into an uptrend', () => {
    const closes = [...Array.from({ length: 250 }, (_, i) => 200 - i * 0.4), ...Array.from({ length: 250 }, (_, i) => 100 + i * 0.8)];
    const events = detectEvents(computeIndicators(makeBars(closes)));
    const golden = events.filter((e) => e.id === 'golden_cross');
    expect(golden).toHaveLength(1);
    expect(golden[0].index).toBeGreaterThan(250);
    expect(golden[0].direction).toBe('bullish');
  });

  it('alternates MACD bullish and bearish crossovers', () => {
    const events = detectEvents(computeIndicators(makeBars(randomWalk(600, 11)))).filter((e) => e.id.startsWith('macd'));
    expect(events.length).toBeGreaterThan(4);
    for (let i = 1; i < events.length; i++) expect(events[i].id).not.toBe(events[i - 1].id);
  });
});
