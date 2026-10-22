import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const pkg = JSON.parse(await readFile(path.join(root,'package.json'),'utf8'))
const identity = JSON.parse(await readFile(path.join(root,'identity.json'),'utf8'))
const output = path.join(root,`../dist/kintone-space-writer-extension-v${pkg.version}.zip`)
execFileSync('python',['-c',`import sys,zipfile,pathlib
source=pathlib.Path(sys.argv[1]); destination=pathlib.Path(sys.argv[2])
with zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED) as z:
 for p in sorted(source.rglob('*')):
  if p.is_file(): z.write(p,p.relative_to(source).as_posix())
with zipfile.ZipFile(destination) as z:
 assert z.testzip() is None
 assert 'manifest.json' in z.namelist()
`,path.join(root,'../dist/kintone-space-writer-extension'),output],{stdio:'inherit'})
const bytes = await readFile(output)
await writeFile(output+'.json',JSON.stringify({version:pkg.version,id:identity.id,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},null,2)+'\n')
console.log(output)
