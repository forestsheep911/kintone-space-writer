import { describe, expect, it } from 'vitest'
import { CHANNEL, bridgeTarget, readBounded, supportedPage, validSender } from './protocol'

const base = { channel: CHANNEL, kind: 'bridge', port: 8787, operation: 'package', packageId: 'article-v001-123', token: 'a'.repeat(32) }
describe('extension request boundary', () => {
  it('supports tenant and SecureAccess hosts while rejecting lookalikes and other pages', () => {
    for (const host of ['team.cybozu.cn','team.s.cybozu.com','team.s.kintone.com','team.cybozu-dev.com']) expect(supportedPage(`https://${host}/k/#/space/1/thread/2`)).toBe(true)
    for (const url of ['http://team.cybozu.cn/k/','https://cybozu.cn/k/','https://team.cybozu.cn.evil.test/k/','https://team.cybozu.cn/g/','https://team.cybozu.cn:444/k/']) expect(supportedPage(url)).toBe(false)
    const sender = { id:'extension',frameId:0,tab:{id:1},url:'https://team.cybozu.cn/k/' } as chrome.runtime.MessageSender
    expect(validSender(sender,'extension')).toBe(true)
    expect(validSender({...sender,frameId:1},'extension')).toBe(false)
    expect(validSender({...sender,id:'other'},'extension')).toBe(false)
    expect(validSender({...sender,tab:undefined},'extension')).toBe(false)
  })
  it('builds fixed endpoints and strips extra result fields and spoofed destinations', () => {
    expect(bridgeTarget(base,'page').url).toBe('http://127.0.0.1:8787/v1/packages/article-v001-123')
    expect(bridgeTarget({...base,operation:'result',body:{hash:'a'.repeat(64),status:'injected',pageUrl:'spoofed',extra:'x'}},'actual').body).toEqual({hash:'a'.repeat(64),status:'injected',error:'',pageUrl:'actual'})
    expect(bridgeTarget({...base,operation:'asset',assetName:'目录/image.png'},'page').url).toContain('/assets/%E7%9B%AE%E5%BD%95%2Fimage.png')
  })
  it('rejects port escapes, traversal, invalid credentials, and unknown operations', () => {
    for (const change of [{port:8786},{port:8808},{port:8787.5},{operation:'fetch'},{token:''},{packageId:'../escape'},{operation:'asset',assetName:'../secret'},{operation:'asset',assetName:'a\\b'},{operation:'result',body:{hash:'a'.repeat(64),status:'published'}}]) expect(()=>bridgeTarget({...base,...change},'page')).toThrow()
  })
  it('bounds responses even when content-length is absent or false', async () => {
    await expect(readBounded(new Response('too big'),3)).rejects.toThrow('大小限制')
    await expect(readBounded(new Response('ok',{headers:{'content-length':'999'}}),3)).rejects.toThrow('大小限制')
    expect(new TextDecoder().decode(await readBounded(new Response('ok'),3))).toBe('ok')
  })
})
