
export const BASE_DELAY_MS = 1_000; 
export const MAX_DELAY_MS = 300_000;
export const MAX_ATTEMPTS = 10;


export function backoffMs(attempt: number): number {
  const exponential = BASE_DELAY_MS * 2 ** (attempt - 1);
  const capped = Math.min(exponential, MAX_DELAY_MS);
  return Math.floor(Math.random() * capped);
}
