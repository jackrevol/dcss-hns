import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readDllImports } from './windows-runtime.mjs'

test('1MiB를 넘는 PE 출력에서도 모든 DLL을 수집한다', async () => {
  const script = `
    process.stdout.write('  DLL Name: KERNEL32.dll\\r\\n');
    process.stdout.write('  unwind table row\\r\\n'.repeat(100000));
    process.stdout.write('  DLL Name: libcurl-4.dll\\r\\n  DLL Name: KERNEL32.dll\\r\\n');
  `
  assert.deepEqual(await readDllImports('game.exe', {
    command: process.execPath, args: ['-e', script],
  }), ['KERNEL32.dll', 'libcurl-4.dll'])
})

test('검사 도구의 실행 실패를 빌드 실패로 전달한다', async () => {
  await assert.rejects(readDllImports('game.exe', {
    command: process.execPath, args: ['-e', "process.stderr.write('invalid PE'); process.exitCode = 2"],
  }), /Could not inspect Windows imports.*2\ninvalid PE/)
  await assert.rejects(readDllImports('game.exe', { command: 'hns-missing-objdump-command' }), /ENOENT/)
})
