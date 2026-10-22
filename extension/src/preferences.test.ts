import { describe, expect, it } from 'vitest'
import { exportPreferenceFile, parsePreferenceFile, PREFERENCE_SCHEMA } from './preferences'

describe('preference migration', () => {
  it('round trips archive flags and panel state without exporting credentials or client IDs', () => {
    const safe = {'ksw-archived-article:demo':true,'ksw-standard-panel-state':{left:30,top:40,collapsed:true}}
    expect(parsePreferenceFile(exportPreferenceFile({...safe,'ksw-standard-client-id':'old','token':'secret'}))).toEqual(safe)
  })
  it('rejects invalid panels, arbitrary keys, wrong schemas and oversized files', () => {
    for (const preferences of [{'token':'x'},{'__proto__':null,'ksw-standard-panel-state':{left:0,top:0,collapsed:'false'}},{'ksw-archived-article:demo':'true'},{'ksw-standard-panel-state':{left:1e9,top:0,collapsed:false}}]) expect(()=>parsePreferenceFile(JSON.stringify({schema:PREFERENCE_SCHEMA,preferences}))).toThrow()
    expect(()=>parsePreferenceFile('{"schema":"wrong"}')).toThrow()
    expect(()=>parsePreferenceFile('x'.repeat(1024*1024+1))).toThrow()
  })
})
