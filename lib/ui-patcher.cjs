'use strict';
const acorn=require('./acorn.cjs');
const UI_KEYS=new Set(['defaultMessage','label','placeholder','title','description','children','tooltip','emptyMessage','loadingText','aria-label','aria-description','alt','buttonText','confirmText','cancelText']);
function createTranslator(dictionary,slashDescriptions={}){
 const styleLabels={Concise:'简洁',Explanatory:'解释型',Learning:'学习型',Proactive:'主动型'};
 const styleLabel=expression=>'((s,m)=>Object.prototype.hasOwnProperty.call(m,s)?m[s]:s)('+expression+','+JSON.stringify(styleLabels)+')';
 const templateMap=new Map();
 for(const [source,target]of Object.entries(dictionary)){
  if(!source.includes('{')||/\{[^}]*,/.test(source))continue;
  const names=[];const pattern=source.replace(/\{([\w]+)\}/g,(_,name)=>{names.push(name);return '{#'+(names.length-1)+'}';});
  if(names.length&&names.length===new Set(names).size)templateMap.set(pattern,{target,names});
 }
 return function translate(source,unknown){
  if(!/defaultMessage|label|placeholder|title|description|children|tooltip|aria-label|buttonText/.test(source))return {text:source,count:0};
  const isSlashMenu=source.includes('CCDSlashCommandMenu');
  const ast=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module',allowHashBang:true});const edits=new Map(),parents=new WeakMap();
  function add(node,value){if(value!==source.slice(node.start,node.end))edits.set(node.start,{start:node.start,end:node.end,value});}
  const property=(node,key)=>node.properties?.find(p=>p.type==='Property'&&!p.computed&&(p.key.name??p.key.value)===key);
  function isDisplayProperty(node,key){
   if(key==='defaultMessage')return true;
   const object=parents.get(node),owner=parents.get(object);
   if(object?.type!=='ObjectExpression')return false;
   if(key==='label'&&property(object,'skillId')&&property(object,'skillDescription'))return false;
   // Message translator notes and JSON-schema/tool descriptions are not UI text.
   if(property(object,'defaultMessage')&&key==='description')return false;
   if(['string','number','integer','boolean','array','object','null'].includes(property(object,'type')?.value.value))return false;
   if(property(object,'adoptable')||property(object,'startsCreate'))return false;
   // React props live in a call's second argument. Schema children arrays do not.
   if(key==='children')return owner?.type==='CallExpression'&&owner.arguments[1]===object;
   return true;
  }
  function descendants(node,visit){const todo=[node];while(todo.length){const n=todo.pop();visit(n);for(const v of Object.values(n)){if(Array.isArray(v)){for(const c of v)if(c?.type)todo.push(c);}else if(v?.type)todo.push(v);}}}
  function dynamicDisplay(node){
   // Translate only a slash-menu row's displayed description, never the IPC
   // command object, name, aliases, argument hints or submitted prompt.
   if(isSlashMenu&&node.type==='ObjectExpression'&&property(node,'type')?.value.value==='skill'&&property(node,'skillId')&&property(node,'label')){
    const value=property(node,'skillDescription')?.value;
    if(value?.type==='LogicalExpression'&&value.operator==='??'&&value.left.type==='MemberExpression'&&value.left.property.name==='description'&&value.right.value===''){
     const expression=source.slice(value.start,value.end);
     add(value,'((s,m)=>typeof s==="string"&&Object.prototype.hasOwnProperty.call(m,s.trim())?m[s.trim()]:s)('+expression+','+JSON.stringify(slashDescriptions)+')');
    }
   }
   // Settings combines builtIns and customs. Only translate a built-in's label,
   // never its value, stored setting, custom name, or the data supplied by IPC.
   if(node.type==='ForOfStatement'&&source.includes('ccd-global-output-styles')){
    const right=source.slice(node.right.start,node.right.end),match=right.match(/([\w$]+)\?\.builtIns/);
    const item=node.left.declarations?.[0]?.id;
    if(match&&right.includes('.customs')&&item?.type==='Identifier')descendants(node.body,n=>{
     if(n.type!=='ObjectExpression')return;const label=property(n,'label'),value=property(n,'value');
     if(label?.value.type==='Identifier'&&value?.value.type==='Identifier'&&label.value.name===item.name&&value.value.name===item.name)
      add(label.value,match[1]+'?.builtIns?.includes('+item.name+')?'+styleLabel(item.name)+':'+item.name);
    });
   }
   // Session menus and the slash-command picker share the default-style formatter.
   if(node.type==='FunctionDeclaration'&&node.params[0]?.type==='Identifier'&&source.includes('availableOutputStyles')){
    const first=node.body.body[0],name=node.params[0].name,body=source.slice(node.start,node.end);
    if(first?.type==='IfStatement'&&first.test.type==='BinaryExpression'&&first.test.operator==='!=='&&first.test.left.name===name&&first.test.right.value==='default'&&first.consequent.type==='ReturnStatement'&&first.consequent.argument?.name===name&&body.includes('7Aqe2/LqFL'))
     add(first.consequent.argument,styleLabel(name));
   }
   // Read-only session information row. Protocol/state objects are not matched.
   if(node.type==='ObjectExpression'&&property(node,'id')?.value.value==='outputStyle'&&property(node,'label')){
    const value=property(node,'value')?.value;
    if(value?.type==='MemberExpression'&&!value.computed&&value.property.name==='outputStyle')add(value,styleLabel(source.slice(value.start,value.end)));
   }
  }
  function visible(node,key){if(!node)return;
   if(node.type==='Literal'&&typeof node.value==='string'){
    const target=Object.hasOwn(dictionary,node.value)?dictionary[node.value]:undefined;if(target&&target!==node.value)add(node,JSON.stringify(target));
    else if(unknown&&/[A-Za-z]{2,}/.test(node.value)&&node.value.length<700)unknown(node.value,key,source.slice(Math.max(0,node.start-65),node.end+40));
   }else if(node.type==='ConditionalExpression'){visible(node.consequent,key);visible(node.alternate,key);}
   else if(node.type==='LogicalExpression')visible(node.right,key);
   else if(node.type==='ArrayExpression')for(const n of node.elements)visible(n,key);
   else if(node.type==='TemplateLiteral'){
    const pattern=node.quasis.map((q,i)=>(q.value.cooked??q.value.raw)+(i<node.expressions.length?'{#'+i+'}':'')).join('');
    if(!node.expressions.length){const target=Object.hasOwn(dictionary,pattern)?dictionary[pattern]:undefined;if(target&&target!==pattern)add(node,JSON.stringify(target));return;}
    const rule=templateMap.get(pattern);if(rule){const escape=s=>s.replace(/\\/g,'\\\\').replace(/`/g,'\\`').replace(/\$\{/g,'\\${');let result='',at=0;for(const m of rule.target.matchAll(/\{([\w]+)\}/g)){result+=escape(rule.target.slice(at,m.index));const i=rule.names.indexOf(m[1]);if(i<0)return;result+='${__zh'+i+'}';at=m.index+m[0].length;}result+=escape(rule.target.slice(at));const params=node.expressions.map((_,i)=>'__zh'+i).join(',');const args=node.expressions.map(n=>'`${'+source.slice(n.start,n.end)+'}`').join(',');add(node,'(('+params+')=>`'+result+'`)('+args+')');}
    else if(unknown&&/[A-Za-z]{2,}/.test(pattern))unknown(pattern,key,source.slice(Math.max(0,node.start-50),node.end+30));
   }
  }
  const queue=[ast];while(queue.length){const node=queue.pop();dynamicDisplay(node);if(node.type==='Property'&&!node.computed){const key=node.key.name??node.key.value;if(UI_KEYS.has(key)&&isDisplayProperty(node,key))visible(node.value,key);}
   for(const [key,value]of Object.entries(node)){if(key==='start'||key==='end')continue;if(value&&typeof value==='object'){if(Array.isArray(value)){for(const n of value)if(n?.type){parents.set(n,node);queue.push(n);}}else if(value.type){parents.set(value,node);queue.push(value);}}}
  }
  const sorted=[...edits.values()].sort((a,b)=>a.start-b.start);const nonoverlap=[];for(const edit of sorted){const last=nonoverlap.at(-1);if(last&&edit.start<last.end)continue;nonoverlap.push(edit);}let text=source;for(const e of nonoverlap.reverse())text=text.slice(0,e.start)+e.value+text.slice(e.end);return {text,count:nonoverlap.length};
 };
}
module.exports={createTranslator};
