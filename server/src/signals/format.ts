export const price = (n: number): string => `$${n.toFixed(2)}`;

/** Formats a fraction as a percentage: 0.0523 -> "5.2%". */
export const pct = (fraction: number, digits = 1): string => `${(fraction * 100).toFixed(digits)}%`;

export const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;
