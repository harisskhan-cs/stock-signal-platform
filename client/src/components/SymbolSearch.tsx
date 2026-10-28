import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { api, type SymbolMatch } from '../api';

interface Props {
  onSelect: (symbol: string) => void;
  /** Lets the parent focus the box (the "/" shortcut). */
  inputRef?: RefObject<HTMLInputElement | null>;
}

/** Ticker input with debounced company-name search. Enter on raw text loads it as a ticker. */
export function SymbolSearch({ onSelect, inputRef }: Props) {
  const [text, setText] = useState('');
  const [matches, setMatches] = useState<SymbolMatch[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const wrapper = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 1) {
      setMatches([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .search(q, controller.signal)
        .then((m) => {
          setMatches(m);
          setActive(-1);
        })
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const choose = (symbol: string) => {
    if (!symbol.trim()) return;
    onSelect(symbol.trim().toUpperCase());
    setText('');
    setMatches([]);
    setOpen(false);
    inputRef?.current?.blur();
  };

  return (
    <form
      ref={wrapper}
      className="search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        choose(active >= 0 && matches[active] ? matches[active].symbol : text);
      }}
    >
      <span className="prompt" aria-hidden>
        &gt;
      </span>
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, -1));
          } else if (e.key === 'Escape') {
            setOpen(false);
            e.currentTarget.blur();
          }
        }}
        placeholder="Ticker or company name, then Enter"
        aria-label="Stock symbol or company name"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls={listId}
        autoComplete="off"
        spellCheck={false}
      />
      <button type="submit" className="go">
        GO
      </button>
      {open && matches.length > 0 && (
        <ul className="search-results" id={listId} role="listbox">
          {matches.map((m, i) => (
            <li
              key={m.symbol}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(m.symbol);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="result-symbol">{m.symbol}</span>
              <span className="result-name">{m.name}</span>
              <span className="result-meta">{[m.exchange, m.type].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
