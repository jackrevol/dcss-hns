import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
const root=fileURLToPath(new URL('..',import.meta.url)),origin='http://127.0.0.1:4280'
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4280','--strictPort'],{cwd:root,stdio:'ignore'})
let browser
try{
  for(let n=0;n<100;n++){try{if((await fetch(origin)).ok)break}catch{};await new Promise(r=>setTimeout(r,100))}
  browser=await chromium.launch()
  const context=await browser.newContext({viewport:{width:412,height:915}}),page=await context.newPage(),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto(origin+'/?offline=1&jspi=0')
  // No Install button is used: the web client includes all game assets.
  await page.evaluate(async()=>{
    await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Game client installation timed out')),30_000))])
    if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}))
  })
  await expect(page.locator('#offline-download')).toBeHidden({timeout:30_000})
  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('#offline-ready-sub')).toContainText('클라이언트에 포함됨',{timeout:30_000})
  const picker=page.waitForEvent('filechooser')
  await page.locator('#offline-import').click()
  await(await picker).setFiles(process.env.HNS_WEB_PACK||resolve(root,'test-results/offline-backup.pzsave'))
  await expect(page.locator('.offline-slot-row')).toContainText('HnsSmoke')
  await page.locator('.offline-slot-row').first().click()
  await expect(page.locator('body')).toContainText('Welcome back, HnsSmoke',{timeout:90_000})
  await page.screenshot({path:resolve(root,'test-results/web-bundled-offline.png')})
  assert.deepEqual(errors,[])
  console.log('PASS: first web installation includes game data; no download button; full offline reload and real engine resume')
}catch(error){console.error(error);throw error}finally{await browser?.close();server.kill()}
