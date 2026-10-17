// Count distinct listing IDs across the full catalog before searching or paginating.
export function uniqueListings(rows){
 if(rows.some(r=>r.error))return {rows:[],incomplete:true};
 const skuSet=r=>[...new Set((r.skus||[]).map(s=>String(s).trim()).filter(Boolean))];
 const owners=new Map();for(const r of rows)for(const sku of skuSet(r)){if(!owners.has(sku))owners.set(sku,new Set());owners.get(sku).add(r.id);}
 const seen=new Set();const result=rows.filter(r=>{if(seen.has(r.id))return false;seen.add(r.id);const skus=skuSet(r);return skus.length>0&&skus.every(s=>owners.get(s).size===1);});
 const date=r=>Number.isFinite(Date.parse(r.created))?Date.parse(r.created):Infinity;
 return {rows:result.sort((a,b)=>date(a)-date(b)||a.id.localeCompare(b.id)),incomplete:false};
}
