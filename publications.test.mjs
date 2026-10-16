import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublications} from './publications.mjs';
import {createMeli} from './meli.mjs';
import {vault,UserError} from './security.mjs';
import {makeDraft} from './drafts.mjs';
import {attempt} from './publication-views.mjs';
function fixture(fail,paused=true){
 const row={id:'attempt',owner_id:'123',draft_id:'draft',revision:1,status:'prepared',snapshot:{kind:'official',sellerId:'123',description:'Descrição real'}};
 const events=[];let revision=1;
 const store={getDraft:async()=>({revision}),publications:{attempt:async(id,owner)=>id===row.id&&owner==='123'?row:null,claimAttempt:async()=>{if(row.status!=='prepared')return null;row.status='sending';return structuredClone(row);},finish:async(id,owner,status,item_id,result)=>{Object.assign(row,{status,item_id,result:structuredClone(result)});}}};
 const meli={createOfficialListing:async()=>{events.push('create');await new Promise(r=>setTimeout(r,5));if(fail)throw fail;return{id:'MLB1234',status:'active'};},pauseOfficialListing:async()=>{assert.equal(row.item_id,'MLB1234');events.push('pause');if(!paused)throw new UserError('pause failed');return 'paused';},describeOfficialListing:async()=>{events.push('description');}};
 return {service:createPublications({store,meli}),row,events,stale:()=>{revision=2;}};
}
test('official publication creates once and pauses before description',async()=>{
 const f=fixture();await Promise.all([f.service.run('attempt','123'),f.service.run('attempt','123')]);await f.service.run('attempt','123');
 assert.deepEqual(f.events,['create','pause','description']);assert.equal(f.row.status,'completed');
});
test('official uncertainty is persisted and never resubmitted',async()=>{
 const e=new UserError('timeout');e.uncertain=true;const f=fixture(e);await f.service.run('attempt','123');await f.service.run('attempt','123');assert.equal(f.row.status,'unknown');assert.deepEqual(f.events,['create']);
});
test('official pause failure preserves created ID and active status',async()=>{
 const f=fixture(null,false);await f.service.run('attempt','123');assert.equal(f.row.status,'partial');assert.equal(f.row.item_id,'MLB1234');assert.equal(f.row.result.itemStatus,'active');assert.match(f.row.result.pauseMessage,/failed/);
});
test('stale or foreign official previews cannot create',async()=>{
 const f=fixture();await assert.rejects(f.service.run('attempt','999'));f.stale();await assert.rejects(f.service.run('attempt','123'),/mudou/);assert.equal(f.events.length,0);
});
function api(profile={id:123,site_id:'MLB',tags:[],nickname:'LOJA'},extra={}){
 const crypto=vault('only-a-test-encryption-key-with-long-value');
 const row={user_id:'123',status:'ready',expires:Date.now()+3600000,encrypted:crypto.seal({access:'ACCESS',refresh:'REFRESH'})};
 const calls=[];const category={id:'MLB190954',settings:{}};
 const service=createMeli({store:{withConnection:async fn=>fn({get:async()=>row})},crypto,baseUrl:'https://app.example',...extra,fetcher:async(url,o)=>{
 calls.push({url,...o});
 if(url.endsWith('/users/me'))return Response.json(profile);
 if(url.endsWith('/shipping_preferences'))return Response.json({modes:['me2']});
 if(url.endsWith('/attributes'))return Response.json([]);
 if(url.includes('/categories/'))return Response.json(category);
 if(o.method==='GET')return Response.json({seller_id:999});
 return Response.json({id:'MLB1234',seller_id:123,status:'active'});
 }});
 const draft=makeDraft({profile,item:{id:'MLB9999',category_id:category.id,title:'Evaporador Logan',price:319.15,condition:'new',listing_type_id:'gold_special',shipping:{mode:'me2',free_shipping:true},pictures:[{id:'photo'}]},description:{data:{plain_text:'Descrição real'}},compatibility:{}},category,[]);
 draft.values.quantity='2';
 return {service,calls,draft};
}
test('official preparation preserves actual content and shipping',async()=>{
 const f=api();const s=await f.service.prepareOfficial(f.draft,'123');
 assert.equal(s.kind,'official');assert.equal(s.payload.title,'Evaporador Logan');assert.equal(s.payload.available_quantity,2);assert.equal(s.description,'Descrição real');assert.deepEqual(s.payload.shipping,{mode:'me2',free_shipping:true});
 assert.equal(f.calls.filter(c=>c.method!=='GET').length,0);
 await f.service.createOfficialListing(s,'123');assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
 const html=attempt({id:'a'.repeat(43),status:'prepared',snapshot:s},{csrf:'csrf'});
 assert.match(html,/value="official"/);assert.match(html,/conta oficial/);assert.match(html,/Compatibilidades/);
});
test('official creation rejects test connection, wrong seller and test account',async()=>{
 for(const f of [api(undefined,{requireTestUser:true}),api({id:999,site_id:'MLB',tags:[]}),api({id:123,site_id:'MLB',tags:['test_user']})]){
 await assert.rejects(f.service.createOfficialListing({kind:'official',sellerId:'123',payload:{}},'123'));assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
 }
});
test('official preparation rejects unsupported freight and blocking validation',async()=>{
 const f=api();f.draft.shipping.mode='me1';await assert.rejects(f.service.prepareOfficial(f.draft,'123'),/envio/);
 f.draft.shipping.mode='me2';f.draft.validation={ok:false,outcome:'rejected'};await assert.rejects(f.service.prepareOfficial(f.draft,'123'),/pendências/);
 f.draft.validation={ok:false,outcome:'warnings_only'};assert.equal((await f.service.prepareOfficial(f.draft,'123')).kind,'official');
});
test('official mutations refuse foreign item ownership',async()=>{
 const f=api();await assert.rejects(f.service.pauseOfficialListing('MLB1234','123'));await assert.rejects(f.service.describeOfficialListing('MLB1234','123','text'));assert.equal(f.calls.filter(c=>c.method!=='GET').length,0);
});
