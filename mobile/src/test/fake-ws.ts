// Scriptable WebSocket stand-in for WsConnection tests, same pattern as
// fake-storage.ts. Install with vi.stubGlobal('WebSocket', FakeWS) and reset
// FakeWS.instances per test; the test drives each socket's lifecycle.

export class FakeWS {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: FakeWS[] = []
  readyState = FakeWS.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  sent: string[] = []
  closeCalls = 0
  constructor(readonly url: string, readonly protocol: string) {
    FakeWS.instances.push(this)
  }
  send(data: string): void { this.sent.push(data) }
  // Like the engines: close() on a CONNECTING socket later fires `close`,
  // never `error`. Tests fire it explicitly to control ordering.
  close(): void { this.closeCalls++; this.readyState = FakeWS.CLOSED }
  open(): void { this.readyState = FakeWS.OPEN; this.onopen?.() }
  fireClose(): void { this.readyState = FakeWS.CLOSED; this.onclose?.() }
  fireError(): void { this.onerror?.(new Event('error')) }
  receive(msg: unknown): void { this.onmessage?.({ data: JSON.stringify(msg) }) }
}
