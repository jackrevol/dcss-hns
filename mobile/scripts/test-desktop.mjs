import { _electron as electron, expect } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const root=fileURLToPath(new URL('..',import.meta.url)),profile=mkdtempSync(tmpdir()+'/hns-desktop-test-')
const instance=await electron.launch({args:[resolve(root,'build/desktop-source')],env:{...process.env,HNS_DESKTOP_DATA:profile}})
try {
  const page=await instance.firstWindow()
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(60_000)
  await expect(page.locator('#offline-cloud')).toBeVisible()
  assert.equal(await page.evaluate(()=>isSecureContext),true)
  await page.locator('#offline-cloud').click()
  await expect(page.locator('#cloud-login-form')).toBeVisible()
  await expect(page.getByLabel('아이디',{exact:true})).toBeVisible()
  await expect(page.locator('input[type="email"]')).toHaveCount(0)
  await page.getByRole('button',{name:'Close',exact:true}).click()
  await expect(page.locator('#offline-download')).toBeHidden()
  await expect(page.locator('#offline-ready-sub')).toContainText('클라이언트에 포함됨')
  const chooser=page.waitForEvent('filechooser')
  await page.locator('#offline-import').click()
  await (await chooser).setFiles(process.env.HNS_DESKTOP_PACK||resolve(root,'test-results/offline-backup.pzsave'))
  await expect(page.locator('#offline-saves')).toContainText('HnsSmoke')
  // No internet can satisfy startup or the resumed save.
  await instance.context().route('**/*',r=>r.request().url().startsWith('https://appassets.dcsshns.invalid/')?r.continue():r.abort())
  await page.locator('#offline-saves').getByRole('button').first().click()
  await expect(page.locator('#game-view')).toBeVisible()
  await expect(page.locator('body')).toContainText('Welcome back, HnsSmoke',{timeout:90_000})
  await page.screenshot({path:resolve(root,'test-results/desktop-resumed.png')})
  // Send the engine's normal save-and-exit command, then confirm it.
  await page.evaluate(()=>window.__pzEngine.sendKeys('S'))
  await page.evaluate(()=>window.__pzEngine.sendKeys('y'))
  await expect(page.locator('#offline-saves')).toContainText('HnsSmoke',{timeout:30_000})
  assert.deepEqual(errors,[])
  console.log('PASS: desktop secure origin, local assets, cloud UI, native/browser pack import, real WASM resume without internet, save and exit')
} catch(error) {
  const windows=instance.windows();
  if(windows[0]) console.error('DESKTOP_FAILURE', await windows[0].locator('body').innerText());
  throw error
} finally {await instance.close();rmSync(profile,{recursive:true,force:true})}
