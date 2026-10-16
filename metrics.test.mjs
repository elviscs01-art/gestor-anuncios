import test from 'node:test';
import assert from 'node:assert/strict';
import {classify,selectMetrics,selectDiagnostics,createMetrics,DAY} from './metrics.mjs';
import {createMeli} from './meli.mjs';
import {vault,UserError} from './security.mjs';
import {dashboard} from './metrics-views.mjs';
const at=Date.parse('2026-10-16T15:00:00Z');
const iso=days=>new Date(at-days*DAY).toISOString();
const base={id:'MLB123456',title:'Evaporador',status:'active',created:iso(200),checkedAt:iso(0),sold:10,visits:{total:25},sales:{ok:true,lastPaid:iso(90),from:iso(180)}};
test('inactivity thresholds are cumulative with strict greater than 120',()=>{
 const rows=[29,30,59,60,89,90,120,121].map(n=>({...base,id:'MLB'+n,sales:{...base.sales,lastPaid:iso(n)}}));
 assert.equal(selectMetrics(rows,{filter:'stopped',days:30}).total,7);
 assert.equal(selectMetrics(rows,{filter:'stopped',days:60}).total,5);
 assert.equal(selectMetrics(rows,{filter:'stopped',days:90}).total,3);
 assert.deepEqual(selectMetrics(rows,{filter:'stopped',days:120}).rows.map(r=>r.id),['MLB121']);
});
test('never sold and unavailable orders do not become stopped listings',()=>{
 const never={...base,sold:0,sales:{ok:true,lastPaid:null,from:iso(180)}};
 const failed={...base,sales:{ok:false,error:'403'}};
 assert.equal(classify(never).noSales,true);assert.equal(selectMetrics([never,failed],{filter:'stopped'}).total,0);
 assert.equal(classify({...base,sold:null}).noSales,false);
 assert.equal(classify({...never,sales:base.sales}).noSales,false);
 assert.equal(classify(failed).unavailable,true);
});
test('zero visits needs covered age and no parent, absent data is not zero',()=>{
 const zero={...base,visits:{total:0}};
 assert.equal(classify(zero).neverVisits,true);
 assert.equal(classify({...zero,created:'2020-01-01'}).neverVisits,false);
 assert.equal(classify({...zero,parent:'MLB999'}).neverVisits,false);
 assert.equal(classify({...zero,created:null}).unknownOlderVisits,true);
 assert.equal(classify({...zero,visits:{error:'403'}}).neverVisits,false);
 assert.equal(classify({...zero,visits:{error:'403'}}).unknownOlderVisits,false);
});
test('older sales are a lower bound, never a fabricated last sale date',()=>{
 const r={...base,sales:{ok:true,lastPaid:null,from:iso(180)}};
 assert.equal(classify(r).days,180);assert.equal(classify(r).lowerBound,true);
 assert.equal(selectMetrics([r],{filter:'stopped',days:120}).total,1);
 const newer={...r,created:iso(45)};assert.equal(classify(newer).days,45);
 assert.equal(selectMetrics([newer],{filter:'stopped',days:60}).total,0);
});
test('filters search, status, sort and paginate without changing source',()=>{
 const rows=Array.from({length:102},(_,i)=>({...base,id:'MLB'+i,created:iso(i),status:i===101?'paused':'active'}));
 const copy=structuredClone(rows);
 const result=selectMetrics(rows,{status:'active',sort:'oldest',page:2});
 assert.equal(result.total,101);assert.equal(result.rows.length,50);assert.equal(result.rows[0].id,'MLB50');
 assert.equal(selectMetrics(rows,{q:'mlb101'}).total,1);assert.equal(selectMetrics(rows,{sort:'newest'}).rows[0].id,'MLB0');assert.deepEqual(rows,copy);
});
function apiFixture(overrides={}){
 const crypto=vault('only-a-test-encryption-key-with-long-value');
 const row={user_id:'123',status:'ready',expires:at+DAY,encrypted:crypto.seal({access:'ACCESS',refresh:'REFRESH'})};
 const calls=[];const order={status:'paid',seller:{id:123},date_closed:iso(90),order_items:[{item:{id:base.id}}],buyer:{email:'PRIVATE'}};
 const service=createMeli({now:()=>at,store:{withConnection:async fn=>fn({get:async()=>row})},crypto,baseUrl:'https://app.example',fetcher:async(url,o)=>{
  calls.push({url,...o});assert.equal(o.method,'GET');
  if(url.includes('/users/me'))return Response.json({id:123,site_id:'MLB',tags:[]});
  if(url.includes('/items/search'))return Response.json(overrides.scan===undefined?{results:[base.id],paging:{total:1},scroll_id:'cursor'}:overrides.scan);
  if(url.includes('/items/visits?')){const q=new URL(url).searchParams;return overrides.periodsResponse||Response.json({item_id:base.id,date_from:q.get('date_from'),date_to:q.get('date_to'),total_visits:overrides.periodTotal??7});}
  if(url.includes('/visits/items'))return overrides.visitsResponse||Response.json(overrides.visits===undefined?{[base.id]:0}:overrides.visits);
  if(url.includes('/orders/search'))return overrides.ordersResponse||Response.json(overrides.orders||{results:[order],paging:{total:1},sort:{id:'date_desc'}});
  return Response.json(overrides.item||{id:base.id,seller_id:123,title:'Evaporador',status:'active',date_created:iso(200),sold_quantity:10,parent_item_id:null});
 }});
 return {service,calls,order};
}
test('collector reads private item and paid orders, projecting no customer data',async()=>{
 const f=apiFixture();const result=await f.service.metricsItem(base.id,'123');
 assert.equal(result.sales.lastPaid,iso(90));assert.equal(result.visits.total,0);
 assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.ok(!JSON.stringify(result).includes('buyer'));
 const url=new URL(f.calls.find(c=>c.url.includes('/orders/search')).url);
 assert.equal(url.searchParams.get('item'),base.id);assert.equal(url.searchParams.get('order.status'),'paid');assert.equal(url.searchParams.get('sort'),'date_desc');assert.equal(url.searchParams.get('order.date_closed.from'),iso(180));
});
test('missing visits and denied orders remain unavailable, not zero',async()=>{
 const f=apiFixture({visits:{},ordersResponse:Response.json({error:'forbidden'}, {status:403})});
 const row=await f.service.metricsItem(base.id,'123');
 assert.equal(row.visits.total,undefined);assert.equal(row.sales.ok,false);assert.equal(classify(row).neverVisits,false);assert.equal(classify(row).stopped,false);
});
test('orders must match exact item, owner, paid status and descending sort',async()=>{
 for(const mode of ['foreign','unpaid','wrongItem','unsorted','incomplete']){
  const f=apiFixture();const order=structuredClone(f.order);let data={results:[order],paging:{total:1},sort:{id:'date_desc'}};
  if(mode==='foreign')order.seller.id=999;
  if(mode==='unpaid')order.status='cancelled';
  if(mode==='wrongItem')order.order_items[0].item.id='MLB999';
  if(mode==='unsorted')data.sort.id='date_asc';
  if(mode==='incomplete')data.results=[];
  const row=await apiFixture({orders:data}).service.metricsItem(base.id,'123');assert.equal(row.sales.ok,false,mode);
 }
});
test('empty complete paid-order search records coverage without inventing a date',async()=>{
 const row=await apiFixture({orders:{results:[],paging:{total:0}}}).service.metricsItem(base.id,'123');
 assert.deepEqual(row.sales,{ok:true,lastPaid:null,from:iso(180)});
});
test('foreign item is rejected before visits or orders queries',async()=>{
 const f=apiFixture({item:{id:base.id,seller_id:999}});
 await assert.rejects(f.service.metricsItem(base.id,'123'));assert.equal(f.calls.length,1);
});
test('scan encodes cursor and recognizes terminal null',async()=>{
 const f=apiFixture();assert.equal((await f.service.metricsScan('123','a&b')).cursor,'cursor');
 assert.equal(new URL(f.calls[0].url).searchParams.get('scroll_id'),'a&b');
 assert.equal((await apiFixture({scan:null}).service.metricsScan('123','cursor')).done,true);
 await assert.rejects(apiFixture({scan:{results:[base.id]}}).service.metricsScan('123',null));
});
function memory(){
 let job=null;let generation=0;
 return {get job(){return job;},read:async()=>structuredClone(job),start:async(owner,data)=>{if(job&&['running','paused'].includes(job.status))return;job={status:'running',data:structuredClone(data),snapshot:job?.snapshot};},
 claim:async()=>{if(!job||job.status!=='running'||job.token)return null;job.token=String(++generation);return {token:job.token,data:structuredClone(job.data)};},
 save:async(owner,token,data,status,message)=>{if(job.token!==token||job.status!=='running')return;Object.assign(job,{data:structuredClone(data),status,message,token:null});if(status==='complete')job.snapshot=structuredClone(data);},
 pause:async()=>{job.status='paused';job.token=null;},resume:async()=>{job.status='running';}};
}
test('sync resumes batches, preserves failed item, excludes duplicate pages and locks concurrent steps',async()=>{
 const db=memory();let scans=0,reads=0;
 const meli={metricsProfile:async()=>{},metricsScan:async()=>++scans===1?{ids:['MLB1','MLB1','MLB2','MLB3'],total:3,cursor:'c',done:false}:{ids:[],total:null,done:true},
 metricsItem:async id=>{reads++;await new Promise(r=>setTimeout(r,5));if(id==='MLB2')throw new UserError('Unavailable');return {...base,id};}};
 const service=createMetrics({db,meli,now:()=>at});await service.start('123');await service.advance('123');
 assert.equal(db.job.data.ids.length,3);await service.advance('123');
 await Promise.all([service.advance('123'),service.advance('123')]);assert.equal(reads,2);
 await service.pause('123');await service.advance('123');assert.equal(reads,2);
 await service.resume('123');await service.advance('123');assert.equal(db.job.status,'complete');
 assert.equal(db.job.snapshot.rows.length,3);assert.match(db.job.snapshot.rows[1].error,/Unavailable/);
 await service.start('123');assert.equal(db.job.snapshot.rows.length,3);assert.equal(db.job.data.rows.length,0);
});
test('scan ending early or repeating does not silently claim completeness',async()=>{
 for(const repeat of [true,false]){
 const db=memory();let calls=0;const meli={metricsProfile:async()=>{},metricsScan:async()=>++calls===1?{ids:['MLB1'],total:3,cursor:'c',done:false}:repeat?{ids:['MLB1'],total:3,cursor:'c',done:false}:{ids:[],total:null,done:true}};
 const service=createMetrics({db,meli});await service.start('123');await service.advance('123');await service.advance('123');assert.equal(db.job.status,'failed');assert.equal(db.job.snapshot,undefined);
 }
});
test('stale worker cannot overwrite paused job',async()=>{
 const db=memory();const service=createMetrics({db,meli:{metricsProfile:async()=>{}}});await service.start('123');
 const claim=await db.claim();await service.pause('123');await db.save('123',claim.token,{rows:[]},'complete');assert.equal(db.job.status,'paused');
});
test('dashboard explains partial history and escapes untrusted titles',()=>{
 const row={...base,title:'<script>injection</script>'};
 const job={status:'paused',data:{stage:'items',ids:[row.id,'MLB2'],rows:[row],offset:1,startedAt:iso(0)}};
 const html=dashboard(job,{csrf:'csrf'},new URLSearchParams('filter=stopped&days=90'));
 assert.match(html,/Dados parciais/);assert.match(html,/últimos dois anos/);assert.match(html,/180 dias/);
 assert.ok(!html.includes('<script>injection'));assert.match(html,/&lt;script&gt;/);
});

test('period visit counts use explicit 30/60/90 day windows and preserve lifetime separately',async()=>{
 const f=apiFixture();const r=await f.service.metricsItem(base.id,'123');
 assert.equal(r.visits.total,0);
 for(const days of [30,60,90])assert.deepEqual(r.visitPeriods[days],{total:7,from:iso(days),to:iso(0)});
 assert.equal(f.calls.filter(c=>c.url.includes('/items/visits?')).length,3);
});
test('wrong period coverage, wrong item and invalid counts never become zero visits',async()=>{
 for(const data of [{item_id:base.id,date_from:iso(10),date_to:iso(0),total_visits:0},{item_id:'MLB999',date_from:iso(30),date_to:iso(0),total_visits:0},{item_id:base.id,date_from:iso(30),date_to:iso(0),total_visits:-1}]){
  const f=apiFixture({periodsResponse:Response.json(data)});const r=await f.service.metricsItem(base.id,'123');assert.equal(r.visitPeriods[30].total,undefined);
 }
});
test('SKU extraction preserves distinct variation SKUs and supports search',async()=>{
 const item={id:base.id,seller_id:123,title:'Produto',attributes:[{id:'SELLER_SKU',value_name:'ABC'}],seller_custom_field:'ABC',variations:[{seller_custom_field:'VAR1'},{attributes:[{id:'SELLER_SKU',value_name:'VAR2'}]}]};
 const r=await apiFixture({item}).service.metricsItem(base.id,'123');assert.deepEqual(r.skus,['ABC','VAR1','VAR2']);assert.equal(selectDiagnostics([r],{q:'var2'}).total,1);
});
test('diagnostic period filters intersect and exclude unavailable visits and orders',()=>{
 const r={...base,visitPeriods:{30:{total:0},60:{total:2},90:{total:5}}};
 const recent={...r,id:'MLB2',sales:{...r.sales,lastPaid:iso(10)}};
 assert.equal(selectDiagnostics([r,recent],{visits:'30',sales:'30'}).total,1);
 assert.equal(selectDiagnostics([r],{visits:'60'}).total,0);
 assert.equal(selectDiagnostics([{...r,visitPeriods:undefined}],{visits:'30'}).total,0);
 assert.equal(selectDiagnostics([{...r,sales:{ok:false}}],{sales:'30'}).total,0);
});
test('no sales in period includes new unsold listings with successful covered search',()=>{
 const r={...base,created:iso(10),sold:0,sales:{ok:true,lastPaid:null,from:iso(180)}};
 assert.equal(selectDiagnostics([r],{sales:'30'}).total,1);
 assert.equal(selectDiagnostics([r],{sales:'none'}).total,1);
 assert.equal(selectDiagnostics([{...r,sales:{...r.sales,from:iso(15)}}],{sales:'30'}).total,0);
 assert.equal(selectDiagnostics([{...base,sales:{...base.sales,lastPaid:iso(30)}}],{sales:'30'}).total,0);
});
test('inactive groups known non-active statuses and never unknown data',()=>{
 const rows=['active','paused','closed','under_review','not_yet_active',undefined].map((status,i)=>({...base,id:'MLB'+i,status}));
 assert.equal(selectDiagnostics(rows,{status:'inactive'}).total,4);
 assert.equal(selectDiagnostics(rows,{status:'active'}).total,1);
});
test('diagnostic view has five columns, counts, copy buttons and no minimum table width',()=>{
 const r={...base,skus:['SKU-X'],visitPeriods:{30:{total:7}}};
 const data={stage:'items',ids:[r.id],offset:1,rows:[r],startedAt:iso(0),finishedAt:iso(0)};
 const html=dashboard({status:'complete',data,snapshot:data},{csrf:'csrf'});
 assert.match(html,/Diagnóstico de anúncios/);assert.match(html,/1 anúncio filtrado/);assert.match(html,/data-copy="SKU-X"/);
 assert.ok(!html.includes('min-width:1000px'));assert.ok(!html.includes('data-metrics-auto'));assert.equal((html.match(/<th>/g)||[]).length,5);
});
