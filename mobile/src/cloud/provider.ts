export interface CloudLink { key: string; label: string; allowEmpty: boolean }
export interface CloudProvider {
  supported(): boolean
  status(): Promise<CloudLink | null>
  read(): Promise<Uint8Array>
  write(bytes: Uint8Array, expectedRawHash: string): Promise<void>
  disconnect(): Promise<void>
}
export class CloudAccessError extends Error {}
export class CloudRaceError extends Error {
  constructor() { super('클라우드 세이브가 다른 기기나 창에서 변경됐습니다. 다시 동기화하세요.') }
}
