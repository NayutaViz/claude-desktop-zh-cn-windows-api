'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),p=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const {run,within}=require('../lib/patch.cjs');
function fixture(t){
 const base=fs.mkdtempSync(p.join(os.tmpdir(),'claude-zh-lite-test-'));
 t.after(()=>{assert.ok(base.startsWith(p.join(os.tmpdir(),'claude-zh-lite-test-')));fs.rmSync(base,{recursive:true,force:true});});
 t.mock.method(cp,'spawnSync',()=>({status:0,stdout:'0\n'}));
 t.mock.method(console,'log',()=>{});
 const root=p.join(base,'app-1.0','resources'),store=p.join(base,'state'),config=p.join(base,'config.json');
 const write=(rel,text)=>{const dest=p.join(root,rel);fs.mkdirSync(p.dirname(dest),{recursive:true});fs.writeFileSync(dest,text);};
 write('app.asar','untouched');write('en-US.json','{"new":"New text"}');write('zh-Hans.json','{"new":"新文案"}');
 write('ion-dist/i18n/en-US.json','{"new":"Untranslated new text"}');
 const original='const locales=["en-US","de-DE","fr-FR","ko-KR","ja-JP","es-ES"]; const item={title:"Settings"};';
 write('ion-dist/assets/test.js',original);
 fs.writeFileSync(config,JSON.stringify({locale:'en-US',unrelated:'keep'}));
 const options={resources:root,store,configs:[config]};
 const folder=()=>{const dirs=fs.readdirSync(store).filter(n=>n!=='operation.lock');const name=dirs.find(n=>{const file=p.join(store,n,'manifest.json');return fs.existsSync(file)&&JSON.parse(fs.readFileSync(file)).root===root;})||dirs[0];return p.join(store,name);};
 const manifest=()=>JSON.parse(fs.readFileSync(p.join(folder(),'manifest.json')));
 return {base,root,store,config,options,write,original,folder,manifest};
}
test('backed install, idempotence and byte-exact restore preserve later settings',t=>{
 const f=fixture(t);run('install',f.options);const baseline=fs.readFileSync(p.join(f.folder(),'baseline.json'));
 run('install',f.options);assert.deepEqual(fs.readFileSync(p.join(f.folder(),'baseline.json')),baseline);
 fs.writeFileSync(f.config,JSON.stringify({locale:'zh-Hans',unrelated:'changed'}));
 run('restore',f.options);
 assert.equal(fs.readFileSync(p.join(f.root,'ion-dist/assets/test.js'),'utf8'),f.original);
 assert.equal(fs.readFileSync(p.join(f.root,'zh-Hans.json'),'utf8'),'{"new":"新文案"}');
 assert.ok(!fs.existsSync(p.join(f.root,'ion-dist/i18n/zh-Hans.json')));
 assert.deepEqual(JSON.parse(fs.readFileSync(f.config)),{locale:'en-US',unrelated:'changed'});
 assert.equal(fs.readFileSync(p.join(f.root,'app.asar'),'utf8'),'untouched');
});
test('no-backup mode has no originals or stored old locale, repeat works, restore refuses',t=>{
 const f=fixture(t);run('install-no-backup',f.options);const m=f.manifest();
 assert.equal(m.backupMode,'none');assert.deepEqual(m.locales,[]);
 assert.ok(!fs.existsSync(p.join(f.folder(),'original')));assert.ok(!fs.existsSync(p.join(f.folder(),'baseline.json')));
 assert.ok(m.files.every(e=>!('before'in e)&&!('backup'in e)));
 run('install-no-backup',f.options);assert.throws(()=>run('restore',f.options),/不备份/);
 assert.throws(()=>run('install',f.options),/不备份/);
});
test('restore verifies but does not rewrite a resource already equal to its original',t=>{
 const f=fixture(t);run('install',f.options);
 f.write('ion-dist/assets/test.js',f.original);
 const rename=fs.renameSync,writes=[];
 t.mock.method(fs,'renameSync',(src,dest)=>{writes.push(dest);return rename(src,dest);});
 run('restore',f.options);
 assert.ok(!writes.includes(p.join(f.root,'ion-dist/assets/test.js')));
 assert.equal(fs.readFileSync(p.join(f.root,'ion-dist/assets/test.js'),'utf8'),f.original);
});
test('no-backup refuses conflicting revision or interrupted state',t=>{
 const f=fixture(t);run('install-no-backup',f.options);const m=f.manifest();m.patchHash='different';
 fs.writeFileSync(p.join(f.folder(),'manifest.json'),JSON.stringify(m));
 assert.throws(()=>run('install-no-backup',f.options),/不能安全叠加/);
});
test('no-backup does not silently discard existing original backups',t=>{
 const f=fixture(t);run('install',f.options);assert.throws(()=>run('install-no-backup',f.options),/请先还原/);
 run('restore',f.options);run('install-no-backup',f.options);assert.ok(fs.existsSync(p.join(f.folder(),'baseline.json')));
});
test('no-backup rolls back ordinary write errors using memory',t=>{
 const f=fixture(t);const rename=fs.renameSync;let injected=false;
 t.mock.method(fs,'renameSync',(src,dest)=>{if(!injected&&dest===f.config){injected=true;throw Error('simulated write failure');}return rename(src,dest);});
 assert.throws(()=>run('install-no-backup',f.options),/simulated write failure/);
 assert.equal(fs.readFileSync(p.join(f.root,'ion-dist/assets/test.js'),'utf8'),f.original);
 assert.equal(JSON.parse(fs.readFileSync(f.config)).locale,'en-US');
 assert.ok(!fs.existsSync(p.join(f.folder(),'manifest.json')));
});
test('unknown layout fails before resource writes',t=>{
 const f=fixture(t);f.write('ion-dist/assets/test.js','const x={title:"Settings"};');
 assert.throws(()=>run('install',f.options),/语言列表结构/);
 assert.ok(!fs.existsSync(p.join(f.root,'ion-dist/i18n/zh-Hans.json')));
});
test('restore refuses foreign file changes',t=>{
 const f=fixture(t);run('install',f.options);f.write('ion-dist/assets/test.js','foreign change');
 assert.throws(()=>run('restore',f.options),/其他程序修改/);
 assert.equal(fs.readFileSync(p.join(f.root,'ion-dist/assets/test.js'),'utf8'),'foreign change');
});
test('new build has independent backups and inherits original locale',t=>{
 const f=fixture(t);run('install',f.options);const second=p.join(f.base,'app-2.0','resources');
 run('restore',f.options);fs.cpSync(f.root,second,{recursive:true});run('install',f.options);
 const next={...f.options,resources:second};run('install',next);run('restore',next);
 assert.equal(JSON.parse(fs.readFileSync(f.config)).locale,'en-US');
 assert.equal(f.manifest().status,'installed');
});
test('successive backed revisions retain initial original baseline',t=>{
 const f=fixture(t);run('install',f.options);const baseline=fs.readFileSync(p.join(f.folder(),'baseline.json'));
 const m=f.manifest();m.patchHash='old';fs.writeFileSync(p.join(f.folder(),'manifest.json'),JSON.stringify(m));
 run('install',f.options);assert.deepEqual(fs.readFileSync(p.join(f.folder(),'baseline.json')),baseline);
 run('restore',f.options);assert.equal(fs.readFileSync(p.join(f.root,'ion-dist/assets/test.js'),'utf8'),f.original);
});
test('running app and live operation lock refuse mutation',t=>{
 const f=fixture(t);t.mock.method(cp,'spawnSync',()=>({status:0,stdout:'1\n'}));
 assert.throws(()=>run('install',f.options),/请先/);
 fs.writeFileSync(p.join(f.store,'operation.lock'),String(process.pid));assert.throws(()=>run('install',f.options),/已有补丁操作/);
});
test('abandoned legacy and JSON locks recover automatically',t=>{
 const f=fixture(t);fs.mkdirSync(f.store,{recursive:true});
 for(const record of ['2147483647',JSON.stringify({pid:2147483647,action:'status',started:'old'})]){
  fs.writeFileSync(p.join(f.store,'operation.lock'),record);run('status',f.options);
  assert.ok(!fs.existsSync(p.join(f.store,'operation.lock')));assert.ok(!fs.existsSync(p.join(f.store,'operation.recovery.lock')));
 }
});
test('malformed lock is not silently removed',t=>{
 const f=fixture(t);fs.mkdirSync(f.store,{recursive:true});fs.writeFileSync(p.join(f.store,'operation.lock'),'');
 assert.throws(()=>run('status',f.options),/锁信息不完整/);assert.ok(fs.existsSync(p.join(f.store,'operation.lock')));
});
test('path traversal rejected',()=>{assert.throws(()=>within(p.resolve('safe'),'../escape'),/无效/);});
