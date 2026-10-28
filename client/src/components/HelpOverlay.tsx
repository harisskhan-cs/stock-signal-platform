import { useEffect, useRef } from 'react';

/** Keyboard shortcuts and a plain-English glossary of every indicator on screen. */
export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => closeButton.current?.focus(), []);

  return (
    <div className="help-backdrop" onClick={onClose}>
      <div className="help pane" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(e) => e.stopPropagation()}>
        <div className="pane-head">
          <span className="pane-title" id="help-title">
            HELP
          </span>
          <button ref={closeButton} type="button" className="close" onClick={onClose}>
            close <kbd>Esc</kbd>
          </button>
        </div>
        <div className="help-body">
          <div>
            <h3>KEYS</h3>
            <div className="keys">
              <kbd>/</kbd>
              <span>Type a ticker or company name</span>
              <kbd>1</kbd>
              <span>Chart range: 6 months</span>
              <kbd>2</kbd>
              <span>1 year</span>
              <kbd>3</kbd>
              <span>2 years</span>
              <kbd>4</kbd>
              <span>5 years</span>
              <kbd>5</kbd>
              <span>10 years</span>
              <kbd>?</kbd>
              <span>Show or hide this help</span>
              <kbd>Esc</kbd>
              <span>Close help, leave the ticker box</span>
            </div>
            <h3 style={{ marginTop: 16 }}>READING THE SCREEN</h3>
            <dl>
              <dt>▲ / ▼</dt>
              <dd>Up or bullish / down or bearish. Shown with arrows as well as color.</dd>
              <dt>Pre-market, after hours</dt>
              <dd>Trading outside regular hours. The main price stays the official close until the market opens.</dd>
            </dl>
          </div>
          <div>
            <h3>WHAT THE INDICATORS MEAN</h3>
            <dl>
              <dt>SMA 50 / SMA 200</dt>
              <dd>Average closing price over the last 50 or 200 trading days. Price above the 200-day line is usually read as a long-term uptrend.</dd>
              <dt>EMA 20</dt>
              <dd>A 20-day average that weights recent days more, so it reacts faster than an SMA.</dd>
              <dt>RSI (14)</dt>
              <dd>Momentum from 0 to 100. Above 70 is "overbought" (rose fast), below 30 is "oversold" (fell fast).</dd>
              <dt>MACD</dt>
              <dd>The gap between a fast and a slow average. When it crosses above its signal line, momentum is turning up.</dd>
              <dt>Bollinger Bands</dt>
              <dd>A band two standard deviations around the 20-day average. Closes outside the band are unusually large moves.</dd>
              <dt>Support / resistance</dt>
              <dd>Prices where the stock has turned around several times before. Shown as S and R lines with how many times it turned there.</dd>
              <dt>Backtest</dt>
              <dd>What would have happened if you had traded each signal in the past, compared with simply buying and holding.</dd>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
