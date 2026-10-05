#!/usr/bin/env python3
"""Deterministic authored-source archive; never packages third-party toolchains."""
import hashlib,json,pathlib,subprocess,sys,zipfile
root=pathlib.Path(__file__).resolve().parents[1]
out=pathlib.Path(sys.argv[1]).resolve() if len(sys.argv)>1 else root.parent/'caption-seam-output'
out.mkdir(parents=True,exist_ok=True)
excluded={'.git','node_modules','test-results','artifacts','__pycache__','.DS_Store'}
files=sorted(p for p in root.rglob('*') if p.is_file() and not any(part in excluded for part in p.relative_to(root).parts) and not p.name.endswith('.pyc'))
for p in files:
 if p.suffix.lower() in {'.mp4','.webm','.woff','.woff2','.ttf','.otf','.ttc','.exe','.so'}:raise RuntimeError(f'Unexpected distributable binary: {p}')
def archive(path,entries):
 with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
  for name,data in entries:
   info=zipfile.ZipInfo(name,(2026,10,5,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16;z.writestr(info,data)
source=out/'caption-seam-source.zip'
archive(source,[(str(p.relative_to(root)),p.read_bytes()) for p in files])
manifest={'schema':'caption-seam-source-manifest/v1','files':[{'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files],'archive':{'name':source.name,'bytes':source.stat().st_size,'sha256':hashlib.sha256(source.read_bytes()).hexdigest()}}
(out/'source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(out/'caption-seam.html').write_bytes((root/'dist/index.html').read_bytes())
subprocess.run(['node','scripts/export-example.mjs'],cwd=root,check=True)
example=[('inputs/'+p.name,p.read_bytes()) for p in sorted((root/'fixtures').glob('*')) if p.is_file()]
example += [('expected-exports/'+p.name,p.read_bytes()) for p in sorted((root/'artifacts/cli').glob('*')) if p.name in {'recut.srt','recut.vtt','decisions.json','provenance.json','review.csv'}]
archive(out/'caption-seam-example.zip',example)
print(json.dumps({'fileCount':len(files),'archive':manifest['archive']},indent=2))
