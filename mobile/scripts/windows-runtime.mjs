import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

// PE exception tables can make objdump output larger than execFileSync's
// default buffer. Read it line by line and retain only imported DLL names.
export async function readDllImports(binary, { command = 'objdump', args = ['-p', binary] } = {}) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const imports = new Set()
  let stderr = ''
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4096) })
  const exited = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`Could not inspect Windows imports for ${binary}: ${signal || code}${stderr ? '\n' + stderr : ''}`))
    })
  })
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  try {
    await Promise.all([exited, (async () => {
      for await (const line of lines) {
        const match = /^\s*DLL Name:\s*(\S.*?)\s*$/.exec(line)
        if (match) imports.add(match[1])
      }
    })()])
  } catch (error) {
    child.kill()
    throw error
  } finally {
    lines.close()
  }
  return [...imports]
}
