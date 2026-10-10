// Pure keypad rules for stroke-play score entry (StrokePlaySessionModal).
// Digits are kept as a string so the display shows exactly what was typed.
// Server-side validation (app/services/stroke_play.py) is the real guard;
// these rules just keep the keypad from ever producing a bad value.

export const MAX_STROKE_DIGITS = 3

// No leading zeros: a lone "0" can be shown (so the key visibly does
// something) but the next digit replaces it rather than following it.
export function pressDigit(digits: string, digit: string): string {
  if (digits === '0') return digit
  if (digits.length >= MAX_STROKE_DIGITS) return digits
  return digits + digit
}

export function pressDelete(digits: string): string {
  return digits.slice(0, -1)
}

// A hole can't take 0 strokes, and an empty entry can't be submitted.
export function canSubmit(digits: string): boolean {
  return digits !== '' && Number(digits) >= 1
}

// Above this, the confirm step adds a "that's a lot of strokes" line.
export const HIGH_STROKE_WARNING_ABOVE = 10

export function strokesLabel(strokes: number): string {
  return `${strokes} stroke${strokes === 1 ? '' : 's'}`
}
