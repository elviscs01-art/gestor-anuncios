import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {makeDraft,applyForm,preparePayload,pictureUrl} from './drafts.mjs';
import {createMeli} from './meli.mjs';
import {createApp} from './server.mjs';
import {SetupSessions} from './store.mjs';
import {vault,hash,random,UserError} from './security.mjs';
import {editor} from './draft-views.mjs';
const schema=[{id:'BRAND',name:'Marca',tags:{required:true}},{id:'MODEL',name:'Modelo',tags:{}},{id:'LOCKED',tags:{read_only:true}},{id:'INFERRED',tags:{inferred:true}}];
const category={id:'MLB190954',name:'Evaporadores',settings:{max_title_length:60}};
const source={profile:{id:123,tags:['user_product_seller']},item:{id:'MLB4155100949',seller_id:123,category_id:category.id,title:'Old title',family_name:'Evaporador Densul',user_product_id:'MLBU1234',catalog_product_id:'MLB999',official_store_id:8,price:329,available_quantity:11,condition:'new',listing_type_id:'gold_pro',pictures:[{id:'photo-1',secure_url:'https://http2.mlstatic.com/a.jpg'}],attributes:[{id:'BRAND',value_id:'123',value_name:'DENSUL'},{id:'MODEL',value_name:'A'},{id:'LOCKED',value_name:'NO'},{id:'INFERRED',value_name:'NO'}],shipping:{mode:'me2',free_shipping:true,logistic_type:'fulfillment'},sale_terms:[{id:'WARRANTY_TIME',value_name:'3 meses'}]},description:{data:{plain_text:'Texto original'}},compatibility:{data:{products:[{id:'compat-1'}]}}};
const draft=()=>makeDraft(structuredClone(source),category,schema);
function formFor(d){const v=d.values;const f=new URLSearchParams({...v,quantity:'2'});f.delete('attributes');f.delete('pictureIds');for(const [k,v] of Object.entries(d.values.attributes))f.set('attr:'+k,v);for(const id of v.pictureIds)f.append('picture',id);return f;}
test('import keeps editable values but strips source identity and asks for new quantity',()=>{
 const d=draft();assert.equal(d.mode,'family');assert.equal(d.values.quantity,'');assert.equal(d.values.description,'Texto original');assert.equal(d.schema.length,2);
 const updated=applyForm(d,formFor(d));const {payload,issues}=preparePayload(updated);assert.deepEqual(issues,[]);
 assert.equal(payload.family_name,'Evaporador Densul');assert.equal(payload.available_quantity,2);assert.equal(payload.price,329);assert.equal(payload.official_store_id,8);
 for(const key of ['id','seller_id','user_product_id','catalog_product_id','status','title','description','variations','compatibilities'])assert.equal(payload[key],undefined);
 assert.equal(payload.shipping.logistic_type,undefined);assert.deepEqual(payload.attributes,[{id:'BRAND',value_name:'DENSUL'},{id:'MODEL',value_name:'A'}]);
});
test('changes clear previous validation, decimal comma works and fields cannot inject metadata',()=>{
 const d=draft();d.validation={ok:true};const f=formFor(d);f.set('price','419,90');f.set('sellerId','999');f.set('categoryId','INVALID');f.set('attr:BRAND','Outra');
 const next=applyForm(d,f);assert.equal(next.validation,null);assert.equal(next.sellerId,'123');assert.equal(next.categoryId,category.id);assert.equal(preparePayload(next).payload.price,419.9);assert.deepEqual(preparePayload(next).payload.attributes[0],{id:'BRAND',value_name:'Outra'});
 f.set('picture','unknown');assert.throws(()=>applyForm(d,f),/Foto inválida/);
});
test('incomplete drafts persist but local validation rejects required fields and invalid numbers',()=>{
 const d=draft(),f=formFor(d);f.set('quantity','1.5');f.set('price','1.000,00');f.set('attr:BRAND','');f.delete('picture');
 const next=applyForm(d,f);assert.ok(preparePayload(next).issues.length>=4);
 for(const qty of ['0','-1','NaN','9007199254740992']){next.values.quantity=qty;assert.ok(preparePayload(next).issues.some(x=>x.includes('quantidade')));}
});
test('traditional source uses title and variation import is explicit',()=>{
 const s=structuredClone(source);s.profile.tags=[];s.item.family_name=null;const d=makeDraft(s,category,schema);assert.equal(d.mode,'title');assert.equal(preparePayload(applyForm(d,formFor(d))).payload.title,'Old title');
 s.item.variations=[{id:1}];assert.throws(()=>makeDraft(s,category,schema),/sem variações/);
 assert.equal(pictureUrl('https://evil.test/a.jpg'),'');assert.equal(pictureUrl('http://http2.mlstatic.com/a.jpg'),'');
});
function apiFixture(validate){
 const crypto=vault('test-encryption-key-at-least-thirty-two-characters');let row={user_id:'123',encrypted:crypto.seal({access:'test-token',refresh:'test-refresh'}),expires:Date.now()+3600000,status:'ready'};
 const calls=[];const service=createMeli({store:{withConnection:async fn=>fn({get:async()=>row,save:async r=>{row=r;}})},crypto,clientId:'test',clientSecret:'secret',baseUrl:'https://app.example',fetcher:async(url,options)=>{
  calls.push({url,options});if(url.endsWith('/items/validate'))return validate(options);
  if(url.endsWith('/users/me'))return Response.json(source.profile);
  if(url.endsWith('/attributes'))return Response.json(schema);
  if(url.includes('/categories/'))return Response.json(category);
  throw new Error('Unexpected route '+url);
 }});return {service,calls};
}
test('remote validation posts only to validator and handles HTTP 204 with no body',async()=>{
 const f=apiFixture(options=>{const p=JSON.parse(options.body);assert.equal(p.family_name,'Evaporador Densul');assert.equal(p.description,undefined);assert.equal(options.headers.Authorization,'Bearer test-token');return new Response(null,{status:204});});
 const result=await f.service.validateDraft(applyForm(draft(),formFor(draft())));assert.equal(result.ok,true);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);assert.ok(f.calls.every(c=>c.options.method==='GET'||c.url.endsWith('/items/validate')));
});
test('remote validator returns actionable causes; permission failure is not success',async()=>{
 const d=applyForm(draft(),formFor(draft()));const f=apiFixture(()=>Response.json({cause:[{code:'item.attributes.missing',message:'Missing GTIN'}]},{status:400}));
 const result=await f.service.validateDraft(d);assert.equal(result.ok,false);assert.match(result.issues[0],/Missing GTIN/);
 const denied=apiFixture(()=>Response.json({secret:'private'},{status:403}));await assert.rejects(denied.service.validateDraft(d),/permissão/);
});
test('local failures and foreign ownership never send validation POST',async()=>{
 const f=apiFixture(()=>{throw new Error('must not post');});assert.equal((await f.service.validateDraft(draft())).stage,'local');
 const other=draft();other.sellerId='456';await assert.rejects(f.service.validateDraft(other),/outra conta/);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,0);
});
test('editor escapes source and remote messages, with scope of validation explicit',()=>{
 const d=draft();d.values.name='<script>alert(1)</script>';d.validation={ok:false,stage:'remote',checkedAt:new Date().toISOString(),issues:['<img src=x onerror=alert(1)>']};
 const html=editor({id:random(),revision:1,data:d},{csrf:'csrf'});assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<img src=x'));assert.match(html,/não fazem parte desta validação/);
});
function serverFixture(){
 class Store extends SetupSessions{
  constructor(){super();this.drafts=new Map();}
  async summary(){return {user_id:'123',status:'ready'};}
  async createDraft(id,seller,data){this.drafts.set(id,{id,seller,revision:1,data:structuredClone(data)});}
  async getDraft(id,seller){const r=this.drafts.get(id);return r?.seller===seller?structuredClone(r):null;}
  async listDrafts(seller){return [...this.drafts.values()].filter(r=>r.seller===seller).map(r=>({...r,name:r.data.values.name,source_id:r.data.sourceId}));}
  async updateDraft(id,seller,revision,data){const r=await this.getDraft(id,seller);if(!r||r.revision!==revision)return null;const next={...r,data:structuredClone(data),revision:revision+1};this.drafts.set(id,next);return structuredClone(next);}
  async setDraftValidation(id,seller,revision,validation){const r=await this.getDraft(id,seller);if(!r||r.revision!==revision)return null;r.data.validation=validation;this.drafts.set(id,r);return structuredClone(r);}
 }
 const store=new Store(),password='test-password-at-least-twenty-characters';let checks=0;
 const meli={draftSource:async()=>draft(),validateDraft:async()=>{checks++;return {ok:true,stage:'remote',issues:[],checkedAt:new Date().toISOString()};}};
 const {handler}=createApp({settings:{password,baseUrl:'https://app.example',production:true,databaseUrl:'configured',key:'test-key-at-least-thirty-two-characters',clientId:'1',clientSecret:'test'},store,meli});
 const request=async(path,method='GET',form=new URLSearchParams(),headers={})=>{
  const req=Readable.from([Buffer.from(form.toString())]);Object.assign(req,{url:path,method,headers:{origin:'https://app.example','content-type':'application/x-www-form-urlencoded',...headers}});
  const res={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},writeHead(status,h){this.status=status;for(const [k,v] of Object.entries(h))this.setHeader(k,v);this.headersSent=true;},end(body=''){this.body=body;}};await handler(req,res);return res;
 };
 return {store,request,meli,get checks(){return checks;},async login(){const r=await request('/login','POST',new URLSearchParams({password}));const cookie=r.headers['set-cookie'].split(';')[0];const s=await store.getSession(hash(cookie.split('=')[1]));return {cookie,csrf:s.csrf};}};
}
test('draft flow enforces session, csrf, ownership and stale revision; saves before validating',async()=>{
 const h=serverFixture();assert.equal((await h.request('/rascunhos')).status,303);const {cookie,csrf}=await h.login();
 assert.equal((await h.request('/rascunhos/criar','POST',new URLSearchParams({item:source.item.id}),{cookie})).status,403);
 const create=await h.request('/rascunhos/criar','POST',new URLSearchParams({csrf,item:source.item.id}),{cookie});assert.equal(create.status,303);const id=create.headers.location.split('/').pop();
 const form=formFor(draft());form.set('csrf',csrf);form.set('draftId',id);form.set('revision','1');form.set('description','<test>\n'+'x'.repeat(10000));
 const validated=await h.request('/rascunhos/validar','POST',form,{cookie});assert.equal(validated.status,303);assert.equal(h.checks,1);const row=await h.store.getDraft(id,'123');assert.equal(row.revision,2);assert.equal(row.data.validation.ok,true);assert.ok(row.data.values.description.length>10000);
 assert.equal((await h.request('/rascunhos/salvar','POST',form,{cookie})).status,409);
 form.set('revision','2');await h.request('/rascunhos/salvar','POST',form,{cookie});assert.equal((await h.store.getDraft(id,'123')).data.validation,null);
 h.store.drafts.get(id).seller='456';assert.equal((await h.request('/rascunhos/'+id,'GET',undefined,{cookie})).status,404);
});
test('failed validator preserves saved inputs and returns editable draft',async()=>{
 const h=serverFixture();const {cookie,csrf}=await h.login();const id=random();await h.store.createDraft(id,'123',draft());h.meli.validateDraft=async()=>{throw new UserError('Sem resposta do validador.',502);};
 const f=formFor(draft());f.set('csrf',csrf);f.set('draftId',id);f.set('revision','1');f.set('name','Meu rascunho salvo');
 const result=await h.request('/rascunhos/validar','POST',f,{cookie});assert.equal(result.status,502);assert.match(result.body,/Meu rascunho salvo/);assert.equal((await h.store.getDraft(id,'123')).data.values.name,'Meu rascunho salvo');
});

test('custom brand always sends its displayed name, never an unresolved imported ID',()=>{
 for(const id of ['123','-1','',null]){
  const d=draft();d.originals.BRAND.value_id=id;
  const prepared=preparePayload(applyForm(d,formFor(d)));
  assert.deepEqual(prepared.payload.attributes.find(a=>a.id==='BRAND'),{id:'BRAND',value_name:'DENSUL'});
 }
 const d=draft();d.schema[0]={...d.schema[0],values:[{id:'456',name:'DENSUL'}]};
 assert.deepEqual(preparePayload(applyForm(d,formFor(d))).payload.attributes.find(a=>a.id==='BRAND'),{id:'BRAND',value_id:'456',value_name:'DENSUL'});
});
test('validator distinguishes warnings from blocking errors without inferring severity from code',async()=>{
 const f=apiFixture(()=>Response.json({cause:[{code:'item.attribute.invalid',message:'BRAND missing',type:'error'},{code:'shipping.lost_me1_by_user',message:'User has not mode me1',type:'warning'},{code:'item.shipping.mandatory_free_shipping',message:'Mandatory free shipping added',type:'warning'}]},{status:400}));
 const result=await f.service.validateDraft(applyForm(draft(),formFor(draft())));
 assert.equal(result.ok,false);assert.equal(result.issues.length,1);assert.equal(result.warnings.length,2);assert.match(result.issues[0],/BRAND/);
 const html=editor({id:random(),revision:1,data:{...draft(),validation:result}},{csrf:'csrf'});assert.match(html,/Avisos do Mercado Livre/);assert.match(html,/Mandatory free shipping/);
});
test('HTTP error containing only warnings is never treated as validated',async()=>{
 const f=apiFixture(()=>Response.json({cause:[{code:'notice',message:'<script>warning</script>',type:'warning'}]},{status:400}));
 const result=await f.service.validateDraft(applyForm(draft(),formFor(draft())));assert.equal(result.ok,false);assert.match(result.issues[0],/não confirmou/);
 const html=editor({id:random(),revision:1,data:{...draft(),validation:result}},{csrf:'csrf'});assert.ok(!html.includes('<script>warning'));assert.ok(html.includes('&lt;script&gt;'));
});
