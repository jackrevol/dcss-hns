// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportAndroidFile, isAndroidApp } from './android'

afterEach(() => { delete window.HnsAndroid })

describe('Android backup export', () => {
  it('leaves ordinary browsers on the browser export path', () => {
    expect(isAndroidApp()).toBe(false)
  })

  it('transfers exact bytes and waits for the document provider to finish', async () => {
    let sent: { name: string; data: string } | undefined
    const port = { postMessage: vi.fn((raw: string) => { sent = JSON.parse(raw) }), onmessage: null as ((event: { data: string }) => void) | null }
    window.HnsAndroid = port
    const result = exportAndroidFile(new File([new Uint8Array([0, 128, 255])], 'backup.pzsave'))
    let settled = false
    void result.then(() => { settled = true })
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledOnce())
    expect(sent).toEqual({ type: 'export', name: 'backup.pzsave', data: 'AID/' })
    expect(settled).toBe(false)
    port.onmessage!({ data: '{"ok":true}' })
    expect(await result).toBe(true)
    expect(port.onmessage).toBeNull()
  })

  it('reports cancellation without claiming the backup was exported', async () => {
    const port = { postMessage: vi.fn(), onmessage: null as ((event: { data: string }) => void) | null }
    window.HnsAndroid = port
    const result = exportAndroidFile(new File(['save'], 'backup.pzsave'))
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledOnce())
    port.onmessage!({ data: '{"ok":false}' })
    expect(await result).toBe(false)
  })

  it('rejects provider errors and permits a later retry', async () => {
    const port = { postMessage: vi.fn(), onmessage: null as ((event: { data: string }) => void) | null }
    window.HnsAndroid = port
    const file = new File(['save'], 'backup.pzsave')
    const result = exportAndroidFile(file)
    const assertion = expect(result).rejects.toThrow('Storage full')
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledOnce())
    await expect(exportAndroidFile(file)).rejects.toThrow('already open')
    port.onmessage!({ data: '{"ok":false,"error":"Storage full"}' })
    await assertion
    const retry = exportAndroidFile(file)
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(2))
    port.onmessage!({ data: '{"ok":true}' })
    expect(await retry).toBe(true)
  })

  it('rejects oversized backups before crossing the native bridge', async () => {
    window.HnsAndroid = { postMessage: vi.fn(), onmessage: null }
    const file = new File(['save'], 'backup.pzsave')
    Object.defineProperty(file, 'size', { value: 32 * 1024 * 1024 + 1 })
    await expect(exportAndroidFile(file)).rejects.toThrow('32 MB')
    expect(window.HnsAndroid.postMessage).not.toHaveBeenCalled()
  })
})
