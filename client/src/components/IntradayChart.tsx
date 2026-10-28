import { BaselineSeries, createChart, LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type Time, type UTCTimestamp } from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import type { IntradayPoint } from '../api';
import { baseChartOptions, colors } from '../chartTheme';

interface Props {
  points: IntradayPoint[];
  /** Green above this price, red below (the previous close). */
  base: number;
  timeZone: string;
}

/** Today's 1-minute prices, coloured against the previous close. */
export function IntradayChart({ points, base, timeZone }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<{ api: IChartApi; series: ISeriesApi<'Baseline'>; baseLine: IPriceLine } | null>(null);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const clock = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
    const format = (t: Time) => clock.format(new Date((t as number) * 1000));
    const api = createChart(el, {
      ...baseChartOptions,
      // Too small for the logo; the page footer carries the TradingView attribution instead.
      layout: { ...baseChartOptions.layout, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { visible: false },
      timeScale: { ...baseChartOptions.timeScale, timeVisible: true, borderVisible: false, tickMarkFormatter: format },
      localization: { timeFormatter: format },
      handleScroll: false,
      handleScale: false,
    });
    const series = api.addSeries(BaselineSeries, {
      lineWidth: 2,
      topLineColor: colors.bull,
      topFillColor1: 'rgba(38, 166, 154, 0.25)',
      topFillColor2: 'rgba(38, 166, 154, 0.02)',
      bottomLineColor: colors.bear,
      bottomFillColor1: 'rgba(239, 83, 80, 0.02)',
      bottomFillColor2: 'rgba(239, 83, 80, 0.25)',
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const baseLine = series.createPriceLine({ price: 0, color: colors.border, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
    chart.current = { api, series, baseLine };
    return () => {
      api.remove();
      chart.current = null;
    };
  }, [timeZone]);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    c.series.applyOptions({ baseValue: { type: 'price', price: base } });
    c.series.setData(points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    c.baseLine.applyOptions({ price: base });
    c.api.timeScale().fitContent();
  }, [points, base, timeZone]);

  return <div ref={container} className="intraday-canvas" aria-label="Today's price, minute by minute" role="img" />;
}
