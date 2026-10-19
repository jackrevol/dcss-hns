export {}
import type { DesktopAction, DesktopActionData } from './desktop-actions'
declare global {
  interface Window {
    HnsDesktop?: {
      bundled: true
      native?: true
      version?: string
      play(name: string, pack: Uint8Array): Promise<{ pack: Uint8Array; code: number; manage: boolean; preserveLocal?: boolean }>
      recover(): Promise<Uint8Array | null>
      finish(): Promise<void>
      checkpoint(): Promise<void>
      checkSaveCompatibility(pack: Uint8Array): Promise<boolean>
      close(): Promise<void>
      reportError(message: string): Promise<void>
      exportFile(name: string, bytes: Uint8Array): Promise<boolean>
      importFile(): Promise<Uint8Array | null>
      menuStarted(id: number): Promise<void>
      onAction(callback: (action: DesktopAction, pack: Uint8Array) => void): () => void
      answerAction(id: number, data: DesktopActionData, pack: Uint8Array): Promise<void>
      onCheckpoint(callback: (pack: Uint8Array) => void): () => void
    }
  }
}
