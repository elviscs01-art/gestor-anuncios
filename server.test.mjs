import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from './server.mjs';
const password='test-only-password-not-a-real-credential';
function harness(options={}) {
 const app=createApp({password,production:true,...options});
 return (url='/',{method='GET',authorization}={})=>{
  const headers={};
  const result={headers};
  const response={
   setHeader(name,value){headers[name.toLowerCase()]=value;},
   writeHead(status,extra){result.status=status;for(const [key,value] of Object.entries(extra||{})) headers[key.toLowerCase()]=value;},
   end(body){result.body=body;}
  };
  app.emit('request',{url,method,headers:{authorization}},response);
  return result;
 };
}
const auth=value=>'Basic '+Buffer.from('admin:'+value).toString('base64');
test('rejects missing or short password',()=>{
 assert.throws(()=>createApp());
 assert.throws(()=>createApp({password:'short'}));
});
test('health is public, private page requires authentication, writes rejected',()=>{
 const request=harness();
 assert.deepEqual(JSON.parse(request('/health').body),{status:'ok'});
 assert.equal(request().status,401);
 assert.equal(request('/',{authorization:auth('wrong')}).status,401);
 const ok=request('/',{authorization:auth(password)});
 assert.equal(ok.status,200);
 assert.match(ok.body,/ainda não conectado/);
 assert.equal(ok.headers['cache-control'],'no-store');
 assert.equal(request('/',{method:'POST',authorization:auth(password)}).status,405);
 assert.equal(request('/missing',{authorization:auth(password)}).status,404);
});
test('repeated incorrect authentication is limited and recovers',()=>{
 let time=100;
 const request=harness({now:()=>time});
 for(let i=0;i<10;i++) assert.equal(request('/',{authorization:auth('wrong')}).status,401);
 assert.equal(request('/',{authorization:auth(password)}).status,429);
 time+=60001;
 assert.equal(request('/',{authorization:auth(password)}).status,200);
});
