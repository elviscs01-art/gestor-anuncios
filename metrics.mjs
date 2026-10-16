import {UserError} from './security.mjs';
export const DAY=86400000;
export function classify(row){
 const at=Date.parse(row.checkedAt),created=Date.parse(row.created);
 const last=Date.parse(row.sales?.lastPaid);
 const sold=Number.isSafeInteger(row.sold)&&row.sold>=0?row.sold:null;
 const twoYears=new Date(at);twoYears.setUTCFullYear(twoYears.getUTCFullYear()-2);
 const knownVisits=Number.isSafeInteger(row.visits?.total)&&row.visits.total>=0;
 const neverVisits=knownVisits&&row.visits.total===0&&Number.isFinite(created)&&created>=twoYears.getTime()&&created<=at&&!row.parent;
 const noSales=sold===0&&!row.sales?.lastPaid;
 const since=Number.isFinite(last)?last:Math.max(Date.parse(row.sales?.from),created);
 const inactiveDays=Number.isFinite(since)&&Number.isFinite(at)?Math.max(0,(at-since)/DAY):null;
 const stopped=sold!==null&&sold>0&&row.sales?.ok===true&&inactiveDays!==null;
 return {neverVisits,unknownOlderVisits:knownVisits&&row.visits.total===0&&!neverVisits,noSales,stopped,days:inactiveDays,lowerBound:!Number.isFinite(last),unavailable:!!row.error||!knownVisits||sold===null||row.sales?.ok!==true};
}
export function selectMetrics(rows,{filter='all',days=30,status='all',sort='oldest',q='',page=1}={}){
 if(!['all','never_visits','older_visits','never_sales','stopped','unavailable'].includes(filter))filter='all';
 days=[30,60,90,120].includes(Number(days))?Number(days):30;
 if(!['all','active','paused','closed','under_review'].includes(status))status='all';
 q=String(q).trim().toLocaleLowerCase('pt-BR').slice(0,120);
 let selected=rows.filter(r=>{
 const c=classify(r);
 return (status==='all'||r.status===status)&&(!q||(r.id+' '+(r.title||'')).toLocaleLowerCase('pt-BR').includes(q))&&
 (filter==='all'||filter==='never_visits'&&c.neverVisits||filter==='older_visits'&&c.unknownOlderVisits||filter==='never_sales'&&c.noSales||filter==='unavailable'&&c.unavailable||filter==='stopped'&&c.stopped&&(days===120?c.days>120:c.days>=days));
 });
 selected.sort((a,b)=>{
  const ta=Date.parse(a.created),tb=Date.parse(b.created);
  const av=Number.isFinite(ta)?ta:Infinity,bv=Number.isFinite(tb)?tb:Infinity;
  return (sort==='newest'?(Number.isFinite(tb)?tb:-Infinity)-(Number.isFinite(ta)?ta:-Infinity):av-bv)||a.id.localeCompare(b.id);
 });
 const total=selected.length,pages=Math.max(1,Math.ceil(total/50));page=Math.min(pages,Math.max(1,Number.parseInt(page,10)||1));
 return {rows:selected.slice((page-1)*50,page*50),total,pages,page,filter,days,status,sort:sort==='newest'?'newest':'oldest',q};
}
export function createMetrics({db,meli,now=Date.now}){
 return {
  async read(owner){return db.read(owner);},
  async start(owner){await meli.metricsProfile(owner);return db.start(owner,{stage:'scan',ids:[],rows:[],cursor:null,offset:0,startedAt:new Date(now()).toISOString(),scanTotal:null});},
  async pause(owner){return db.pause(owner);},
  async resume(owner){return db.resume(owner);},
  async advance(owner){
   const job=await db.claim(owner);if(!job)return;
   let data=job.data;
   try{
    await meli.metricsProfile(owner);
    if(data.stage==='scan'){
     const page=await meli.metricsScan(owner,data.cursor);
     const known=new Set(data.ids);const fresh=[...new Set(page.ids)].filter(id=>!known.has(id));
     if(page.ids.length&&!fresh.length)throw new UserError('A listagem retornou uma página repetida. Inicie uma nova atualização.',502);
     data.ids.push(...fresh);if(page.total!==null)data.scanTotal=page.total;
     if(data.ids.length>100000)throw new UserError('A conta excedeu o limite de 100 mil anúncios desta versão.',409);
     if(page.done){if(data.scanTotal!==null&&data.ids.length<data.scanTotal)throw new UserError('A listagem terminou antes de retornar todos os anúncios. Inicie uma nova atualização.',502);data.stage='items';data.cursor=null;}else data.cursor=page.cursor;
    }else{
     const ids=data.ids.slice(data.offset,data.offset+2);
     const rows=await Promise.all(ids.map(async id=>{
      try{return await meli.metricsItem(id,owner);}
      catch(e){return {id,checkedAt:new Date(now()).toISOString(),error:e instanceof UserError?e.message:'Consulta indisponível.'};}
     }));
     data.rows.push(...rows);data.offset+=ids.length;
    }
    const done=data.stage==='items'&&data.offset===data.ids.length;
    if(done)data.finishedAt=new Date(now()).toISOString();
    await db.save(owner,job.token,data,done?'complete':'running');
   }catch(e){
    await db.save(owner,job.token,data,'failed',e instanceof UserError?e.message:'A atualização foi interrompida. Os dados já coletados foram preservados.');
   }
  }
 };
}

export function selectDiagnostics(rows,params={}){
 const visits=['all','30','60','90','none'].includes(String(params.visits))?String(params.visits):'all';
 const sales=['all','30','60','90','120','none'].includes(String(params.sales))?String(params.sales):'all';
 const status=['all','active','inactive'].includes(params.status)?params.status:'all';
 const sort=params.sort==='newest'?'newest':'oldest',q=String(params.q||'').trim().slice(0,120).toLocaleLowerCase('pt-BR');
 let selected=rows.filter(row=>{
  if(status==='active'&&row.status!=='active')return false;
  if(status==='inactive'&&(!row.status||row.status==='active'||row.status==='não informado'))return false;
  if(q&&![row.id,row.title,...(row.skus||[])].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR').includes(q))return false;
  if(visits==='none'&&row.visits?.total!==0)return false;
  if(!['all','none'].includes(visits)&&row.visitPeriods?.[visits]?.total!==0)return false;
  if(sales==='none'&&!classify(row).noSales)return false;
  if(!['all','none'].includes(sales)){
   if(row.sales?.ok!==true)return false;
   const cutoff=Date.parse(row.checkedAt)-Number(sales)*DAY,last=Date.parse(row.sales.lastPaid),from=Date.parse(row.sales.from);
   if(!Number.isFinite(cutoff))return false;
   if(Number.isFinite(last)){if(last>=cutoff)return false;}
   else if(!Number.isFinite(from)||from>cutoff)return false;
  }
  return true;
 });
 selected.sort((a,b)=>{
  const aDate=Date.parse(a.created),bDate=Date.parse(b.created);
  if(!Number.isFinite(aDate)&&!Number.isFinite(bDate))return a.id.localeCompare(b.id);
  if(!Number.isFinite(aDate))return 1;if(!Number.isFinite(bDate))return -1;
  return (sort==='oldest'?aDate-bDate:bDate-aDate)||a.id.localeCompare(b.id);
 });
 const total=selected.length,pages=Math.max(1,Math.ceil(total/50)),page=Math.min(pages,Math.max(1,Number.parseInt(params.page,10)||1));
 return {rows:selected.slice((page-1)*50,page*50),total,pages,page,visits,sales,status,sort,q};
}
