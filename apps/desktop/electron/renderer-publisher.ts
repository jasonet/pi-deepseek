// Keep at most one snapshot in flight. A busy renderer must not accumulate
// serialized copies of every token; intermediate snapshots are replaceable.
export class RendererPublisher<T> {
  private pending: (() => T) | undefined;
  private inFlight: number | undefined;
  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly send: (payload: T, sequence: number) => void) {}

  push(payload: () => T): void {
    this.pending = payload;
    this.schedule();
  }

  acknowledge(sequence: number): void {
    if (sequence !== this.inFlight) return;
    this.inFlight = undefined;
    this.schedule();
  }

  reset(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
    this.inFlight = undefined;
  }

  private schedule(): void {
    if (this.inFlight !== undefined || this.timer || !this.pending) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const payload = this.pending;
      this.pending = undefined;
      if (!payload) return;
      this.inFlight = ++this.sequence;
      this.send(payload(), this.inFlight);
    }, 50);
  }
}
