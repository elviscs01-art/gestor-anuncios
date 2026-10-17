import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createApp,config} from './server.mjs';
import {SetupSessions} from './store.mjs';
import {hash} from './security.mjs';
const password='test-only-admin-password-not-for-deployment';
const settings={password,baseUrl:'https://app.example',production:true,databaseUrl:'',key:'',clientId:'',clientSecret:''};
function harness(options={}){
 const store=options.store||new SetupSessions();
 const {handler}=createApp({settings,...options,store});
 const request=async(path='/',{method='GET',body='',headers={}}={})=>{
  const req=Readable.from([Buffer.from(body)]);req.url=path;req.method=method;req.headers=headers;
  const response={status:0,headers:{},body:'',setHeader(k,v){this.headers[k.toLowerCase()]=v;},writeHead(status,extra){this.status=status;for(const [k,v] of Object.entries(extra))this.setHeader(k,v);this.headersSent=true;},end(body=''){this.body=body;}};
  await handler(req,response);return response;
 };
 const post=(path,body,headers={})=>request(path,{method:'POST',body:new URLSearchParams(body).toString(),headers:{origin:'https://app.example','content-type':'application/x-www-form-urlencoded',...headers}});
 const login=async()=>{const response=await post('/login',{password});const cookie=response.headers['set-cookie'].split(';')[0];const session=await store.getSession(hash(cookie.split('=')[1]));return {response,cookie,session};};
 return {request,post,login,store};
}
test('configuration rejects weak secrets and unsafe origins',()=>{
 assert.throws(()=>config({ADMIN_PASSWORD:'short'}));
 assert.throws(()=>config({ADMIN_PASSWORD:password,NODE_ENV:'production',APP_BASE_URL:'http://app.example'}));
 assert.throws(()=>config({ADMIN_PASSWORD:password,APP_BASE_URL:'https://app.example/path'}));
 assert.throws(()=>config({ADMIN_PASSWORD:password,APP_BASE_URL:'https://app.example',TOKEN_ENCRYPTION_KEY:password}));
});
test('health is public and login does not use Basic auth',async()=>{
 const {request}=harness();
 assert.deepEqual(JSON.parse((await request('/health')).body),{status:'ok'});
 const denied=await request('/');assert.equal(denied.status,303);assert.equal(denied.headers.location,'/login');assert.equal(denied.headers['www-authenticate'],undefined);
 assert.match((await request('/login')).body,/type="password"/);
});

test('overview data requires a session and refresh requires origin and csrf',async()=>{
 const h=harness();
 for(const path of ['/painel/dados','/painel/vendas','/anuncios/dados'])assert.equal((await h.request(path,{headers:{accept:'application/json'}})).status,401);
 const {cookie}=await h.login();
 for(const path of ['/painel/iniciar','/painel/avancar','/anuncios/iniciar'])assert.equal((await h.post(path,{}, {cookie,accept:'application/json'})).status,403);
 assert.match((await h.request('/',{headers:{cookie}})).body,/href="\/configuracoes"/);
 assert.match((await h.request('/configuracoes',{headers:{cookie}})).body,/Endereço de retorno/);
});

test('replication routes bind owner, enforce csrf and preserve invalid title input',async()=>{
 const store=new SetupSessions();store.summary=async()=>({user_id:'123',status:'ready'});let submitted=0;
 const id='a'.repeat(43),row={id,status:'editing',data:{source:{sourceId:'MLB123456',sourceTitle:'Original',sourceFamily:'',sellerName:'Densul',payload:{price:100,available_quantity:2},compatibilities:[],maxTitle:60},copies:[{title:'Original',type:'gold_special'}]}};
 const replication={list:async owner=>{assert.equal(owner,'123');return [];},read:async(i,owner)=>{assert.equal(i,id);assert.equal(owner,'123');return row;},submit:async(i,owner,copies,state,pack)=>{assert.equal(owner,'123');assert.equal(state,'active');if(submitted)assert.equal(pack.weight,'1500');submitted++;return {row:{...row,data:{...row.data,copies}},errors:{0:'Altere o título'}};}};
 const h=harness({store,settings:{...settings,databaseUrl:'configured',key:'configured',clientId:'1',clientSecret:'test'},publications:{},catalog:{read:async()=>null},replication});
 assert.equal((await h.request('/publicacoes/lista',{headers:{accept:'application/json'}})).status,401);
 const {cookie,session}=await h.login();assert.match((await h.request('/publicacoes',{headers:{cookie}})).body,/Replicação de anúncios/);
 const route='/publicacoes/lote/'+id+'/publicar';assert.equal((await h.post(route,{}, {cookie})).status,403);assert.equal(submitted,0);
 const response=await h.post(route,{csrf:session.csrf,title0:'Original',type0:'gold_pro',finalState:'active'},{cookie});assert.equal(response.status,400);assert.match(response.body,/aria-invalid="true"/);assert.match(response.body,/value="gold_pro" selected/);assert.equal(submitted,1);
 for(const fields of [{package_weight:'1,5',package_weight_unit:'kg'},{package_weight:'1500'}])assert.equal((await h.post(route,{csrf:session.csrf,title0:'Original',type0:'gold_pro',finalState:'active',...fields},{cookie})).status,400);assert.equal(submitted,3);
});
test('login, csrf, logout and protected cookies',async()=>{
 const {post,request,login}=harness();
 assert.equal((await post('/login',{password:'wrong'})).status,401);
 assert.equal((await post('/login',{password},{origin:'https://other.example'})).status,403);
 const {response,cookie,session}=await login();
 for(const flag of ['__Host-gestor=','HttpOnly','Secure','SameSite=Lax'])assert.ok(response.headers['set-cookie'].includes(flag));
 const home=await request('/',{headers:{cookie}});assert.ok(home.headers['content-security-policy'].includes('https://auth.mercadolivre.com.br'));assert.equal(home.status,200);assert.match(home.body,/Aqui está o resumo/);assert.match((await request('/configuracoes',{headers:{cookie}})).body,/DATABASE_URL/);assert.ok(!home.body.includes(password));
 assert.equal((await post('/logout',{}, {cookie})).status,403);
 assert.equal((await post('/logout',{csrf:session.csrf},{cookie})).status,303);
 assert.equal((await request('/',{headers:{cookie}})).headers.location,'/login');
});
test('expired sessions and password changes invalidate access',async()=>{
 let time=Date.now();const shared=new SetupSessions();const first=harness({store:shared,now:()=>time});
 const {cookie}=await first.login();
 const changed=harness({store:shared,settings:{...settings,password:password+'changed'}});
 assert.equal((await changed.request('/',{headers:{cookie}})).status,303);
 const next=await first.login();time+=9*3600000;
 assert.equal((await first.request('/',{headers:{cookie:next.cookie}})).status,303);
});
test('login attempts are limited and oversized forms rejected',async()=>{
 const {post}=harness();for(let i=0;i<10;i++)assert.equal((await post('/login',{password:'wrong'})).status,401);
 assert.equal((await post('/login',{password})).status,429);
 assert.equal((await post('/login',{password:'x'.repeat(9000)})).status,413);
});
test('oauth start requires login and csrf; callback removes code from URL',async()=>{
 let calls=0;
 const meli={begin:async()=>{calls++;return 'https://auth.mercadolivre.com.br/authorization?state=s';},complete:async()=>{calls++;}};
 const h=harness({settings:{...settings,databaseUrl:'configured',key:'configured',clientId:'1',clientSecret:'test-value'},meli});
 assert.equal((await h.post('/oauth/mercadolivre/start',{})).headers.location,'/login');
 const {cookie,session}=await h.login();
 assert.equal((await h.post('/oauth/mercadolivre/start',{}, {cookie})).status,403);
 const start=await h.post('/oauth/mercadolivre/start',{csrf:session.csrf},{cookie});assert.ok(start.headers.location.startsWith('https://auth.mercadolivre.com.br/'));
 const callback=await h.request('/oauth/mercadolivre/callback?state=s&code=test-code',{headers:{cookie}});
 assert.equal(callback.headers.location,'/?notice=connected');assert.ok(!callback.body.includes('test-code'));assert.equal(calls,2);
});
test('report escapes external content and keeps optional failures explicit',async()=>{
 const meli={inspect:async()=>({profile:{id:1,nickname:'seller'},item:{id:'MLB4155100949',seller_id:1,title:'<script>test</script>',attributes:[]},description:{error:'Sem permissão'},compatibility:{error:'Sem permissão'},checkedAt:new Date().toISOString()})};
 const h=harness({settings:{...settings,databaseUrl:'yes',key:'yes',clientId:'1',clientSecret:'yes'},meli});
 const {cookie,session}=await h.login();const report=await h.post('/anuncio',{csrf:session.csrf,item:'MLB4155100949'},{cookie});
 assert.equal(report.status,200);assert.ok(!report.body.includes('<script>'));assert.match(report.body,/&lt;script&gt;/);assert.match(report.body,/compatibilidades indisponível/);
});

test('form policy preserves origin and rejects opaque or missing origins',async()=>{
 const {request,post}=harness();
 const page=await request('/login');
 assert.equal(page.headers['referrer-policy'],'strict-origin');
 for(const origin of ['null',undefined,'https://attacker.example']){
  assert.equal((await post('/login',{password},{origin})).status,403);
 }
 assert.equal((await post('/login',{password})).status,303);
});

test('test creation routes enforce login, origin, CSRF and explicit confirmation',async()=>{
 let calls=0;const store=new SetupSessions();store.summary=async()=>({user_id:'real'});
 const h=harness({store,settings:{...settings,databaseUrl:'yes',key:'yes',clientId:'1',clientSecret:'yes'},testMeli:{},lab:{run:async()=>{calls++;}}});
 const body={attemptId:'a'.repeat(43),confirm:'test'};
 assert.equal((await h.post('/testes/publicar',body)).headers.location,'/login');
 const {cookie,session}=await h.login();
 assert.equal((await h.post('/testes/publicar',body,{cookie})).status,403);
 assert.equal((await h.post('/testes/publicar',{...body,csrf:session.csrf},{cookie,origin:'https://other.example'})).status,403);
 assert.equal((await h.post('/testes/publicar',{attemptId:body.attemptId,csrf:session.csrf},{cookie})).status,400);
 assert.equal(calls,0);
 assert.equal((await h.post('/testes/publicar',{...body,csrf:session.csrf},{cookie})).status,303);assert.equal(calls,1);
});

test('official publication requires its own confirmation, authenticated CSRF and POST',async()=>{
 let calls=0;const store=new SetupSessions();store.summary=async()=>({user_id:'123'});
 const h=harness({store,settings:{...settings,databaseUrl:'yes',key:'yes',clientId:'1',clientSecret:'yes'},publications:{run:async()=>{calls++;}}});
 assert.equal((await h.post('/publicacoes/publicar',{})).headers.location,'/login');
 const {cookie,session}=await h.login(),body={attemptId:'a'.repeat(43),csrf:session.csrf,confirm:'official'};
 assert.equal((await h.post('/publicacoes/publicar',{...body,confirm:'test'},{cookie})).status,400);
 assert.equal((await h.post('/publicacoes/publicar',{...body,csrf:'wrong'},{cookie})).status,403);
 assert.equal((await h.post('/publicacoes/publicar',body,{cookie,origin:'https://other.example'})).status,403);
 assert.equal((await h.request('/publicacoes/publicar',{headers:{cookie}})).status,404);assert.equal(calls,0);
 assert.equal((await h.post('/publicacoes/publicar',body,{cookie})).status,303);assert.equal(calls,1);
});

test('metrics routes protect owner and require POST, origin and csrf to sync',async()=>{
 let writes=0,reads=0;const store=new SetupSessions();store.summary=async()=>({user_id:'123'});
 const metrics={read:async owner=>{assert.equal(owner,'123');reads++;return null;},start:async owner=>{assert.equal(owner,'123');writes++;},advance:async()=>{writes++;}};
 const h=harness({store,settings:{...settings,databaseUrl:'yes',key:'yes',clientId:'1',clientSecret:'yes'},metrics});
 assert.equal((await h.request('/metricas')).headers.location,'/login');
 const {cookie,session}=await h.login();
 assert.equal((await h.request('/metricas',{headers:{cookie}})).status,200);assert.equal(reads,1);assert.equal(writes,0);
 assert.equal((await h.request('/metricas/iniciar',{headers:{cookie}})).status,404);
 assert.equal((await h.post('/metricas/iniciar',{}, {cookie})).status,403);
 assert.equal((await h.post('/metricas/iniciar',{csrf:session.csrf},{cookie,origin:'https://other.example'})).status,403);assert.equal(writes,0);
 assert.equal((await h.post('/metricas/iniciar',{csrf:session.csrf,seller:'999'}, {cookie})).headers.location,'/metricas?auto=1');assert.equal(writes,1);
});

test('diagnostic JSON endpoints update without redirects and preserve auth/CSRF protections',async()=>{
 let updates=0;const store=new SetupSessions();store.summary=async()=>({user_id:'123'});
 const h=harness({store,settings:{...settings,databaseUrl:'yes',key:'yes',clientId:'1',clientSecret:'yes'},metrics:{read:async()=>null,start:async()=>{updates++;},advance:async()=>{updates++;}}});
 assert.equal((await h.request('/metricas/dados',{headers:{accept:'application/json'}})).status,401);
 const {cookie,session}=await h.login();
 const headers={cookie,accept:'application/json'};
 const result=await h.post('/metricas/iniciar',{csrf:session.csrf},headers);
 assert.equal(result.status,200);assert.equal(result.headers.location,undefined);assert.equal(updates,1);
 assert.equal(JSON.parse(result.body).status,'empty');assert.match(JSON.parse(result.body).progressHtml,/Carregar diagnóstico/);
 const csrfFailure=await h.post('/metricas/avancar',{},headers);assert.equal(csrfFailure.status,403);assert.ok(JSON.parse(csrfFailure.body).error);assert.equal(updates,1);
 const data=await h.request('/metricas/dados?visits=30&sales=60',{headers});
 assert.equal(data.status,200);assert.ok(JSON.parse(data.body).resultsHtml);assert.equal(updates,1);
 const html=await h.request('/metricas',{headers:{cookie}});assert.match(html.headers['content-security-policy'],/connect-src 'self'/);
});

test('replacement endpoints enforce login origin CSRF and server-owned seller',async()=>{let calls=0;const store=new SetupSessions();store.summary=async()=>({user_id:'123'});const h=harness({store,settings:{...settings,databaseUrl:'yes',key:'yes',clientId:'1',clientSecret:'yes'},catalog:{},replacement:{begin:async(owner,item)=>{assert.equal(owner,'123');assert.equal(item,'MLB123456');calls++;return {id:'a'.repeat(43)};}}});assert.equal((await h.post('/substituicoes/iniciar',{})).headers.location,'/login');const {cookie,session}=await h.login(),body={csrf:session.csrf,item:'MLB123456',owner:'foreign'};assert.equal((await h.post('/substituicoes/iniciar',{...body,csrf:'wrong'},{cookie})).status,403);assert.equal((await h.post('/substituicoes/iniciar',body,{cookie,origin:'https://other.example'})).status,403);assert.equal((await h.request('/substituicoes/iniciar',{headers:{cookie}})).status,404);assert.equal(calls,0);assert.equal((await h.post('/substituicoes/iniciar',body,{cookie})).status,303);assert.equal(calls,1);});

test('unique listing page filters all account rows and protects refresh',async()=>{let writes=0;const store=new SetupSessions();store.summary=async()=>({user_id:'123'});const catalog={read:async owner=>{assert.equal(owner,'123');return {status:'complete',snapshot:{rows:[{id:'MLB123456',skus:['A'],quantity:1},{id:'MLB222222',skus:['A'],quantity:1},{id:'MLB333333',skus:['B'],quantity:1}]}};},start:async owner=>{assert.equal(owner,'123');writes++;}};const h=harness({store,settings:{...settings,databaseUrl:'yes',key:'yes',clientId:'1',clientSecret:'yes'},catalog,replication:{list:async()=>[]}});assert.equal((await h.request('/sem-replicacao/lista',{headers:{accept:'application/json'}})).status,401);const {cookie,session}=await h.login();const page=await h.request('/sem-replicacao',{headers:{cookie}});assert.equal(page.status,200);assert.ok(page.body.includes('data-item="MLB333333"'));assert.ok(!page.body.includes('data-item="MLB123456"'));assert.equal((await h.post('/sem-replicacao/atualizar',{}, {cookie})).status,403);assert.equal(writes,0);assert.equal((await h.post('/sem-replicacao/atualizar',{csrf:session.csrf},{cookie})).status,200);assert.equal(writes,1);});

test('quality routes bind seller and protect refresh with login origin and CSRF',async()=>{let writes=0;const store=new SetupSessions();store.summary=async()=>({user_id:'123'});const quality={read:async owner=>{assert.equal(owner,'123');return null;},start:async owner=>{assert.equal(owner,'123');writes++;}};const h=harness({store,settings:{...settings,databaseUrl:'yes',key:'yes',clientId:'1',clientSecret:'yes'},quality});assert.equal((await h.request('/qualidade/dados',{headers:{accept:'application/json'}})).status,401);const {cookie,session}=await h.login();assert.equal((await h.request('/qualidade',{headers:{cookie}})).status,200);assert.equal((await h.post('/qualidade/iniciar',{}, {cookie})).status,403);assert.equal((await h.post('/qualidade/iniciar',{csrf:session.csrf},{cookie,origin:'https://other.example'})).status,403);assert.equal(writes,0);assert.equal((await h.post('/qualidade/iniciar',{csrf:session.csrf,owner:'other'},{cookie})).status,200);assert.equal(writes,1);});

test('diagnostic export requires authentication and is scoped to current seller without clearing records',async()=>{let reads=0;const store=new SetupSessions();store.summary=async()=>({user_id:'123'});store.diagnostics={list:async owner=>{assert.equal(owner,'123');reads++;return [{id:'error-id',details:{operation:'replacement.advance'}}];}};const h=harness({store});assert.equal((await h.request('/configuracoes/erros',{headers:{accept:'application/json'}})).status,401);const {cookie}=await h.login();const response=await h.request('/configuracoes/erros',{headers:{cookie,accept:'application/json'}});assert.equal(response.status,200);assert.ok(JSON.parse(response.body).text.includes('error-id'));assert.equal(reads,1);const page=await h.request('/configuracoes',{headers:{cookie}});assert.ok(page.body.includes('copy-diagnostics'));assert.ok(!page.body.includes('error-id'));});
test('replacement retry is POST only, requires CSRF and keeps server owner',async()=>{let calls=0;const store=new SetupSessions();store.summary=async()=>({user_id:'123'});const id='a'.repeat(43),replacement={read:async()=>({id,status:'blocked'}),retry:async(i,owner)=>{assert.equal(i,id);assert.equal(owner,'123');calls++;return {id,status:'queued'};}};const h=harness({store,settings:{...settings,databaseUrl:'yes',key:'yes',clientId:'1',clientSecret:'yes'},catalog:{},replacement});const {cookie,session}=await h.login(),path='/substituicoes/resultado/'+id+'/retomar';assert.equal((await h.post(path,{}, {cookie})).status,403);assert.equal((await h.request(path,{headers:{cookie}})).status,405);assert.equal(calls,0);assert.equal((await h.post(path,{csrf:session.csrf,owner:'wrong'},{cookie})).status,303);assert.equal(calls,1);});

test('retry existing replica is authenticated POST with csrf and server owner',async()=>{const store=new SetupSessions();store.summary=async()=>({user_id:'123'});const id='r'.repeat(43),row={id,status:'complete',data:{copies:[]}};let called=0;const replication={read:async(i,o)=>{assert.equal(o,'123');return row;},retry:async(i,o,index,name)=>{assert.equal(i,id);assert.equal(o,'123');assert.equal(index,0);assert.equal(name,'Nome conferido');called++;return row;}};const h=harness({store,settings:{...settings,databaseUrl:'yes',key:'yes',clientId:'1',clientSecret:'yes'},publications:{},catalog:{},replication});const route='/publicacoes/lote/'+id+'/retomar';assert.equal((await h.post(route,{})).status,303);const {cookie,session}=await h.login();assert.equal((await h.post(route,{copy:'0'},{cookie})).status,403);assert.equal((await h.request(route,{headers:{cookie}})).status,405);assert.equal((await h.post(route,{csrf:session.csrf,copy:'bad'},{cookie})).status,400);assert.equal(called,0);const r=await h.post(route,{csrf:session.csrf,copy:'0',acceptedFamily:'Nome conferido',owner:'evil'},{cookie});assert.equal(r.status,303);assert.equal(called,1);});
