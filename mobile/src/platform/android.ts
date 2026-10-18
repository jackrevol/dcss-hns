// The native host injects this message port only into the bundled HTTPS
// origin's main frame. Browsers keep the upstream share/download path.
interface AndroidPort {
  postMessage(message: string): void
  onmessage: ((event: { data: string }) => void) | null
}

declare global {
  interface Window { HnsAndroid?: AndroidPort }
}

export function isAndroidApp(): boolean {
  return typeof window !== 'undefined' && !!window.HnsAndroid
}

let exporting = false

export async function exportAndroidFile(file: File): Promise<boolean> {
  const port = window.HnsAndroid
  if (!port) throw new Error('Android export is unavailable')
  if (exporting) throw new Error('A backup export is already open')
  if (file.size > 32 * 1024 * 1024) throw new Error('Backup exceeds the 32 MB export limit')
  exporting = true
  try {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1])
      reader.onerror = () => reject(reader.error ?? new Error('Could not read backup'))
      reader.readAsDataURL(file)
    })
    return await new Promise<boolean>((resolve, reject) => {
      port.onmessage = ({ data: reply }) => {
        try {
          const result = JSON.parse(reply) as { ok: boolean; error?: string }
          if (result.error) reject(new Error(result.error))
          else resolve(result.ok)
        } catch (error) { reject(error) }
        finally { port.onmessage = null }
      }
      port.postMessage(JSON.stringify({ type: 'export', name: file.name, data }))
    })
  } finally { exporting = false }
}
