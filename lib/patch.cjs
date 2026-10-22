'use strict';
const fs=require('node:fs'),p=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {createTranslator}=require('./ui-patcher.cjs');
const HOME=p.resolve(__dirname,'..'),LOCALE='zh-Hans';
const read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const fileHash=f=>fs.existsSync(f)?hash(fs.readFileSync(f)):null;
function atomic(f,data){fs.mkdirSync(p.dirname(f),{recursive:true});const t=f+'.claudezh-tmp';try{fs.writeFileSync(t,data);fs.renameSync(t,f);}finally{if(fs.existsSync(t))fs.unlinkSync(t);}}
const json=(f,d)=>atomic(f,JSON.stringify(d,null,2)+'\n');
function acquireLock(store,action){
 const lock=p.join(store,'operation.lock'),recovery=p.join(store,'operation.recovery.lock');
 const owner=JSON.stringify({pid:process.pid,action,started:new Date().toISOString(),token:crypto.randomUUID()});
 const info=file=>{try{const raw=fs.readFileSync(file,'utf8');const value=JSON.parse(raw);return {raw,pid:typeof value==='number'?value:value.pid,action:value.action||'旧版操作',started:value.started||'未知'};}catch(e){if(e.code==='ENOENT')return null;return {pid:null};}};
 const alive=pid=>{if(!Number.isSafeInteger(pid)||pid<=0)return null;try{process.kill(pid,0);return true;}catch(e){return e.code==='ESRCH'?false:true;}};
 const busy=record=>Error('已有补丁操作运行（PID '+record.pid+'，'+record.action+'，开始于 '+record.started+'）。请等待该窗口完成，不要重复打开。');
 const create=()=>{const fd=fs.openSync(lock,'wx');try{fs.writeFileSync(fd,owner);}finally{fs.closeSync(fd);}};
 try{create();}catch(error){
  if(error.code!=='EEXIST')throw error;
  let current=info(lock);if(current&&alive(current.pid)!==false){if(alive(current.pid)===true)throw busy(current);throw Error('操作锁信息不完整。确认无补丁进程运行后再移除 '+lock+'，不会自动覆盖未知锁。');}
  let guard;try{guard=fs.openSync(recovery,'wx');}catch(e){if(e.code==='EEXIST')throw Error('另一窗口正在恢复操作锁，请稍后重试；若上次恰在恢复锁时被强制结束，请确认无补丁进程后移除 '+recovery);throw e;}
  try{
   fs.writeFileSync(guard,owner);current=info(lock);
   if(current){if(alive(current.pid)!==false)throw busy(current);fs.unlinkSync(lock);console.log('已自动清理退出进程遗留的操作锁（PID '+current.pid+'）。');}
   try{create();}catch(e){if(e.code==='EEXIST')throw busy(info(lock)||{});throw e;}
  }finally{fs.closeSync(guard);fs.unlinkSync(recovery);}
 }
 return ()=>{if(fs.existsSync(lock)&&fs.readFileSync(lock,'utf8')===owner)fs.unlinkSync(lock);};
}
function installedIntact(root,manifest){
 console.log('正在校验已安装资源，共 '+manifest.files.length+' 项……');let count=0;
 for(const entry of manifest.files){if(fileHash(within(root,entry.rel))!==entry.after)return false;if(++count%100===0)console.log('资源校验 '+count+'/'+manifest.files.length);}
 return true;
}
function within(root,rel){root=p.resolve(root);const dest=p.resolve(root,rel);if(!dest.startsWith(root+p.sep))throw Error('无效的备份路径');let cur=dest;while(cur.length>=root.length){if(fs.existsSync(cur)&&fs.lstatSync(cur).isSymbolicLink())throw Error('不支持链接路径：'+cur);if(cur===p.dirname(cur))break;cur=p.dirname(cur);}return dest;}
function detect(explicit){if(explicit)return p.resolve(explicit);const base=p.join(process.env.LOCALAPPDATA,'AnthropicClaude');if(!fs.existsSync(base))throw Error('未找到 Claude。可用 -Resources 指定安装目录中的 resources 文件夹。');const dirs=fs.readdirSync(base).filter(x=>/^app-\d+(\.\d+)+$/.test(x)).sort((a,b)=>{let x=a.slice(4).split('.').map(Number),y=b.slice(4).split('.').map(Number);for(let i=0;i<Math.max(x.length,y.length);i++){let d=(y[i]||0)-(x[i]||0);if(d)return d;}return 0;});const result=dirs.map(x=>p.join(base,x,'resources')).find(x=>fs.existsSync(p.join(x,'app.asar')));if(!result)throw Error('未找到可识别的 Claude 安装。');return result;}
function profiles(){return [p.join(process.env.LOCALAPPDATA,'Claude-3p','config.json'),p.join(process.env.APPDATA,'Claude','config.json')].filter(fs.existsSync);}
function mergeCatalog(en,dictionaries){const out={},missing=[];for(const [k,v]of Object.entries(en)){let translated;for(const dict of dictionaries)if(typeof dict[k]==='string')translated=dict[k];out[k]=translated??v;if(translated===undefined)missing.push({key:k,source:v});}return {out,missing};}
function walk(root){return fs.readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isSymbolicLink()?[]:e.isDirectory()?walk(p.join(root,e.name)):[p.join(root,e.name)]);}
function makePlan(root){
 const data=read(p.join(HOME,'lib','translations.json'));const changes=[];
 const add=(rel,text)=>{const dest=within(root,rel),bytes=Buffer.from(text);if(fileHash(dest)!==hash(bytes))changes.push({rel,bytes});};
 const desktopEn=read(p.join(root,'en-US.json'));const native=fs.existsSync(p.join(root,'zh-Hans.json'))?read(p.join(root,'zh-Hans.json')):{};
 const desktop=mergeCatalog(desktopEn,[data.desktop,native,data.desktopExtra]);
 add('zh-Hans.json',JSON.stringify(desktop.out,null,2)+'\n');
 const frontEn=read(p.join(root,'ion-dist','i18n','en-US.json'));
 const front=mergeCatalog(frontEn,[data.frontend]);
 // Keep supplemental IDs: some button/effort messages exist only in bundles,
 // and are absent from the English catalog (for example the Max effort label).
 add('ion-dist/i18n/zh-Hans.json',JSON.stringify({...data.frontend,...front.out})+'\n');
 add('ion-dist/i18n/zh-Hans.overrides.json','{}\n');
 for(const sub of ['dynamic','statsig'])add('ion-dist/i18n/'+sub+'/zh-Hans.json',JSON.stringify(data.statsig)+'\n');
 const whitelist=/\["en-US","de-DE","fr-FR","ko-KR","ja-JP"(?:,"[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?")+\]/g;
 const translate=createTranslator(data.ui,data.slashDescriptions);
 let anchors=0,uiCount=0,jsCount=0;
 const assets=p.join(root,'ion-dist','assets');if(!fs.existsSync(assets))throw Error('前端结构不受支持，未修改任何文件。');
 const js=walk(assets).filter(x=>x.endsWith('.js'));
 const scanStarted=Date.now();let scanned=0;for(const file of js){if(++scanned%100===0)console.log(`界面扫描 ${scanned}/${js.length}（已用 ${Math.round((Date.now()-scanStarted)/1000)} 秒）`);const original=fs.readFileSync(file,'utf8');let updated=original.replace(whitelist,m=>{anchors++;const list=JSON.parse(m);if(!list.includes(LOCALE))list.push(LOCALE);return JSON.stringify(list);});
 const translated=translate(updated);updated=translated.text;uiCount+=translated.count;
 // Provider display-name map: keep protocol keys and model identifiers unchanged.
 updated=updated.replaceAll('gateway:"Gateway",anthropic:"Claude API"','gateway:"网关",anthropic:"Claude API"');
 if(updated!==original){add(p.relative(root,file),updated);jsCount++;}}
 if(!anchors)throw Error('新版语言列表结构无法识别，已安全停止，未修改任何文件。');
 return {changes,report:{desktopTotal:Object.keys(desktopEn).length,desktopMissing:desktop.missing,frontendTotal:Object.keys(frontEn).length,frontendMissing:front.missing,languageAnchors:anchors,uiReplacements:uiCount,jsFiles:jsCount}};
}
function ensureStopped(root){const script="$d='"+p.dirname(root).replace(/'/g,"''")+"'; $n=@(Get-Process claude -ErrorAction SilentlyContinue | Where-Object {$_.Path -and [IO.Path]::GetDirectoryName($_.Path) -eq $d}).Count; Write-Output $n";const result=cp.spawnSync('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true});if(result.status!==0||!/^0\s*$/.test(result.stdout))throw Error('请先从 Claude 菜单选择“退出”，再运行补丁。不会强制结束会话。');}
function identity(root){return hash(p.resolve(root).toLowerCase()+'\n'+fileHash(p.join(root,'app.asar')));}
function patchIdentity(){return hash([__filename,p.join(HOME,'lib','translations.json'),p.join(HOME,'lib','ui-patcher.cjs'),p.join(HOME,'lib','acorn.cjs')].map(fileHash).join('\n'));}
function restoreFiles(root,folder,manifest){console.log('正在核对原件备份与当前文件……');const pending=[];let count=0;for(const e of manifest.files){const dest=within(root,e.rel),current=fileHash(dest);if(current!==e.after&&current!==e.before)throw Error('文件已被其他程序修改，停止还原以保护修改：'+e.rel);if(e.before!==null&&fileHash(within(folder,e.backup))!==e.before)throw Error('备份校验失败：'+e.rel);if(current!==e.before)pending.push(e);if(++count%100===0)console.log('还原前校验 '+count+'/'+manifest.files.length);}
 console.log('正在还原原始资源，共 '+pending.length+' 项（已是原件的文件无需重写）……');count=0;for(const e of pending.reverse()){const dest=within(root,e.rel);if(e.before===null){if(fs.existsSync(dest))fs.unlinkSync(dest);}else atomic(dest,fs.readFileSync(within(folder,e.backup)));if(++count%100===0)console.log('已还原 '+count+'/'+pending.length);}
 for(const entry of manifest.locales){if(!fs.existsSync(entry.path))continue;const c=read(entry.path);if(c.locale!==LOCALE)continue;if(entry.had)c.locale=entry.value;else delete c.locale;json(entry.path,c);}
 manifest.status='restored';json(p.join(folder,'manifest.json'),manifest);
}
function installWithoutBackup(root,folder,previous,options){
 const manifestPath=p.join(folder,'manifest.json');
 if(previous?.backupMode!=='none'&&previous&&previous.status!=='restored')throw Error('此版本已有可还原备份。请先还原，再选择不备份安装；不会自动删除已有备份。');
 if(previous?.backupMode==='none'){
  if(previous.status==='installed'&&previous.patchHash===patchIdentity()&&installedIntact(root,previous)){
   for(const file of options.configs||profiles()){const c=read(file);c.locale=LOCALE;json(file,c);}
   console.log('不备份模式已安装，校验通过，中文设置已重新应用。');return;
  }
  throw Error('此构建曾使用不备份模式，不能安全叠加新版补丁或修复中断。请先用官方安装器修复/重装同版本，移走此构建的状态目录后再安装，或更新 Claude 后重试。');
 }
 console.log('不备份模式：不保存原始资源或原语言，无法一键还原。正在准备……');
 const packageHash=patchIdentity(),plan=makePlan(root);
 if(packageHash!==patchIdentity())throw Error('扫描期间补丁发生变化，请重试。');
 const snapshots=plan.changes.map(e=>({rel:e.rel,bytes:fs.existsSync(within(root,e.rel))?fs.readFileSync(within(root,e.rel)):null}));
 const configs=(options.configs||profiles()).map(file=>{const c=read(file);return {path:file,had:Object.hasOwn(c,'locale'),value:c.locale};});
 const manifest={schema:3,root,identity:identity(root),version:p.basename(p.dirname(root)),patchHash:packageHash,backupMode:'none',status:'prepared',files:plan.changes.map(e=>({rel:e.rel,after:hash(e.bytes)})),locales:[]};
 json(manifestPath,manifest);json(p.join(folder,'coverage.json'),plan.report);
 try{
  console.log('正在写入汉化资源，共 '+plan.changes.length+' 项……');let written=0;
  for(const change of plan.changes){atomic(within(root,change.rel),change.bytes);if(++written%100===0)console.log('已写入 '+written+'/'+plan.changes.length);}
  for(const entry of configs){const c=read(entry.path);c.locale=LOCALE;json(entry.path,c);}
  if(!installedIntact(root,manifest))throw Error('写入后资源校验失败');
  manifest.status='installed';json(manifestPath,manifest);
 }catch(error){
  // In-memory rollback handles ordinary exceptions only, never power loss/process termination.
  for(const entry of snapshots){const dest=within(root,entry.rel);if(entry.bytes===null){if(fs.existsSync(dest))fs.unlinkSync(dest);}else atomic(dest,entry.bytes);}
  for(const entry of configs){const c=read(entry.path);if(entry.had)c.locale=entry.value;else delete c.locale;json(entry.path,c);}
  if(previous)json(manifestPath,previous);else fs.unlinkSync(manifestPath);
  throw error;
 }
 console.log('不备份安装完成。仅保存校验清单，不含原始资源及原语言。请重新打开 Claude。');
 console.log('状态目录：'+folder);
}
function run(action,options={}){
 const started=Date.now();
 if(!['install','install-no-backup','restore','status'].includes(action))throw Error('未知操作');
 console.log('正在检测 Claude 安装位置……');
 const root=detect(options.resources);for(const f of ['app.asar','en-US.json','ion-dist/i18n/en-US.json'])if(!fs.existsSync(p.join(root,f)))throw Error('安装结构缺少 '+f);
 const store=p.resolve(options.store||p.join(HOME,'.state'));
 const legacy=p.join(process.env.LOCALAPPDATA||'', 'ClaudeZhPatch');
 if(!options.store&&fs.existsSync(legacy)&&fs.readdirSync(legacy).some(n=>fs.existsSync(p.join(legacy,n,'manifest.json'))))throw Error('检测到旧版 C 盘备份。请先将旧 ClaudeZhPatch 目录内的构建子目录移动到本补丁 .state 文件夹（不要覆盖同名目录），以保留还原能力。');
 fs.mkdirSync(store,{recursive:true});
 const releaseLock=acquireLock(store,action);
 try{
 console.log('正在识别客户端构建，请勿关闭窗口……');
 const id=identity(root),folder=p.join(store,id),manifestPath=p.join(folder,'manifest.json');let previous=fs.existsSync(manifestPath)?read(manifestPath):null;
 if(previous&&previous.root!==root)throw Error('备份与安装路径不匹配。');
 if(action==='status'){const intact=previous?.status==='installed'&&installedIntact(root,previous);console.log(JSON.stringify({version:p.basename(p.dirname(root)),resources:root,status:previous?.status||'not-installed',filesIntact:!!intact,backupMode:previous?(previous.backupMode||'full'):null,canRestore:!!previous&&previous.backupMode!=='none'&&previous.status!=='restored',state:folder},null,2));console.log('状态检查完成。');return;}
 ensureStopped(root);
 if(action==='install-no-backup'){installWithoutBackup(root,folder,previous,options);return;}
 if(previous?.backupMode==='none')throw Error('此构建使用了不备份模式，无法还原或切换为可还原模式。请先修复/重装官方原版并移走该构建状态目录，或更新 Claude。');
 if(action==='restore'){if(!previous||previous.status==='restored'){console.log('当前版本没有需要还原的补丁。旧版备份不会覆盖新版。');return;}restoreFiles(root,folder,previous);console.log('已还原当前版本的原始资源及原语言设置。');return;}
 if(action!=='install')throw Error('未知操作');
 if(previous&&previous.status!=='restored'){
  if(previous.status==='installed'&&previous.patchHash===patchIdentity()&&installedIntact(root,previous)){for(const entry of previous.locales){if(fs.existsSync(entry.path)){const c=read(entry.path);c.locale=LOCALE;json(entry.path,c);}}console.log('此版本汉化已安装，资源校验通过，中文设置已重新应用。');return;}
  restoreFiles(root,folder,previous);
 }
 console.log('正在扫描语言资源并准备补丁，请稍候……');
 const packageHash=patchIdentity();const plan=makePlan(root);if(packageHash!==patchIdentity())throw Error('扫描期间补丁程序或词库发生变化，请重新运行。');
 const baselinePath=p.join(folder,'baseline.json');const baseline=fs.existsSync(baselinePath)?read(baselinePath):{schema:2,root,identity:id,files:[],locales:previous?.locales||[]};
 if(baseline.root!==root||baseline.identity!==id)throw Error('原始备份与当前构建不匹配。');
 const manifest={schema:2,root,identity:id,version:p.basename(p.dirname(root)),patchHash:packageHash,status:'prepared',files:baseline.files.map(e=>({...e,after:e.before})),locales:[]};
 fs.mkdirSync(folder,{recursive:true});
 console.log('正在核对和保存原件备份……');let prepared=0;
 for(const change of plan.changes){const dest=within(root,change.rel);let entry=baseline.files.find(e=>e.rel===change.rel);
  if(!entry){const before=fileHash(dest),backup=before===null?null:'original/'+before;entry={rel:change.rel,before,backup};if(before!==null){const stored=within(folder,backup);if(fs.existsSync(stored)){if(fileHash(stored)!==before)throw Error('原始备份损坏：'+change.rel);}else atomic(stored,fs.readFileSync(dest));}baseline.files.push(entry);}
  else if(fileHash(dest)!==entry.before)throw Error('资源未回到原始基线：'+change.rel);
  const record={...entry,after:hash(change.bytes)},i=manifest.files.findIndex(e=>e.rel===change.rel);if(i<0)manifest.files.push(record);else manifest.files[i]=record;
  if(++prepared%100===0)console.log('备份准备 '+prepared+'/'+plan.changes.length);
 }
 const configs=options.configs||profiles();
 const older=fs.readdirSync(store,{withFileTypes:true}).filter(e=>e.isDirectory()&&e.name!==id).map(e=>p.join(store,e.name,'manifest.json')).filter(fs.existsSync).map(read).filter(m=>m.status==='installed'&&m.backupMode!=='none');
 for(const file of configs){const c=read(file);const inherited=baseline.locales.find(e=>e.path===file)||(c.locale===LOCALE?older.flatMap(m=>m.locales).find(e=>e.path===file&&e.value!==LOCALE):null);const record=inherited||{path:file,had:Object.hasOwn(c,'locale'),value:c.locale};manifest.locales.push(record);if(!baseline.locales.some(e=>e.path===file))baseline.locales.push(record);}
 json(baselinePath,baseline);json(manifestPath,manifest);json(p.join(folder,'coverage.json'),plan.report);
 try{console.log('正在写入汉化资源……');let written=0;for(const change of plan.changes){atomic(within(root,change.rel),change.bytes);if(++written%100===0)console.log('已写入 '+written+'/'+plan.changes.length);}for(const entry of manifest.locales){const c=read(entry.path);c.locale=LOCALE;json(entry.path,c);}if(!installedIntact(root,manifest))throw Error('写入后资源校验失败');manifest.status='installed';json(manifestPath,manifest);}catch(error){restoreFiles(root,folder,manifest);throw error;}
 console.log(`汉化安装完成。桌面文案 ${plan.report.desktopTotal-plan.report.desktopMissing.length}/${plan.report.desktopTotal}；前端词条 ${plan.report.frontendTotal-plan.report.frontendMissing.length}/${plan.report.frontendTotal}；界面直写文案 ${plan.report.uiReplacements} 处。`);
 console.log('备份和覆盖报告：'+folder);console.log('请重新打开 Claude。更新后再次双击安装即可；无法识别的新结构会安全停止。');
 }finally{releaseLock();console.log('本次操作用时 '+((Date.now()-started)/1000).toFixed(1)+' 秒。');}
}
module.exports={run,makePlan,mergeCatalog,within};
if(require.main===module){try{const [action,resources,store]=process.argv.slice(2);run(action||'status',{resources,store});}catch(e){console.error('操作未完成：'+e.message);process.exitCode=1;}}
