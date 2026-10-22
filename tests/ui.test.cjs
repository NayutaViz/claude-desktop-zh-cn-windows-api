const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {createTranslator}=require('../lib/ui-patcher.cjs');
test('display branches translate without touching identifiers and ordinary strings',()=>{
 const translate=createTranslator({Settings:'设置',Open:'打开',Close:'关闭'});
 const input='const id="Settings"; const x=jsx("div",{type:"Open",title:ok?"Open":"Close",children:["Settings"]});';
 const output=translate(input).text;
 assert.match(output,/const id="Settings"/);assert.match(output,/type:"Open"/);assert.match(output,/"打开":"关闭"/);assert.match(output,/"设置"/);
});
test('HTML schemas, tool descriptions and protocol labels stay unchanged',()=>{
 const translate=createTranslator({script:'脚本',string:'字符串',connect:'连接',added:'已添加',Open:'打开'});
 const input='const schema={ul:{children:["li","script","template"]},item:{type:"string",description:"Open"}}; const step={label:"connect",startsCreate:true};const row={label:"added",adoptable:false};';
 assert.equal(translate(input).text,input);
 assert.match(translate('jsx("button",{children:"Open"})').text,/打开/);
});
test('built-in output style labels translate; custom names and persisted values stay intact',()=>{
 const translate=createTranslator({});
 const code='const query="ccd-global-output-styles";const u={builtIns:["Concise","Explanatory","Learning","Proactive"],customs:["My style","toString","__proto__"]};const t=[];for(let e of [...u?.builtIns??[],...u?.customs??[]]){t.push({value:e,label:e})}t';
 const translated=translate(code).text,result=vm.runInNewContext(translated);
 assert.equal(result.map(x=>x.label).join('|'),'简洁|解释型|学习型|主动型|My style|toString|__proto__');
 assert.equal(result.map(x=>x.value).join('|'),'Concise|Explanatory|Learning|Proactive|My style|toString|__proto__');
 assert.equal(translate(translated).text,translated);
 const customOnly=code.replace('builtIns:["Concise","Explanatory","Learning","Proactive"]','builtIns:[]').replace('customs:["My style","toString","__proto__"]','customs:["Concise"]');
 assert.equal(vm.runInNewContext(translate(customOnly).text)[0].label,'Concise');
});
test('session style formatter and read-only details translate without changing state',()=>{
 const translate=createTranslator({});
 const code='const availableOutputStyles=[];function f(e,t,n){if(e!=="default")return e;let r=t.formatMessage({defaultMessage:"Default",id:"7Aqe2/LqFL"});return n.some(t=>t!==e&&t.toLowerCase()===r.toLowerCase())?e:r}const o={outputStyle:"Learning"};const row={id:"outputStyle",label:"style",value:o.outputStyle};({builtin:f("Explanatory"),custom:f("My style"),row,state:o.outputStyle})';
 const result=vm.runInNewContext(translate(code).text);
 assert.equal(result.builtin,'解释型');assert.equal(result.custom,'My style');assert.equal(result.row.value,'学习型');assert.equal(result.state,'Learning');
});
test('translated template preserves evaluation order and coercion',()=>{
 const translate=createTranslator({'First {a}, then {b}':'后 {b}，前 {a}'});
 const code='const values=[];const f=x=>(values.push(x),x);const o={title:`First ${f(1)}, then ${f(2)}`};({values,title:o.title})';
 const result=vm.runInNewContext(translate(code).text);
 assert.equal(result.values.join(','),'1,2');assert.equal(result.title,'后 2，前 1');
});
test('supplemental effort translations are retained and Max brand is not translated',()=>{
 const data=require('../lib/translations.json');assert.equal(data.frontend.Zk4EtKw26K,'最高');assert.equal(data.frontend.HoZQmASaw3,'超高');assert.equal(data.ui.Max,'Max');
});
