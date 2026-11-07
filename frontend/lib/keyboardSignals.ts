/**
 * Counts key presses per window. Only counts are kept — never which keys —
 * so typed text can't be reconstructed from the signal data.
 */
export class KeyboardAccumulator {
  private keys = 0;
  private deletes = 0;

  key(event: KeyboardEvent): void {
    if (event.repeat) return; // a held-down key is one press
    this.keys += 1;
    if (event.key === "Backspace" || event.key === "Delete") this.deletes += 1;
  }

  /** Returns the window's counts and resets for the next window. */
  flush(): { keyCount: number; deleteCount: number } {
    const counts = { keyCount: this.keys, deleteCount: this.deletes };
    this.keys = 0;
    this.deletes = 0;
    return counts;
  }
}
