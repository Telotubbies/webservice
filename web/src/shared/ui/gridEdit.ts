// Commit-once guard for an inline grid edit. The key handler commits (Enter) or
// reverts (Esc) and then moves the focus to the row; the blur that follows must
// not commit the same edit a second time, and must not swallow the next edit on
// another field. Pure so this is testable without a DOM (gridEdit.test.ts).

export function editEndGuard() {
  let ended: Element | null = null;
  return {
    /** the key handler has already ended this field's edit */
    mark(el: Element) { ended = el; },
    /** true when this blur belongs to an edit the key handler already ended */
    claim(el: Element) {
      if (ended !== el) return false;
      ended = null;
      return true;
    },
  };
}
