'use strict';
const fs=require('node:fs'),p=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=p.resolve(__dirname,'..'),files=require('./release-files.json');
const sourceFiles=[...files,'package.json','.gitignore','scripts/check-release.cjs','scripts/package-release.ps1','scripts/release-files.json','tests/patch.test.cjs','tests/ui.test.cjs','tests/launcher.test.cjs'];
const personalPath=new RegExp('(?:C:[\\\\/]+Users[\\\\/]+Administrator|D:[\\\\/]+(?:AIGC_Deps|Code_project))','i');
const credential=/(?:sk-ant-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{24,})/;
for(const rel of sourceFiles){
 const file=p.resolve(root,rel);assert.ok(file.startsWith(root+p.sep));assert.ok(fs.statSync(file).isFile(),rel);
 const text=fs.readFileSync(file,'utf8');
 // This audit contains example patterns, not personal paths or real credentials.
 if(rel!=='scripts/check-release.cjs'){assert.ok(!personalPath.test(text),'Personal path in '+rel);assert.ok(!credential.test(text),'Possible credential in '+rel);}
 if(rel.endsWith('.cjs')){const result=cp.spawnSync(process.execPath,['--check',file],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
}
const data=JSON.parse(fs.readFileSync(p.join(root,'lib/translations.json'),'utf8'));
for(const key of ['desktop','desktopExtra','frontend','ui','statsig']){
 assert.ok(data[key]&&typeof data[key]==='object');assert.ok(Object.values(data[key]).every(v=>typeof v==='string'),key);
}
for(const f of files)assert.ok(!/^(?:\.state|\.review|dist|tests|node_modules)(?:\/|$)/.test(f));
const ignores=fs.readFileSync(p.join(root,'.gitignore'),'utf8');for(const item of ['.state/','.review/','dist/'])assert.ok(ignores.includes(item));
console.log(`Release check passed: ${files.length} runtime files; code syntax, translation structure and basic privacy checks passed.`);
