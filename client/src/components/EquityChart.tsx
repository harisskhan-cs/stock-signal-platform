import { createChart, LineSeries, PriceScaleMode } from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import type { EquityPoint } from '../api';
import { baseChartOptions, colors } from '../chartTheme';

const START = 10_000;

interface Props {
  strategy: EquityPoint[];
  benchmark: EquityPoint[];
  strategyName: string;
  log: boolean;
}

/** Growth of $10,000: strategy vs. buy-and-hold. */
export function EquityChart({ strategy, benchmark, strategyName, log }: Props) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const chart = createChart(el, {
      ...baseChartOptions,
      rightPriceScale: { borderColor: colors.border, mode: log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal },
      localization: { priceFormatter: (v: number) => `$${Math.round(v).toLocaleString()}` },
    });
    const bench = chart.addSeries(LineSeries, { color: colors.benchmark, lineWidth: 1, title: 'Buy & hold', priceLineVisible: false });
    bench.setData(benchmark.map((p) => ({ time: p.date, value: p.equity * START })));
    const strat = chart.addSeries(LineSeries, { color: colors.accent, lineWidth: 2, title: strategyName, priceLineVisible: false });
    strat.setData(strategy.map((p) => ({ time: p.date, value: p.equity * START })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [strategy, benchmark, strategyName, log]);

  return <div ref={container} className="equity-canvas" />;
}
