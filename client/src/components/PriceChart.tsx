import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import type { AnalysisResponse, Bar, LiveUpdate, Series } from '../api';
import { baseChartOptions, colors } from '../chartTheme';
import { num } from '../format';

export type Overlay = 'sma50' | 'sma200' | 'ema20' | 'bollinger' | 'levels' | 'events';

export const OVERLAYS: { id: Overlay; label: string; color: string; hint: string }[] = [
  { id: 'sma50', label: 'SMA50', color: colors.sma50, hint: '50-day simple moving average' },
  { id: 'sma200', label: 'SMA200', color: colors.sma200, hint: '200-day simple moving average' },
  { id: 'ema20', label: 'EMA20', color: colors.ema20, hint: '20-day exponential moving average' },
  { id: 'bollinger', label: 'BOLL', color: colors.bands, hint: 'Bollinger Bands (20 days, 2 standard deviations)' },
  { id: 'levels', label: 'S/R', color: colors.crosshair, hint: 'Support and resistance levels' },
  { id: 'events', label: 'SIGNALS', color: colors.bull, hint: 'Arrows where signals fired (crossovers, RSI and band breaks)' },
];

interface Props {
  data: AnalysisResponse;
  overlays: ReadonlySet<Overlay>;
  /** Live update whose candle and indicator values are drawn on top of the cached history. */
  live: LiveUpdate | null;
}

interface Handles {
  chart: IChartApi;
  candles: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
  rsi: ISeriesApi<'Line'>;
  hist: ISeriesApi<'Histogram'>;
  macdLine: ISeriesApi<'Line'>;
  signalLine: ISeriesApi<'Line'>;
  lines: Record<'sma50' | 'sma200' | 'ema20' | 'bbUpper' | 'bbMiddle' | 'bbLower', ISeriesApi<'Line'>>;
  markers: ISeriesMarkersPluginApi<Time>;
  priceLines: IPriceLine[];
}

interface Legend {
  bar: Bar;
  rsi: number | null;
  macd: number | null;
  signal: number | null;
  events: AnalysisResponse['events'];
}

function toLine(bars: readonly Bar[], series: Series): LineData<Time>[] {
  const out: LineData<Time>[] = [];
  series.forEach((value, i) => {
    if (value != null) out.push({ time: bars[i].date, value });
  });
  return out;
}

const quiet = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false } as const;

/**
 * Candles with moving averages and Bollinger Bands, volume underneath, and
 * separate RSI and MACD panes, all sharing one time axis.
 */
export function PriceChart({ data, overlays, live }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const handles = useRef<Handles | null>(null);
  const [lastLegend, setLastLegend] = useState<Legend | null>(null);
  const [hover, setHover] = useState<Legend | null>(null);

  // Build the chart whenever the data changes.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const { bars, indicators } = data;
    const chart = createChart(el, baseChartOptions);

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: colors.bull,
      downColor: colors.bear,
      wickUpColor: colors.bull,
      wickDownColor: colors.bear,
      borderVisible: false,
    });
    candles.setData(bars.map((b) => ({ time: b.date, open: b.open, high: b.high, low: b.low, close: b.close })));

    const volume = chart.addSeries(HistogramSeries, { priceScaleId: 'volume', priceFormat: { type: 'volume' }, ...quiet });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volume.setData(bars.map((b, i) => ({ time: b.date, value: b.volume, color: i > 0 && b.close < bars[i - 1].close ? colors.bearSoft : colors.volume })));

    const line = (series: Series, color: string, style: LineStyle = LineStyle.Solid) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: 1, lineStyle: style, ...quiet });
      s.setData(toLine(bars, series));
      return s;
    };
    const lines = {
      sma50: line(indicators.sma50, colors.sma50),
      sma200: line(indicators.sma200, colors.sma200),
      ema20: line(indicators.ema20, colors.ema20),
      bbUpper: line(indicators.bollinger.upper, colors.bands, LineStyle.Dotted),
      bbMiddle: line(indicators.bollinger.middle, colors.bands, LineStyle.Dashed),
      bbLower: line(indicators.bollinger.lower, colors.bands, LineStyle.Dotted),
    };

    // Pane 1: RSI with overbought/oversold guides.
    const rsi = chart.addSeries(LineSeries, { color: colors.sma200, lineWidth: 1, title: 'RSI 14', priceLineVisible: false }, 1);
    rsi.setData(toLine(bars, indicators.rsi14));
    for (const level of [70, 30]) {
      rsi.createPriceLine({ price: level, color: level === 70 ? colors.bearSoft : colors.bullSoft, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: '' });
    }

    // Pane 2: MACD histogram plus MACD and signal lines.
    const hist = chart.addSeries(HistogramSeries, { ...quiet, priceFormat: { type: 'price', precision: 2, minMove: 0.01 } }, 2);
    hist.setData(
      indicators.macd.histogram.flatMap((v, i) => (v == null ? [] : [{ time: bars[i].date, value: v, color: v >= 0 ? colors.bullSoft : colors.bearSoft }])),
    );
    const macdLine = chart.addSeries(LineSeries, { color: colors.accent, lineWidth: 1, title: 'MACD', priceLineVisible: false }, 2);
    macdLine.setData(toLine(bars, indicators.macd.macd));
    const signalLine = chart.addSeries(LineSeries, { color: colors.sma50, lineWidth: 1, ...quiet }, 2);
    signalLine.setData(toLine(bars, indicators.macd.signal));

    const panes = chart.panes();
    panes[0]?.setStretchFactor(3.2);
    panes[1]?.setStretchFactor(1);
    panes[2]?.setStretchFactor(1);

    const markers = createSeriesMarkers(candles, []);
    chart.timeScale().fitContent();

    const byDate = new Map(bars.map((b, i) => [b.date, i]));
    const latest = (i: number): Legend => ({
      bar: bars[i],
      rsi: indicators.rsi14[i],
      macd: indicators.macd.macd[i],
      signal: indicators.macd.signal[i],
      events: data.events.filter((e) => e.date === bars[i].date),
    });
    setLastLegend(latest(bars.length - 1));
    setHover(null);
    // Off the chart (or on today's live candle, which isn't in `bars`) the legend shows the latest values.
    const onMove = (param: MouseEventParams<Time>) => {
      const i = typeof param.time === 'string' ? byDate.get(param.time) : undefined;
      setHover(i == null ? null : latest(i));
    };
    chart.subscribeCrosshairMove(onMove);

    handles.current = { chart, candles, volume, rsi, hist, macdLine, signalLine, lines, markers, priceLines: [] };
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      handles.current = null;
    };
  }, [data]);

  // Draw today's live candle and move each indicator's last point, without rebuilding the chart.
  useEffect(() => {
    const h = handles.current;
    const bar = live?.todayBar;
    const lastCached = data.bars[data.bars.length - 1];
    if (!h || !live || !bar || !lastCached || bar.date < lastCached.date) return;
    // The close before today: the last cached bar, unless that bar *is* today (then the one before it).
    const prevClose = lastCached.date < bar.date ? lastCached.close : data.bars[data.bars.length - 2]?.close;
    h.candles.update({ time: bar.date, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
    h.volume.update({ time: bar.date, value: bar.volume, color: prevClose != null && bar.close < prevClose ? colors.bearSoft : colors.volume });
    const { latest } = live;
    const point = (series: ISeriesApi<'Line'>, value: number | null) => {
      if (value != null) series.update({ time: latest.date, value });
    };
    point(h.lines.sma50, latest.sma50);
    point(h.lines.sma200, latest.sma200);
    point(h.lines.ema20, latest.ema20);
    point(h.lines.bbUpper, latest.bbUpper);
    point(h.lines.bbMiddle, latest.bbMiddle);
    point(h.lines.bbLower, latest.bbLower);
    point(h.rsi, latest.rsi14);
    point(h.macdLine, latest.macd);
    point(h.signalLine, latest.signal);
    if (latest.histogram != null) {
      h.hist.update({ time: latest.date, value: latest.histogram, color: latest.histogram >= 0 ? colors.bullSoft : colors.bearSoft });
    }
  }, [data, live]);

  // Toggle overlays without rebuilding the chart, so zoom and scroll are kept.
  useEffect(() => {
    const h = handles.current;
    if (!h) return;
    h.lines.sma50.applyOptions({ visible: overlays.has('sma50') });
    h.lines.sma200.applyOptions({ visible: overlays.has('sma200') });
    h.lines.ema20.applyOptions({ visible: overlays.has('ema20') });
    for (const band of [h.lines.bbUpper, h.lines.bbMiddle, h.lines.bbLower]) band.applyOptions({ visible: overlays.has('bollinger') });

    for (const pl of h.priceLines) h.candles.removePriceLine(pl);
    h.priceLines = overlays.has('levels')
      ? data.levels.map((level) =>
          h.candles.createPriceLine({
            price: level.price,
            color: level.kind === 'support' ? colors.bull : colors.bear,
            lineStyle: LineStyle.LargeDashed,
            lineWidth: 1,
            axisLabelVisible: true,
            title: `${level.kind === 'support' ? 'S' : 'R'} ×${level.touches}`,
          }),
        )
      : [];

    // Crossovers fire every few weeks, so they get bare arrows; only the rare
    // golden/death crosses are labelled. Hovering a bar shows details in the legend.
    const markers: SeriesMarker<Time>[] = overlays.has('events')
      ? data.events.map((e) => {
          const major = e.id === 'golden_cross' || e.id === 'death_cross';
          return {
            time: e.date,
            position: e.direction === 'bullish' ? 'belowBar' : 'aboveBar',
            shape: e.direction === 'bullish' ? 'arrowUp' : 'arrowDown',
            color: e.direction === 'bullish' ? colors.bull : colors.bear,
            text: major ? e.name : undefined,
            size: major ? 1 : 0.5,
          };
        })
      : [];
    h.markers.setMarkers(markers);
  }, [data, overlays]);

  const liveLegend: Legend | null =
    live?.todayBar && live.todayBar.date >= (data.bars[data.bars.length - 1]?.date ?? '')
      ? {
          bar: live.todayBar,
          rsi: live.latest.rsi14,
          macd: live.latest.macd,
          signal: live.latest.signal,
          events: live.summary.recentEvents.filter((e) => e.date === live.todayBar?.date),
        }
      : null;
  const legend = hover ?? liveLegend ?? lastLegend;
  const bar = legend?.bar;
  const up = bar ? bar.close >= bar.open : true;
  return (
    <div className="price-chart">
      {bar && (
        <div className="chart-legend">
          <b>{bar.date}</b>
          <span>O <b className={up ? 'up' : 'down'}>{num(bar.open)}</b></span>
          <span>H <b className={up ? 'up' : 'down'}>{num(bar.high)}</b></span>
          <span>L <b className={up ? 'up' : 'down'}>{num(bar.low)}</b></span>
          <span>C <b className={up ? 'up' : 'down'}>{num(bar.close)}</b></span>
          <span>RSI <b>{num(legend.rsi, 1)}</b></span>
          <span>MACD <b>{num(legend.macd)}</b>/<b>{num(legend.signal)}</b></span>
          {legend.events.map((e) => (
            <span key={e.id} className={e.direction === 'bullish' ? 'up' : 'down'}>
              {e.direction === 'bullish' ? '▲' : '▼'} {e.name}
            </span>
          ))}
        </div>
      )}
      <div ref={container} className="chart-canvas" />
    </div>
  );
}
