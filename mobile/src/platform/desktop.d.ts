export {}
declare global {
  interface Window {
    HnsDesktop?: {
      bundled: true
      native?: true
      version?: string
      play(name: string, pack: Uint8Array): Promise<{ pack: Uint8Array; code: number; manage: boolean }>
      recover(): Promise<Uint8Array | null>
      finish(): Promise<void>
      checkpoint(): Promise<void>
      close(): Promise<void>
      show(): Promise<void>
      exportFile(name: string, bytes: Uint8Array): Promise<boolean>
      onCheckpoint(callback: (pack: Uint8Array) => void): () => void
    }
  }
}
