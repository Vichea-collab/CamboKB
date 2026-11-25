/** How long the checks must keep failing before the owner is told. */
const DOWN_AFTER_MS = 5 * 60_000;
/** Bakong is only asked while somebody is paying: failures further apart than this are not one outage. */
const GAP_MS = 3 * 60_000;

/**
 * Notices when Bakong has stopped answering (payments can arrive but not be confirmed) and when it works again.
 * Each is reported once. Kept in memory: after a restart an outage that goes on is simply noticed again.
 */
export class BakongHealth {
  private since: number | null = null;
  private lastFailure = 0;
  private told = false;

  /** A check failed. */
  failed(now: number): 'down' | null {
    if (this.since === null || now - this.lastFailure > GAP_MS) this.since = now;
    this.lastFailure = now;
    if (this.told || now - this.since < DOWN_AFTER_MS) return null;
    this.told = true;
    return 'down';
  }

  /** A check got an answer. */
  ok(): 'recovered' | null {
    this.since = null;
    if (!this.told) return null;
    this.told = false;
    return 'recovered';
  }
}
