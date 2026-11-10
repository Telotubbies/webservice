// Keyboard map for a tablist (APG tabs pattern: Left/Right wrap, Home/End jump).
// Pure so the roving tabindex is testable without a DOM; the component only has
// to move the selected tab and focus it.

export function tabNext(key: string, index: number, count: number): number {
  if (count === 0) return -1;
  switch (key) {
    case 'ArrowRight': return (index + 1) % count;
    case 'ArrowLeft': return (index - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return -1;
  }
}
