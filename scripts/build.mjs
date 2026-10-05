import fs from 'node:fs/promises';
let core=await fs.readFile('src/core.mjs','utf8'),app=await fs.readFile('src/app.mjs','utf8'),html=await fs.readFile('src/index.html','utf8'),css=await fs.readFile('src/style.css','utf8');
core=core.replace(/^export /gm,'');app=app.replace(/^import .*?;\n/,'');
html=html.replace('<link rel="stylesheet" href="style.css">',()=>`<style>${css}</style>`).replace('<script type="module" src="app.mjs"></script>',()=>`<script type="module">${(core+'\n'+app).replaceAll('</script','<\\/script')}</script>`);
await fs.mkdir('dist',{recursive:true});await fs.writeFile('dist/index.html',html);console.log(`Standalone app: ${Buffer.byteLength(html)} bytes`);
