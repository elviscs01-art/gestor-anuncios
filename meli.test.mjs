import test from 'node:test';
import assert from 'node:assert/strict';
import {createMeli} from './meli.mjs';
import {vault,hash,challenge} from './security.mjs';
const secret='test-only-encryption-key-with-high-entropy-placeholder';
class MemoryStore{
 constructor(){this.flows=new Map();this.row=null;this.queue=Promise.resolve();this.writes=[];}
 async putFlow(state,session,verifier){this.flows.set(state,{session,verifier,expires:Date.now()+600000});}
 async takeFlow(state,session){const f=this.flows.get(state);if(!f||f.session!==session||f.expires<=Date.now())return undefined;this.flows.delete(state);return f.verifier;}
 async withConnection(fn){const old=this.queue;let release;this.queue=new Promise(r=>release=r);await old;try{return await fn({get:async()=>this.row?{...this.row}:null,save:async row=>{this.row={...row};this.writes.push({...row});}});}finally{release();}}
}
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const tokens=(access='ACCESS_SECRET',refresh='REFRESH_SECRET')=>({access_token:access,refresh_token:refresh,user_id:123,expires_in:21600,scope:'read write offline_access'});
function fixture(fetcher,extra={}){const store=new MemoryStore(),crypto=vault(secret);const service=createMeli({store,crypto,clientId:'client',clientSecret:'CLIENT_SECRET',baseUrl:'https://app.example',fetcher,...extra});return {store,crypto,service};}
async function connect(f){const url=new URL(await f.service.begin('session'));await f.service.complete({sessionId:'session',state:url.searchParams.get('state'),code:'CODE'});return url;}
test('encryption is authenticated, randomized and separated by purpose',()=>{
 const crypto=vault(secret),a=crypto.seal({access:'secret'}),b=crypto.seal({access:'secret'});
 assert.notEqual(a,b);assert.ok(!a.includes('secret'));assert.deepEqual(crypto.open(a),{access:'secret'});
 assert.throws(()=>crypto.open(a,'pkce'));assert.throws(()=>vault(secret+'other').open(a));
 const parts=a.split('.');parts[2]=Buffer.alloc(16).toString('base64url');assert.throws(()=>crypto.open(parts.join('.')));
});
test('OAuth uses PKCE, exact callback, body credentials and encrypted storage',async()=>{
 let request;
 const f=fixture(async(url,options)=>{request={url,options};return response(tokens());});
 const url=await connect(f);
 assert.equal(url.origin,'https://auth.mercadolivre.com.br');assert.equal(url.searchParams.get('redirect_uri'),'https://app.example/oauth/mercadolivre/callback');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.equal(request.url,'https://api.mercadolibre.com/oauth/token');assert.equal(request.options.method,'POST');assert.equal(request.options.body.get('code'),'CODE');assert.equal(request.options.body.get('client_secret'),'CLIENT_SECRET');
 assert.equal(challenge(request.options.body.get('code_verifier')),url.searchParams.get('code_challenge'));
 assert.ok(!JSON.stringify(f.store.row).includes('ACCESS_SECRET'));assert.equal(f.crypto.open(f.store.row.encrypted).refresh,'REFRESH_SECRET');
});
test('wrong session, expired state, cancellation and replay cannot exchange code',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return response(tokens());});
 const url=new URL(await f.service.begin('owner')),state=url.searchParams.get('state');
 await assert.rejects(f.service.complete({sessionId:'other',state,code:'CODE'}));assert.equal(calls,0);
 f.store.flows.get(hash(state)).expires=0;await assert.rejects(f.service.complete({sessionId:'owner',state,code:'CODE'}));assert.equal(calls,0);
 const second=new URL(await f.service.begin('owner'));const s=second.searchParams.get('state');
 await assert.rejects(f.service.complete({sessionId:'owner',state:s,denied:true}));
 await assert.rejects(f.service.complete({sessionId:'owner',state:s,code:'CODE'}));assert.equal(calls,0);
 const successful=await connect(f);assert.equal(calls,1);
 await assert.rejects(f.service.complete({sessionId:'session',state:successful.searchParams.get('state'),code:'CODE'}));assert.equal(calls,1);
});
test('unmatched seller and missing refresh token are rejected',async()=>{
 const f=fixture(async()=>response(tokens()),{expectedSeller:'999'});await assert.rejects(connect(f),/conta autorizada/);assert.equal(f.store.row,null);
 const missing=fixture(async()=>response({...tokens(),refresh_token:undefined}));await assert.rejects(connect(missing),/acesso offline/);
});
test('foreign item rejected before description or compatibility queries',async()=>{
 const urls=[];const f=fixture(async(url)=>{urls.push(url);if(url.endsWith('/oauth/token'))return response(tokens());if(url.endsWith('/users/me'))return response({id:123});return response({id:'MLB4155100949',seller_id:999});});
 await connect(f);await assert.rejects(f.service.inspect('MLB4155100949'),/não pertence/);assert.equal(urls.length,3);
 await assert.rejects(f.service.inspect('../users/me'));assert.equal(urls.length,3);
});
test('simultaneous expired-token queries rotate refresh token once',async()=>{
 let exchanges=0;
 const f=fixture(async(url,options)=>{
  if(url.endsWith('/oauth/token')){exchanges++;if(exchanges===2){assert.equal(options.body.get('refresh_token'),'REFRESH_SECRET');assert.equal(f.store.row.status,'refreshing');await new Promise(r=>setTimeout(r,5));return response(tokens('NEW_ACCESS','NEW_REFRESH'));}return response(tokens());}
  assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,'Bearer NEW_ACCESS');
  if(url.endsWith('/users/me'))return response({id:123});if(url.includes('compatibilities'))return response({products:[]});if(url.endsWith('/description'))return response({plain_text:'text'});return response({id:'MLB4155100949',seller_id:123});
 });
 await connect(f);f.store.row.expires=0;
 await Promise.all([f.service.inspect('MLB4155100949'),f.service.inspect('MLB4155100949')]);
 assert.equal(exchanges,2);assert.equal(f.crypto.open(f.store.row.encrypted).refresh,'NEW_REFRESH');assert.equal(f.store.row.status,'ready');
});
test('uncertain refresh is not replayed and requires new authorization',async()=>{
 let exchanges=0;const f=fixture(async()=>{exchanges++;if(exchanges===1)return response(tokens());throw new Error('timeout');});
 await connect(f);f.store.row.expires=0;await assert.rejects(f.service.inspect('MLB4155100949'),/Reconecte/);assert.equal(f.store.row.status,'reconnect');
 await assert.rejects(f.service.inspect('MLB4155100949'));assert.equal(exchanges,2);
});
test('revoked token gets one refresh and optional failure remains explicit',async()=>{
 let exchanges=0;const f=fixture(async(url,options)=>{
  if(url.endsWith('/oauth/token'))return response(++exchanges===1?tokens():tokens('new','new_refresh'));
  if(options.headers.Authorization==='Bearer ACCESS_SECRET')return response({error:'unauthorized'},401);
  if(url.endsWith('/users/me'))return response({id:123});if(url.includes('compatibilities'))return response({secret:'SHOULD_NOT_LEAK'},403);if(url.endsWith('/description'))return response({plain_text:'text'});return response({id:'MLB4155100949',seller_id:123});
 });
 await connect(f);const result=await f.service.inspect('MLB4155100949');assert.equal(exchanges,2);assert.match(result.compatibility.error,/permissões/);assert.ok(!JSON.stringify(result).includes('SHOULD_NOT_LEAK'));
});
