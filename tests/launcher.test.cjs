'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),p=require('node:path'),os=require('node:os'),cp=require('node:child_process');
test('Windows PowerShell menu option 2 installs against an isolated profile',{skip:process.platform!=='win32'},()=>{
 const base=fs.mkdtempSync(p.join(os.tmpdir(),'claude-zh-launch-test-'));
 try{
  const resources=p.join(base,'含 空格','app-1.0','resources'),store=p.join(base,'state'),local=p.join(base,'local'),roaming=p.join(base,'roaming');
  const put=(file,text)=>{fs.mkdirSync(p.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
  put(p.join(resources,'app.asar'),'fixture');put(p.join(resources,'en-US.json'),'{}');put(p.join(resources,'ion-dist/i18n/en-US.json'),'{}');
  put(p.join(resources,'ion-dist/assets/test.js'),'const locales=["en-US","de-DE","fr-FR","ko-KR","ja-JP","es-ES"];');
  const config=p.join(local,'Claude-3p/config.json');put(config,'{"locale":"en-US","model":"unchanged"}');
  const launcher=p.resolve(__dirname,'../lib/launch.ps1');
  const run=(action,input)=>cp.spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',launcher,'-Action',action,'-Resources',resources,'-Store',store],{env:{...process.env,LOCALAPPDATA:local,APPDATA:roaming},encoding:'utf8',input,windowsHide:true});
  const installed=run('menu','2\n');assert.equal(installed.status,0,installed.stdout+installed.stderr);
  const dirs=fs.readdirSync(store);assert.equal(dirs.length,1);const manifest=JSON.parse(fs.readFileSync(p.join(store,dirs[0],'manifest.json')));
  assert.equal(manifest.backupMode,'none');assert.equal(manifest.status,'installed');
  assert.deepEqual(JSON.parse(fs.readFileSync(config)),{locale:'zh-Hans',model:'unchanged'});
  assert.equal(run('status').status,0);assert.equal(run('restore').status,1);assert.equal(run('menu','0\n').status,0);
 }finally{assert.ok(base.startsWith(p.join(os.tmpdir(),'claude-zh-launch-test-')));fs.rmSync(base,{recursive:true,force:true});}
});
test('all three shipped CMD entrypoints run with paths containing spaces',{skip:process.platform!=='win32'},()=>{
 const base=fs.mkdtempSync(p.join(os.tmpdir(),'claude-zh-cmd-test-'));
 try{
  const bundle=p.join(base,'补丁 测试'),local=p.join(base,'local'),resources=p.join(local,'AnthropicClaude/app-1.0/resources');
  const put=(file,text)=>{fs.mkdirSync(p.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
  const files=require('../scripts/release-files.json');for(const file of files){const dest=p.join(bundle,file);fs.mkdirSync(p.dirname(dest),{recursive:true});fs.copyFileSync(p.resolve(__dirname,'..',file),dest);}
  put(p.join(resources,'app.asar'),'fixture');put(p.join(resources,'en-US.json'),'{}');put(p.join(resources,'ion-dist/i18n/en-US.json'),'{}');
  const js=p.join(resources,'ion-dist/assets/test.js'),original='const locales=["en-US","de-DE","fr-FR","ko-KR","ja-JP","es-ES"];';put(js,original);
  put(p.join(local,'Claude-3p/config.json'),'{"locale":"en-US"}');
  const invoke=(name,input='\r\n')=>{const r=cp.spawnSync('cmd.exe',['/d','/s','/c','""'+p.join(bundle,name)+'""'],{cwd:bundle,env:{...process.env,LOCALAPPDATA:local,APPDATA:p.join(base,'roaming')},encoding:'utf8',input,windowsHide:true,windowsVerbatimArguments:true});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
  assert.match(invoke('检查状态.cmd'),/not-installed/);
  assert.match(invoke('安装汉化.cmd','1\r\n\r\n'),/汉化安装完成/);
  assert.match(invoke('检查状态.cmd'),/"filesIntact": true/);
  assert.match(invoke('还原汉化.cmd'),/已还原/);assert.equal(fs.readFileSync(js,'utf8'),original);
  assert.ok(!fs.existsSync(p.join(bundle,'.state/operation.lock')));
 }finally{assert.ok(base.startsWith(p.join(os.tmpdir(),'claude-zh-cmd-test-')));fs.rmSync(base,{recursive:true,force:true});}
});
