import test from 'node:test';
import assert from 'node:assert/strict';
import {range,dateKey,summarize,reputation,createOverview} from './overview.mjs';
import {page,catalogContent} from './overview-views.mjs';
import {createMeli} from './meli.mjs';
import {vault} from './security.mjs';
const at=Date.parse('2026-10-16T15:00:00Z');
test('calendar windows and sales use Brasilia date and paid product amounts only',()=>{
 assert.equal(dateKey('2026-10-16T02:59:59Z'),'2026-10-15');assert.equal(range(at).from,'2026-09-17T03:00:00.000Z');
 const s=summarize({...range(at),rows:[{created:'2026-10-16T02:00:00Z',status:'paid',grossCents:10025,units:2},{created:'2026-10-16T05:00:00Z',status:'cancelled',grossCents:9000,units:1}]},7);
 assert.equal(s.cents,10025);assert.equal(s.orders,1);assert.equal(s.units,2);assert.equal(s.statuses.cancelled,1);assert.equal(s.buckets.at(-2).cents,10025);assert.equal(s.buckets.at(-1).cents,0);
});
function memory(){let job;return {read:async()=>structuredClone(job),start:async(o,data)=>{if(job?.status!=='running')job={status:'running',data,snapshot:job?.snapshot};},claim:async()=>job?.status==='running'?{data:structuredClone(job.data),token:'t'}:null,save:async(o,t,data,status,message)=>{job={...job,data,status,message,...status==='complete'?{snapshot:structuredClone(data)}:{}};}};}
test('summary scans every order page, preserves previous snapshot on a failed refresh',async()=>{
 const db=memory();let fail=false,calls=[];
 const service=createOverview({db,now:()=>at,meli:{metricsProfile:async()=>({id:1}),dashboardOrders:async(o,p)=>{if(p.cancelledOnly)return {total:0,rows:[]};calls.push(p.offset);if(fail)throw Error();return {total:2,rows:[{id:String(p.offset),status:'paid',shipment:null}]};}}});
 await service.start('1');await service.advance('1');assert.equal((await db.read()).snapshot,undefined);await service.advance('1');await service.advance('1');await service.advance('1');assert.equal((await db.read()).snapshot.rows.length,2);assert.deepEqual(calls,[0,1]);
 fail=true;await service.start('1');await service.advance('1');assert.equal((await db.read()).status,'failed');assert.equal((await db.read()).snapshot.rows.length,2);
});
test('incomplete and repeated pages cannot produce a complete summary',async()=>{
 for(const repeated of [true,false]){const db=memory();const service=createOverview({db,now:()=>at,meli:{metricsProfile:async()=>({id:1}),dashboardOrders:async()=>({total:2,rows:repeated?[{id:'1'}]:[]})}});await service.start('1');await service.advance('1');if(repeated)await service.advance('1');assert.equal((await db.read()).status,'failed');assert.equal((await db.read()).snapshot,undefined);}
});
test('catalog retains unavailable items and reads all scan pages',async()=>{
 const db=memory(),service=createOverview({db,kind:'catalog',now:()=>at,meli:{metricsProfile:async()=>({id:1}),metricsScan:async(o,c)=>c?{ids:[],done:true,total:2}:{ids:['MLB1','MLB2'],cursor:'x',done:false,total:2},catalogItem:async id=>{if(id==='MLB2')throw Error();return {id,status:'active'};}}});await service.start('1');for(let i=0;i<3;i++)await service.advance('1');const job=await db.read();assert.equal(job.status,'complete');assert.equal(job.snapshot.rows.length,2);assert.ok(job.snapshot.rows[1].error);
});
function api(reply){const crypto=vault('long-test-key-never-for-deployment'),calls=[];const service=createMeli({now:()=>at,crypto,store:{withConnection:async fn=>fn({get:async()=>({status:'ready',expires:at+86400000,encrypted:crypto.seal({access:'test',refresh:'test'})})})},fetcher:async(url,options)=>{calls.push({url,options});return Response.json(await reply(url));}});return {service,calls};}
const order={id:123,seller:{id:1},buyer:{email:'PRIVATE'},status:'paid',date_created:'2026-10-16T10:00:00Z',currency_id:'BRL',order_items:[{item:{title:'Compressor'},unit_price:123.45,quantity:2}],shipping:{id:456}};
test('orders project away customer information, check owner and pagination',async()=>{
 const f=api(()=>({results:[order],paging:{total:1,offset:0}}));const p=await f.service.dashboardOrders('1',range(at));assert.equal(p.rows[0].grossCents,24690);assert.ok(!JSON.stringify(p).includes('PRIVATE'));assert.equal(new URL(f.calls[0].url).searchParams.get('seller'),'1');
 await assert.rejects(f.service.dashboardOrders('2',range(at)),/conta/);
 const bad=api(()=>({results:[order],paging:{total:1,offset:1}}));await assert.rejects(bad.service.dashboardOrders('1',range(at)),/paginação/);
});
test('shipping uses new format, verifies ownership before SLA, skips Full and shipped',async()=>{
 const f=api(url=>url.endsWith('/sla')?{expected_date:'2026-10-16T17:00:00-03:00'}:{id:456,origin:{sender_id:1},status:'ready_to_ship',logistic:{type:'cross_docking'},destination:{address:'PRIVATE'}});
 const result=await f.service.dashboardShipment('456','1');assert.ok(result.deadline);assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.ok(f.calls.every(c=>c.options.headers['x-format-new']==='true'));
 f.calls.length=0;await assert.rejects(f.service.dashboardShipment('456','2'));assert.equal(f.calls.length,1);
 for(const item of [{status:'shipped'},{logistic:{type:'fulfillment'}},{status:'ready_to_ship',substatus:'in_hub'}]){const g=api(()=>({id:456,sender_id:1,...item}));await g.service.dashboardShipment('456','1');assert.equal(g.calls.length,1);}
});
test('missing reputation metrics are unknown, all pages escape account data',()=>{
 const p=reputation({id:1,nickname:'<script>bad</script>'});assert.equal(p.delays.rate,null);
 const html=page({session:{csrf:'test',page:'/'},job:{status:'complete',snapshot:{...range(at),profile:p,rows:[],shipments:[],finishedAt:new Date(at).toISOString()}}});assert.ok(html.includes('&lt;script&gt;bad'));assert.ok(!html.includes('<script>bad'));assert.match(html,/aria-current="page"/);assert.match(html,/60 segundos/);
 const list=catalogContent({snapshot:{rows:[{id:'MLB1',title:'<img>',skus:['abc'],status:'active'}]}},new URLSearchParams('q=abc'));assert.match(list,/&lt;img&gt;/);assert.match(list,/1 anúncios/);
});

test('general orders omit compound status filter; cancelled and paid use explicit single status',async()=>{const f=api(()=>({results:[],paging:{total:0,offset:0}}));await f.service.dashboardOrders('1',range(at));await f.service.dashboardOrders('1',{...range(at),cancelledOnly:true});await f.service.dashboardOrders('1',{...range(at),paidOnly:true});assert.deepEqual(f.calls.map(c=>new URL(c.url).searchParams.get('order.status')),[null,'cancelled','paid']);});
test('overlap across general and cancelled searches does not double-count',async()=>{const db=memory();const service=createOverview({db,now:()=>at,meli:{metricsProfile:async()=>({id:1}),dashboardOrders:async(o,p)=>({total:1,rows:[{id:'1',status:p.cancelledOnly?'cancelled':'paid',shipment:null}]})}});await service.start('1');for(let i=0;i<3;i++)await service.advance('1');const job=await db.read();assert.equal(job.status,'complete');assert.equal(job.snapshot.rows.length,1);assert.equal(job.snapshot.rows[0].status,'cancelled');});
test('HTTP errors identify orders and safe remote error code without leaking response data',async()=>{const crypto=vault('long-test-key-never-for-deployment');const service=createMeli({now:()=>at,crypto,store:{withConnection:async fn=>fn({get:async()=>({status:'ready',expires:at+86400000,encrypted:crypto.seal({access:'test',refresh:'test'})})})},fetcher:async()=>Response.json({error:'invalid_order_status',message:'PRIVATE BUYER TOKEN'},{status:400})});await assert.rejects(service.dashboardOrders('1',range(at)),e=>e.message.includes('Consulta de pedidos')&&e.message.includes('HTTP 400')&&e.message.includes('invalid_order_status')&&!e.message.includes('PRIVATE'));});
