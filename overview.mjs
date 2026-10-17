import {recordFailure,errorInfo} from './diagnostics.mjs';
import {UserError} from './security.mjs';
export const day=86400000;
export const dateKey=value=>new Date(Date.parse(value)-3*3600000).toISOString().slice(0,10);
export function range(at){const end=new Date(at).toISOString();const start=new Date(dateKey(end)+'T00:00:00-03:00').getTime()-29*day;return {from:new Date(start).toISOString(),to:end};}
export function reputation(p){
 const r=p.seller_reputation||{},m=r.metrics||{};
 const metric=k=>({rate:Number.isFinite(m[k]?.rate)?m[k].rate:null,value:Number.isFinite(m[k]?.value)?m[k].value:null,period:typeof m[k]?.period==='string'?m[k].period:null});
 return {nickname:String(p.nickname||p.id),level:typeof r.level_id==='string'?r.level_id:null,medal:typeof r.power_seller_status==='string'?r.power_seller_status:null,claims:metric('claims'),cancellations:metric('cancellations'),delays:metric('delayed_handling_time')};
}
export function summarize(data,days=30){
 const endKey=dateKey(data.to),start=new Date(endKey+'T00:00:00-03:00').getTime()-(days-1)*day;
 const buckets=Array.from({length:days},(_,i)=>({date:dateKey(new Date(start+i*day).toISOString()),cents:0,orders:0}));
 const map=new Map(buckets.map(b=>[b.date,b])),statuses={};let cents=0,orders=0,units=0;
 for(const row of data.rows){const b=map.get(dateKey(row.created));if(!b)continue;statuses[row.status]=(statuses[row.status]||0)+1;if(row.status!=='paid')continue;b.cents+=row.grossCents;b.orders++;cents+=row.grossCents;orders++;units+=row.units;}
 return {buckets,statuses,cents,orders,units,ticket:orders?Math.round(cents/orders):0};
}
export function createOverview({db,meli,kind,now=Date.now}){
 const catalog=kind==='catalog'||kind==='quality';
 return {
  read:owner=>db.read(owner),
  async start(owner){const p=await meli.metricsProfile(owner);await db.start(owner,{...range(now()),profile:reputation(p),stage:catalog?'scan':'orders',orderGroup:'general',groupIds:[],ids:[],rows:[],shipments:[],cursor:null,offset:0,total:null,startedAt:new Date(now()).toISOString()});},
  async advance(owner){const job=await db.claim(owner);if(!job)return;const d=job.data;try{
   await meli.metricsProfile(owner);let complete=false;
   if(catalog&&d.stage==='scan'){
    const page=await meli.metricsScan(owner,d.cursor),known=new Set(d.ids),fresh=page.ids.filter(id=>!known.has(id));
    if(page.ids.length&&!fresh.length)throw new UserError('Listagem repetida. Atualize novamente.',502);
    d.ids.push(...new Set(fresh));if(page.total!==null)d.total=page.total;
    if(d.ids.length>100000)throw new UserError('Limite de 100 mil anúncios por consulta atingido.',409);
    if(page.done){if(d.total!==null&&d.ids.length<d.total)throw new UserError('Lista incompleta. Atualize novamente.',502);d.stage='items';}else d.cursor=page.cursor;
   }else if(catalog){
    const ids=d.ids.slice(d.offset,d.offset+5);
    d.rows.push(...await Promise.all(ids.map(async id=>{try{return await (kind==='quality'?meli.qualityItem(id,owner):meli.catalogItem(id,owner));}catch{return {id,error:'Informações indisponíveis. Atualize para tentar novamente.'};}})));d.offset+=ids.length;complete=d.offset===d.ids.length;
   }else if(d.stage==='orders'){
    const page=await meli.dashboardOrders(owner,{from:d.from,to:d.to,offset:d.offset,cancelledOnly:d.orderGroup==='cancelled'});
    if(page.total>10000)throw new UserError('Mais de 10 mil pedidos no período. Este volume requer uma coleta por intervalos menores; o resumo anterior foi mantido.',409);
    const seen=new Set(d.groupIds||d.rows.map(r=>r.id));for(const row of page.rows){if(seen.has(row.id))throw new UserError('As vendas mudaram durante a consulta. Atualize novamente para obter um resumo consistente.',409);seen.add(row.id);}
    if(d.total!==null&&page.total!==d.total)throw new UserError('O total de pedidos mudou durante a consulta. Atualize novamente.',409);
    d.total=page.total;d.groupIds=[...seen];const existing=new Map(d.rows.map(r=>[r.id,r]));for(const row of page.rows)existing.set(row.id,row);d.rows=[...existing.values()];d.offset+=page.rows.length;
    if(d.offset>d.total||(!page.rows.length&&d.offset<d.total))throw new UserError('O histórico retornou incompleto. Atualize novamente.',502);
    if(d.offset===d.total&&d.orderGroup!=='cancelled'){d.orderGroup='cancelled';d.offset=0;d.total=null;d.groupIds=[];}
    else if(d.offset===d.total){d.stage='shipments';d.ids=[...new Set(d.rows.filter(r=>r.status==='paid'&&r.shipment).sort((a,b)=>Date.parse(b.created)-Date.parse(a.created)).map(r=>r.shipment))].slice(0,12);d.offset=0;}
   }else{
    const ids=d.ids.slice(d.offset,d.offset+2);
    d.shipments.push(...await Promise.all(ids.map(async id=>{try{return await meli.dashboardShipment(id,owner);}catch{return {id,error:'Consulta de envio indisponível.'};}})));d.offset+=ids.length;complete=d.offset===d.ids.length;
   }
   if(complete)d.finishedAt=new Date(now()).toISOString();await db.save(owner,job.token,d,complete?'complete':'running');
  }catch(e){await recordFailure('collection:'+kind,{operation:'collection.'+kind,stage:d.stage,...errorInfo(e)});await db.save(owner,job.token,d,'failed',e instanceof UserError?e.message:'Não foi possível atualizar. Tente novamente; o último resumo completo foi mantido.');}}
 };
}
