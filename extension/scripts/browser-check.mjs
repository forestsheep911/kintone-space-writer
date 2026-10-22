import { chromium, expect } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, request as httpRequest } from 'node:http'
import { createServer as createTcpServer } from 'node:net'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const runRoot = path.join(root,'local-runs/extension-browser')
await mkdir(runRoot,{recursive:true})
const run = await mkdtemp(path.join(runRoot,'run-'))
const workspace = path.join(run,'workspace')
await mkdir(path.join(workspace,'assets/nested'),{recursive:true})
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG3sAAAAASUVORK5CYII=','base64')
await writeFile(path.join(workspace,'assets/nested/test.png'),png)
const blocks = [
  {type:'heading',text:'扩展回归文章',level:2},
  {type:'paragraph',text:'检查正文 @Demo User',runs:[{text:'检查正文 '},{text:'@Demo User',mention:{query:'Demo User',entityType:'USER'}}]},
  {type:'imageRow',images:[{type:'image',fileName:'nested/test.png',width:320},{type:'image',fileName:'nested/test.png',width:240}]},
  {type:'paragraph',text:'结尾正文'},
]
const demoTitle = '【扩展试写】常用工具，值得再往前做一步'
const fixtures = [
  {id:'browser-demo',version:'v001',title:demoTitle,blocks},
  {id:'browser-demo',version:'v002',title:demoTitle,blocks:[...blocks,{type:'paragraph',text:'第二版'}]},
  {id:'cancel-demo',version:'v001',title:'取消测试',blocks:[{type:'paragraph',text:'不得覆盖'},{type:'image',fileName:'nested/test.png',width:600}]},
]
for (const [index,article] of fixtures.entries()) await writeFile(path.join(workspace,`article-${index}.json`),JSON.stringify({schema:'kintone-rich-article.v1',...article}))
const bridgePath = path.join(root,'plugins/kintone-space-writer/scripts/kintone_article_bridge.py')
execFileSync('python',['-c',`import importlib.util,pathlib,sys
spec=importlib.util.spec_from_file_location('bridge',sys.argv[1]); m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
w=pathlib.Path(sys.argv[2])
for i,p in enumerate(sorted(w.glob('article-*.json'))):
 package=m.create_ready_package(w,p,w/'assets')
 package['createdAt']=f'2026-10-22T00:00:{i:02d}+00:00'
 m.atomic_write_json(m.package_path(w,package['id']),package)
`,bridgePath,workspace],{stdio:'inherit'})
let ownedPort
for(let port=8787;port<=8807;port++){
  const probe=createTcpServer()
  const free=await new Promise(resolve=>{probe.once('error',()=>resolve(false));probe.listen(port,'127.0.0.1',()=>probe.close(()=>resolve(true)))})
  if(free){ownedPort=port;break}
}
if(!ownedPort)throw new Error('No free Bridge fixture port')
const server = spawn('python',[bridgePath,'serve','--workspace',workspace,'--port-start',String(ownedPort),'--port-end',String(ownedPort),'--idle-timeout','300'],{stdio:['ignore','ignore','pipe'],windowsHide:true})
let serverError = ''
server.stderr.on('data',chunk=>{serverError+=chunk.toString()})
let context, testProxy, testProxyPort
const checks = []
const pageErrors = []
let uploads = 0, publishes = 0, slowUpload = false, rejectUpload = false, fixturePort = 0
const identity = JSON.parse(await readFile(path.join(root,'extension/identity.json'),'utf8'))
const host = 'https://writer.s.cybozu.cn'
const html = `<!doctype html><meta charset="utf-8"><title>kintone fixture</title>
<style>body{font:16px system-ui;padding:30px}#editor{width:650px;min-height:220px;border:1px solid #aaa}textarea{width:500px;height:50px}</style>
<textarea class="ocean-ui-comments-commentform-textarea" placeholder="发表评论…"></textarea>
<button id="publish">发表</button>
<script>window.kintone={getRequestToken:()=> 'fixture-csrf'};
document.querySelector('textarea').addEventListener('click',event=>{const editor=document.createElement('div');editor.id='editor';editor.className='comment-editor';editor.contentEditable='true';editor.setAttribute('role','textbox');event.target.replaceWith(editor)})
document.querySelector('#publish').addEventListener('click',()=>fetch('/fixture-publish',{method:'POST'}));</script>`

async function waitForBridge() {
  await expect.poll(async()=>{
    if (server.exitCode !== null) throw new Error(serverError || 'Bridge exited')
    try {
      const state = JSON.parse(await readFile(path.join(workspace,'local-runs/kintone-space-writer/bridge.json'),'utf8'))
      const health=await (await fetch(`http://127.0.0.1:${state.port}/health`)).json()
      return health.instanceId===state.instanceId?state.port:0
    } catch { return 0 }
  },{timeout:10000}).toBeGreaterThan(0)
  fixturePort = JSON.parse(await readFile(path.join(workspace,'local-runs/kintone-space-writer/bridge.json'),'utf8')).port
}
async function launch() {
  return chromium.launchPersistentContext(path.join(run,'profile'),{
    channel:'chromium',headless:true,viewport:{width:1320,height:900},
    proxy:{server:`http://127.0.0.1:${testProxyPort}`,bypass:'<-loopback>'},
    args:[`--disable-extensions-except=${path.join(root,'dist/kintone-space-writer-extension')}`,`--load-extension=${path.join(root,'dist/kintone-space-writer-extension')}`],
  })
}
async function ready(page) {
  await expect(page.locator('#ksw-standard-panel-connection')).toHaveAttribute('data-online','true',{timeout:15000})
  await expect(page.locator('.article-group')).toHaveCount(2)
}
async function expand(page,title) { const group=page.locator('.article-group').filter({has:page.locator('.article-group-title',{hasText:title})}); if(await group.getAttribute('data-collapsed')==='true') await group.locator('.article-group-toggle').click(); return group }
async function finish(page) { await expect(page.locator('#ksw-standard-panel-cancel')).toBeHidden({timeout:15000}); await expect(page.locator('#ksw-standard-panel-message')).not.toHaveAttribute('data-kind','error') }
async function installRoutes() {
  await context.route('**/*',async route=>{
    const url = new URL(route.request().url())
    if (url.protocol === 'chrome-extension:') return route.continue()
    if (url.hostname === '127.0.0.1' && Number(url.port) === fixturePort) return route.continue()
    if (url.hostname !== 'writer.s.cybozu.cn' && url.hostname !== 'untrusted.example') return route.abort()
    if (url.pathname === '/k/') return route.fulfill({contentType:'text/html',body:html})
    if (url.pathname === '/k/api/directory/search.json') return route.fulfill({json:{success:true,result:{users:[{id:'7',code:'demo',name:'Demo User'}]}}})
    if (url.pathname === '/k/api/user/pick.json') {
      const body = route.request().postDataJSON()
      if(body.__REQUEST_TOKEN__!=='fixture-csrf') throw new Error('Main-world token missing')
      return route.fulfill({json:{success:true}})
    }
    if (url.pathname === '/k/api/blob/upload.json') {
      uploads++
      if(route.request().headers()['x-cybozu-requesttoken']!=='fixture-csrf') throw new Error('Upload token missing')
      if(slowUpload) await new Promise(resolve=>setTimeout(resolve,800))
      return route.fulfill({json:rejectUpload?{success:false}:{success:true,result:{fileKey:`fixture-${uploads}`,image:true}}}).catch(()=>{})
    }
    if (url.pathname === '/k/api/blob/download.do') return route.fulfill({contentType:'image/png',body:png})
    if (url.pathname === '/fixture-publish') { publishes++; return route.fulfill({json:{success:true}}) }
    return route.fulfill({status:404,body:''})
  })
  context.on('page',page=>page.on('pageerror',error=>pageErrors.push(error.message)))
}
try {
  await waitForBridge()
  // Extension service worker traffic can bypass Playwright routing. A browser
  // proxy ensures probes cannot reach an unrelated real article Bridge.
  testProxy=createServer((incoming,outgoing)=>{
    let target
    try { target=new URL(incoming.url) } catch { outgoing.writeHead(400);outgoing.end();return }
    if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||Number(target.port)!==fixturePort){outgoing.writeHead(403,{'content-type':'application/json'});outgoing.end('{"error":"outside-fixture"}');return}
    const upstream=httpRequest(target,{method:incoming.method,headers:incoming.headers},response=>{outgoing.writeHead(response.statusCode,response.headers);response.pipe(outgoing)})
    upstream.on('error',()=>{if(!outgoing.headersSent)outgoing.writeHead(502);outgoing.end()})
    incoming.pipe(upstream)
  })
  testProxy.on('connection',socket=>socket.on('error',()=>{}))
  testProxy.on('connect',(_request,socket)=>{socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')})
  await new Promise(resolve=>testProxy.listen(0,'127.0.0.1',resolve))
  testProxyPort=testProxy.address().port
  context = await launch()
  await installRoutes()
  let worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
  if(!worker.url().startsWith(`chrome-extension://${identity.id}/`)) throw new Error('Extension identity mismatch')
  const page = await context.newPage()
  await page.goto(`${host}/k/#/space/1/thread/2`)
  await ready(page)
  await expect(page.locator('.article-group[data-collapsed="false"]')).toHaveCount(1)
  const demo = await expand(page,demoTitle)
  await expect(demo.locator('.version-row')).toHaveCount(1)
  await demo.locator('.version-history').click()
  await expect(demo.locator('.version-row')).toHaveCount(2)
  await page.locator('#ksw-standard-panel-refresh').click()
  await expect(page.locator('#ksw-standard-panel-message')).toContainText('已读取')
  await expect(demo.locator('.version-row')).toHaveCount(2)
  await demo.locator('.version-history').click()
  await expect(demo.locator('.version-row')).toHaveCount(1)
  const createdTime = await demo.locator('.version-meta').first().getAttribute('datetime')
  expect(createdTime).toBe('2026-10-22T00:00:01+00:00')
  checks.push('one-article-initially-expanded','history-on-demand-survives-refresh')
  await demo.locator('.version-apply').first().click()
  await expect(page.locator('#ksw-standard-panel-message')).toContainText('请先点击')
  expect(uploads).toBe(0)
  checks.push('requires-user-opened-editor')
  await page.locator('textarea').click()
  await demo.locator('.version-apply').first().click()
  await finish(page)
  await expect(page.locator('#editor img.cybozu-tmp-file')).toHaveCount(2)
  await expect(page.locator('#editor')).toContainText('第二版')
  await expect(page.locator('#editor [data-mention-code="demo"]')).toHaveCount(1)
  expect(uploads).toBe(2)
  expect(publishes).toBe(0)
  const shape=await page.locator('#editor img').evaluateAll(images=>images.map(image=>({parent:image.parentElement.tagName,style:image.getAttribute('style'),width:image.width})))
  expect(shape).toEqual([{parent:'DIV',style:null,width:320},{parent:'DIV',style:null,width:240}])
  checks.push('real-python-bridge-nested-assets','main-world-token-and-mentions','ordered-native-image-row','never-publishes')
  await expect(page.locator('#ksw-standard-panel-receipt')).toContainText('最近写入：v002')
  await expect(page.locator('#ksw-standard-panel-receipt')).toContainText('2 张图片')
  expect(await demo.locator('.version-meta').first().getAttribute('datetime')).toBe(createdTime)
  await page.locator('#editor').press('End')
  await page.locator('#editor').pressSequentially(' 手动修改')
  await expect(page.locator('#ksw-standard-panel-receipt')).toContainText('编辑器已修改')
  checks.push('creation-time-does-not-change-on-write','recent-write-and-manual-edit-state')
  await demo.locator('.version-apply').first().click()
  await finish(page)
  await expect(page.locator('#ksw-standard-panel-receipt')).toHaveAttribute('data-modified','false')
  expect(uploads).toBe(2)
  await expect(demo).toContainText('图片无需重传')
  checks.push('same-editor-image-reuse')
  const cancelGroup=page.locator('.article-group').filter({has:page.locator('.article-group-title',{hasText:'取消测试'})})
  if(await cancelGroup.getAttribute('data-collapsed')==='false') await cancelGroup.locator('.article-group-toggle').click()
  await page.locator('#editor').press('Control+Home')
  await page.screenshot({path:path.join(run,'panel-overview.png')})
  await page.locator('#ksw-standard-panel').screenshot({path:path.join(run,'panel-expanded.png')})
  await page.setViewportSize({width:320,height:900})
  await expect.poll(()=>page.locator('#ksw-standard-panel').evaluate(panel=>panel.getBoundingClientRect().right)).toBeLessThanOrEqual(320)
  const layout=await page.locator('#ksw-standard-panel').evaluate(panel=>({x:panel.getBoundingClientRect().x,right:panel.getBoundingClientRect().right,overflow:panel.scrollWidth>panel.clientWidth}))
  expect(layout.x).toBeGreaterThanOrEqual(0)
  expect(layout.right).toBeLessThanOrEqual(320)
  expect(layout.overflow).toBe(false)
  await page.screenshot({path:path.join(run,'panel-narrow.png')})
  await page.setViewportSize({width:1320,height:900})
  const dragHandle=await page.locator('#ksw-standard-panel-header').boundingBox()
  await page.mouse.move(dragHandle.x+60,dragHandle.y+12)
  await page.mouse.down()
  await page.mouse.move(1000,30,{steps:5})
  await page.mouse.up()
  await expect.poll(()=>page.locator('#ksw-standard-panel').evaluate(panel=>panel.getBoundingClientRect().x)).toBeGreaterThan(800)
  checks.push('narrow-viewport-panel-fits-without-horizontal-overflow')
  await page.getByRole('button',{name:'收起面板',exact:true}).click()
  await expect(page.locator('.panel-drag-hint')).toBeVisible()
  await expect(page.locator('#ksw-standard-panel-title')).toContainText('Space Writer')
  await expect(page.locator('#ksw-standard-panel .panel-body')).toBeHidden()
  const compactHandle=await page.locator('.panel-drag-handle').boundingBox()
  await page.mouse.move(compactHandle.x+45,compactHandle.y+12)
  await page.mouse.down()
  await page.mouse.move(0,0,{steps:5})
  const compactEdge=await page.locator('#ksw-standard-panel').boundingBox()
  expect(compactEdge.x).toBeGreaterThanOrEqual(12)
  expect(compactEdge.y).toBeGreaterThanOrEqual(12)
  await page.mouse.move(1100,180,{steps:5})
  await page.mouse.up()
  const compactPosition=await page.locator('#ksw-standard-panel').evaluate(panel=>({x:panel.offsetLeft,y:panel.offsetTop}))
  expect(compactPosition.x).toBeGreaterThan(1000)
  expect(compactPosition.y).toBeGreaterThan(120)
  await expect.poll(()=>worker.evaluate(async()=>{
    const saved=await chrome.storage.local.get('ksw-standard-panel-state')
    return saved['ksw-standard-panel-state']
  })).toEqual({left:compactPosition.x,top:compactPosition.y,collapsed:true})
  await page.reload(); await ready(page)
  await expect(page.locator('#ksw-standard-panel')).toHaveCSS('left',`${compactPosition.x}px`)
  await expect(page.locator('#ksw-standard-panel')).toHaveAttribute('data-collapsed','true')
  await page.locator('#ksw-standard-panel').screenshot({path:path.join(run,'panel-compact.png')})
  await page.getByRole('button',{name:'展开面板',exact:true}).click()
  await expect(page.locator('#ksw-standard-panel .panel-body')).toBeVisible()
  const expandedPosition=await page.locator('#ksw-standard-panel').evaluate(panel=>({top:panel.offsetTop,right:panel.getBoundingClientRect().right}))
  expect(expandedPosition.top).toBe(compactPosition.y)
  expect(expandedPosition.right).toBeLessThanOrEqual(1320)
  checks.push('compact-label-area-drags-with-separate-expand-button','compact-drag-handle-remains-in-viewport','compact-position-and-collapse-persist-after-reload','expanding-near-edge-keeps-panel-visible')
  await demo.locator('.article-archive').click()
  await expect(page.locator('.article-group')).toHaveCount(1)
  await page.reload(); await expect(page.locator('.article-group')).toHaveCount(1)
  await expect(page.locator('#ksw-standard-panel-receipt')).toBeHidden()
  await page.locator('#ksw-standard-panel-archive').click()
  await expect(page.locator('.article-group')).toHaveCount(1)
  await page.locator('.article-archive').click()
  await expect(page.locator('.article-group')).toHaveCount(0)
  await page.locator('#ksw-standard-panel-active').click()
  await expect(page.locator('.article-group')).toHaveCount(2)
  checks.push('archive-restore-persists-after-reload')
  await page.locator('textarea').click()
  await (await expand(page,demoTitle)).locator('.version-apply').first().click()
  await finish(page)
  expect(uploads).toBe(4)
  checks.push('new-editor-reuploads-images')
  const before=await page.locator('#editor').innerHTML()
  slowUpload=true
  await (await expand(page,'取消测试')).locator('.version-apply').click()
  await expect.poll(()=>uploads).toBe(5)
  await page.locator('#ksw-standard-panel-cancel').click()
  await finish(page)
  expect(await page.locator('#editor').innerHTML()).toBe(before)
  checks.push('cancel-preserves-existing-editor')
  slowUpload=false;rejectUpload=true
  await (await expand(page,'取消测试')).locator('.version-apply').click()
  await expect(page.locator('#ksw-standard-panel-cancel')).toBeHidden()
  await expect(page.locator('#ksw-standard-panel-message')).toHaveAttribute('data-kind','error')
  expect(await page.locator('#editor').innerHTML()).toBe(before)
  rejectUpload=false
  checks.push('upload-failure-preserves-existing-editor')
  slowUpload=true
  const uploadsBeforeNavigation=uploads
  await (await expand(page,'取消测试')).locator('.version-apply').click()
  await expect.poll(()=>uploads).toBe(uploadsBeforeNavigation+1)
  await page.evaluate(()=>{location.hash='/space/1/thread/3'})
  await expect(page.locator('#ksw-standard-panel-cancel')).toBeHidden({timeout:15000})
  await expect(page.locator('#ksw-standard-panel-message')).toContainText('话题或编辑器已改变')
  expect(await page.locator('#editor').innerHTML()).toBe(before)
  slowUpload=false
  checks.push('thread-navigation-during-upload-prevents-insertion')
  // Use the actual exporter code with fixture Tampermonkey storage, then import its download.
  const exporter=await context.newPage()
  await exporter.goto('https://untrusted.example/k/#/space/1/thread/2')
  await exporter.evaluate(()=>{
    const values={'ksw-archived-article:browser-demo':true,'ksw-standard-panel-state':{left:50,top:80,collapsed:false},token:'must-not-export'}
    window.GM_listValues=()=>Object.keys(values)
    window.GM_getValue=key=>values[key]
  })
  await exporter.addScriptTag({path:path.join(root,'extension/migration/export-settings.user.js')})
  const downloadEvent=exporter.waitForEvent('download')
  await exporter.getByRole('button',{name:'导出旧版设置'}).click()
  const download=await downloadEvent
  const exported=await readFile(await download.path())
  expect(exported.toString()).not.toContain('must-not-export')
  const options=await context.newPage()
  await options.goto(`chrome-extension://${identity.id}/options.html`)
  await options.locator('#import').setInputFiles({name:'settings.json',mimeType:'application/json',buffer:exported})
  await expect(options.locator('#status')).toContainText('已导入 2 项')
  await expect(page.locator('.article-group')).toHaveCount(1)
  await page.reload()
  await expect(page.locator('#ksw-standard-panel')).toHaveCSS('left','50px')
  const rejected = await options.evaluate(()=>chrome.runtime.sendMessage({channel:'ksw-extension.v1',kind:'bridge',port:8787,operation:'health'}))
  expect(rejected.ok).toBe(false)
  checks.push('exporter-download-to-settings-import','settings-import-live-sync','options-page-cannot-proxy-bridge')
  const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id,page.url())
  const invalidPort=await worker.evaluate(async tabId=>{
    const results=await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:()=>chrome.runtime.sendMessage({channel:'ksw-extension.v1',kind:'bridge',operation:'health',port:22})})
    return results[0].result
  },tabId)
  expect(invalidPort.ok).toBe(false)
  checks.push('content-script-cannot-escape-bridge-port-range')
  const unsupported=await context.newPage()
  await unsupported.goto('https://untrusted.example/k/#/space/1/thread/2')
  await expect(unsupported.locator('#ksw-standard-panel')).toHaveCount(0)
  checks.push('untrusted-host-not-injected')
  const cdp=await context.newCDPSession(page)
  const targets=await cdp.send('Target.getTargets')
  const workerTarget=targets.targetInfos.find(target=>target.type==='service_worker'&&target.url.includes(identity.id))
  expect(workerTarget).toBeTruthy()
  await cdp.send('Target.closeTarget',{targetId:workerTarget.targetId})
  await page.locator('#ksw-standard-panel-refresh').click()
  await expect(page.locator('#ksw-standard-panel-message')).toContainText('已读取',{timeout:15000})
  checks.push('service-worker-termination-and-event-recovery')
  await page.screenshot({path:path.join(run,'panel.png')})
  await options.screenshot({path:path.join(run,'settings.png')})
  // A fresh browser process preserves the public-key identity and local storage.
  await context.close(); context=await launch(); await installRoutes()
  worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker')
  expect(worker.url()).toContain(identity.id)
  const reopened=await context.newPage();await reopened.goto(`${host}/k/#/space/1/thread/2`)
  await expect(reopened.locator('#ksw-standard-panel-connection')).toHaveAttribute('data-online','true',{timeout:15000})
  await expect(reopened.locator('.article-group')).toHaveCount(1)
  await reopened.locator('#ksw-standard-panel-archive').click()
  await expect(reopened.locator('.article-group')).toContainText(demoTitle)
  checks.push('browser-and-worker-restart-retains-storage-and-id')
  expect(publishes).toBe(0)
  expect(pageErrors).toEqual([])
  const report={version:JSON.parse(await readFile(path.join(root,'extension/package.json'),'utf8')).version,id:identity.id,environment:'isolated Chromium, real Python Bridge, mocked kintone HTTPS; external network blocked',checks,uploads,publishes,pageErrors,liveTenantAcceptance:false}
  await writeFile(path.join(run,'report.json'),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({passed:checks.length,report:path.join(run,'report.json'),id:identity.id},null,2))
} catch(error) {
  await writeFile(path.join(run,'failure.json'),JSON.stringify({checks,error:String(error),pageErrors,serverError},null,2))
  console.error(`Browser check evidence: ${run}`)
  throw error
} finally { if(context) await context.close(); server.kill();if(testProxy){testProxy.closeAllConnections();await new Promise(resolve=>testProxy.close(resolve))} }
