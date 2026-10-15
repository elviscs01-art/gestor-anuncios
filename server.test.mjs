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
test('login, csrf, logout and protected cookies',async()=>{
 const {post,request,login}=harness();
 assert.equal((await post('/login',{password:'wrong'})).status,401);
 assert.equal((await post('/login',{password},{origin:'https://other.example'})).status,403);
 const {response,cookie,session}=await login();
 for(const flag of ['__Host-gestor=','HttpOnly','Secure','SameSite=Lax'])assert.ok(response.headers['set-cookie'].includes(flag));
 const home=await request('/',{headers:{cookie}});assert.ok(home.headers['content-security-policy'].includes('https://auth.mercadolivre.com.br'));assert.equal(home.status,200);assert.match(home.body,/DATABASE_URL/);assert.ok(!home.body.includes(password));
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
