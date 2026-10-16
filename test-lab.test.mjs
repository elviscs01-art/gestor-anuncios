import test from 'node:test';
import assert from 'node:assert/strict';
import {createLab} from './test-lab.mjs';
import {createMeli} from './meli.mjs';
import {makeDraft} from './drafts.mjs';
import {vault,UserError} from './security.mjs';
function fixture(failure,descriptionFailure=false){
 let row={id:'attempt',owner_id:'real',status:'prepared',test_seller:'123',snapshot:{description:'test'}};let sends=0;
 const db={claimAttempt:async(id,owner)=>{if(id!==row.id||owner!==row.owner_id||row.status!=='prepared')return null;row.status='sending';return structuredClone(row);},attempt:async(id,owner)=>id===row.id&&owner===row.owner_id?row:null,finish:async(id,owner,status,item_id,result)=>{Object.assign(row,{status,item_id,result});}};
 const service={createTestListing:async()=>{sends++;await new Promise(r=>setTimeout(r,5));if(failure)throw failure;return{id:'MLB123',status:'active'};},describeTestListing:async()=>{assert.equal(row.item_id,'MLB123');if(descriptionFailure)throw new Error('timeout');},pauseTestListing:async()=> 'paused'};
 return {lab:createLab({store:{testing:db},test:service}),row, sends:()=>sends};
}
test('double submit and replay create exactly one item, saving ID before description',async()=>{
 const f=fixture();await Promise.all([f.lab.run('attempt','real'),f.lab.run('attempt','real')]);await f.lab.run('attempt','real');
 assert.equal(f.sends(),1);assert.equal(f.row.status,'completed');assert.equal(f.row.result.itemStatus,'paused');
});
test('uncertain creation never replays',async()=>{
 const e=new UserError('timeout');e.uncertain=true;const f=fixture(e);
 await f.lab.run('attempt','real');await f.lab.run('attempt','real');assert.equal(f.sends(),1);assert.equal(f.row.status,'unknown');
});
test('definite rejection is recorded without automatic retry',async()=>{
 const f=fixture(new UserError('HTTP 400'));await f.lab.run('attempt','real');assert.equal(f.row.status,'rejected');await f.lab.run('attempt','real');assert.equal(f.sends(),1);
});
test('description failure retains item ID and still pauses',async()=>{
 const f=fixture(null,true);await f.lab.run('attempt','real');assert.equal(f.row.status,'partial');assert.equal(f.row.item_id,'MLB123');assert.equal(f.row.result.itemStatus,'paused');await f.lab.pause('attempt','real');assert.equal(f.sends(),1);
});
test('attempt ownership prevents another owner from publishing',async()=>{
 const f=fixture();await assert.rejects(f.lab.run('attempt','other'));assert.equal(f.sends(),0);
});
function apiFixture(profile={id:123,site_id:'MLB',tags:['test_user']},requireTestUser=true,fail=false){
 const crypto=vault('a-test-only-long-encryption-key-placeholder');
 let row={user_id:'123',status:'ready',expires:Date.now()+3600000,encrypted:crypto.seal({access:'TEST_TOKEN',refresh:'REFRESH'})};const calls=[];
 const store={expectedSeller:async()=> '123',withConnection:async fn=>fn({get:async()=>row,save:async value=>{row=value;}})};
 const service=createMeli({store,crypto,clientId:'test',clientSecret:'secret',baseUrl:'https://app.example',requireTestUser,fetcher:async(url,o)=>{
 calls.push({url,...o});if(url.endsWith('/users/me'))return Response.json(profile);
 if(o.method==='GET')return Response.json({id:'MLB123',seller_id:999,status:'active'});
 if(fail)throw new Error('timeout');return Response.json({id:'MLB123',seller_id:123,status:'active'});
 }});
 return {service,calls};
}
const snapshot={sellerId:'123',payload:{title:'Item de Teste - Por favor, NAO OFERTAR!',available_quantity:1,listing_type_id:'gold_special'}};
test('main connection cannot publish even with a test-looking payload',async()=>{
 const f=apiFixture(undefined,false);await assert.rejects(f.service.createTestListing(snapshot,'123'));assert.equal(f.calls.length,0);
});
test('test publication requires matching ID, Brazilian site and test_user tag',async()=>{
 for(const profile of [{id:123,site_id:'MLB',tags:[]},{id:999,site_id:'MLB',tags:['test_user']},{id:123,site_id:'MLA',tags:['test_user']}]){
 const f=apiFixture(profile);await assert.rejects(f.service.createTestListing(snapshot,'123'));assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
 }
});
test('test payload cannot use real title or original user product',async()=>{
 for(const payload of [{...snapshot.payload,title:'Real product'},{...snapshot.payload,user_product_id:'123'},{...snapshot.payload,available_quantity:5}]){
 const f=apiFixture();await assert.rejects(f.service.createTestListing({...snapshot,payload},'123'));assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
 }
});
test('uncertain API write is flagged and sent once',async()=>{
 const f=apiFixture(undefined,true,true);await assert.rejects(f.service.createTestListing(snapshot,'123'),e=>e.uncertain===true);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});
test('test connection cannot pause or describe another seller item',async()=>{
 const f=apiFixture();await assert.rejects(f.service.pauseTestListing('MLB123','123'));await assert.rejects(f.service.describeTestListing('MLB123','123','text'));assert.equal(f.calls.filter(c=>c.method!=='GET').length,0);
});

test('preparation uses test profile, independent photos and safe listing fields',async()=>{
 const crypto=vault('a-test-only-long-encryption-key-placeholder');
 const row={user_id:'123',status:'ready',expires:Date.now()+3600000,encrypted:crypto.seal({access:'TEST',refresh:'REFRESH'})};
 const store={expectedSeller:async()=> '123',withConnection:async fn=>fn({get:async()=>row})};
 const category={id:'MLB190954',settings:{}};
 const source=makeDraft({profile:{id:999,tags:[]},item:{id:'MLB999',seller_id:999,category_id:category.id,title:'Original',price:319.15,condition:'new',official_store_id:88,listing_type_id:'gold_pro',shipping:{mode:'me1'},pictures:[{id:'original-photo',secure_url:'https://http2.mlstatic.com/example.jpg'}]},description:{data:{plain_text:'Descrição original'}},compatibility:{}},category,[]);
 const service=createMeli({store,crypto,requireTestUser:true,baseUrl:'https://app.example',fetcher:async url=>{
 if(url.endsWith('/users/me'))return Response.json({id:123,site_id:'MLB',tags:['test_user','user_product_seller'],shipping_modes:['me2']});
 if(url.endsWith('/attributes'))return Response.json([]);return Response.json(category);
 }});
 const prepared=await service.prepareTest(source,'123');
 assert.equal(prepared.sellerId,'123');assert.equal(prepared.payload.title,undefined);
 assert.equal(prepared.payload.family_name,snapshot.payload.title);
 assert.equal(prepared.payload.available_quantity,1);assert.equal(prepared.payload.official_store_id,undefined);
 assert.deepEqual(prepared.payload.pictures,[{source:'https://http2.mlstatic.com/example.jpg'}]);
 assert.equal(prepared.payload.shipping.mode,'me2');assert.match(prepared.description,/Descrição original/);
 assert.equal(source.shipping.mode,'me1');assert.equal(source.values.quantity,'');
});
