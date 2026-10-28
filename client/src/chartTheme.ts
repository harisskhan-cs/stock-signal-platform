import { ColorType, CrosshairMode, LineStyle, type ChartOptions, type DeepPartial } from 'lightweight-charts';

/** Mirrors the CSS variables in styles.css (the chart library needs literal colors). */
export const colors = {
  bg: '#000000',
  grid: '#101418',
  border: '#1f2429',
  text: '#8a9099',
  bull: '#3ecf73',
  bear: '#ff4d4d',
  bullSoft: 'rgba(62, 207, 115, 0.4)',
  bearSoft: 'rgba(255, 77, 77, 0.4)',
  accent: '#4fc3f7',
  sma50: '#ff9f1a',
  sma200: '#4fc3f7',
  ema20: '#c792ea',
  bands: '#5a6068',
  volume: 'rgba(138, 144, 153, 0.22)',
  benchmark: '#8a9099',
  crosshair: '#ff9f1a',
};

export const chartFont = "Iosevka, ui-monospace, 'SF Mono', Menlo, monospace";

export const baseChartOptions: DeepPartial<ChartOptions> = {
  autoSize: true,
  layout: {
    background: { type: ColorType.Solid, color: colors.bg },
    textColor: colors.text,
    fontFamily: chartFont,
    fontSize: 11,
    panes: { separatorColor: colors.border, separatorHoverColor: 'rgba(255, 159, 26, 0.3)' },
  },
  grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
  rightPriceScale: { borderColor: colors.border },
  // Keeping the visible date range on resize means a chart first drawn narrow
  // (or while hidden) stretches to fill the space instead of leaving it empty.
  // The default 0.5px minimum bar spacing can't fit 10+ years of daily bars in a
  // normal-width chart, so fitContent() would silently show only the recent part.
  timeScale: { borderColor: colors.border, minBarSpacing: 0.05, lockVisibleTimeRangeOnResize: true },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: { color: colors.crosshair, style: LineStyle.Dotted, labelBackgroundColor: '#3a2a10' },
    horzLine: { color: colors.crosshair, style: LineStyle.Dotted, labelBackgroundColor: '#3a2a10' },
  },
};
