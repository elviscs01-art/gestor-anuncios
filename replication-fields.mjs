export const packageFields=[['height','Altura','cm'],['width','Largura','cm'],['length','Comprimento','cm'],['weight','Peso','g']];
export const packageId=key=>'SELLER_PACKAGE_'+key.toUpperCase();
export const titleLimit=source=>Math.min(60,Number(source.maxTitle)>0?Number(source.maxTitle):60);
export function priceValue(raw){
 const s=String(raw??'').trim();let n;
 if(/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(s))n=Number(s.replaceAll('.','').replace(',','.'));
 else if(/^\d+\.\d{1,2}$/.test(s))n=Number(s);
 return Number.isFinite(n)&&n>0&&Number.isSafeInteger(Math.round(n*100))?Math.round(n*100)/100:null;
}
export function packageValue(attribute,key){
 if(!attribute||String(attribute.value_id)==='-1')return '';
 const structured=attribute.value_struct||attribute.values?.[0]?.struct;
 const raw=structured?String(structured.number)+' '+structured.unit:String(attribute.value_name??attribute.values?.[0]?.name??'');
 const match=raw.trim().match(/^(\d+(?:[.,]\d+)?)\s*(cm|mm|m|kg|g)?$/i);if(!match)return '';
 const unit=(match[2]||(key==='weight'?'g':'cm')).toLowerCase(),factor=(key==='weight'?{g:1,kg:1000}:{cm:1,mm:.1,m:100})[unit];
 const n=Number(match[1].replace(',','.'))*factor;return Number.isSafeInteger(n)&&n>0?String(n):'';
}
export function readPackaging(item){
 const packed={};const legacy=String(item.shipping?.dimensions||'').match(/^(\d+)x(\d+)x(\d+),(\d+)$/);
 packageFields.forEach(([key],i)=>{const a=(item.attributes||[]).find(a=>a.id===packageId(key));const invalidExplicit=a&&String(a.value_id)==='-1';packed[key]=packageValue(a,key)||(!invalidExplicit&&legacy&&Number(legacy[i+1])>0?legacy[i+1]:'');});return packed;
}
export function applyPackaging(source,values){
 const copy=structuredClone(source),errors={};const required=copy.payload.shipping?.mode==='me2';
 const provided=packageFields.some(([k])=>String(values?.[k]??'').trim());
 if(required||provided){for(const [key,label] of packageFields){const v=String(values?.[key]??'').trim();if(!/^\d+$/.test(v)||!Number.isSafeInteger(Number(v))||Number(v)<1)errors['package_'+key]='Informe '+label.toLowerCase()+' em número inteiro maior que zero.';}}
 if(Object.keys(errors).length)return {source:copy,errors};
 if(provided&&copy.payload.shipping?.mode==='me1'){copy.packaging={...values};copy.payload.shipping.dimensions=[values.height,values.width,values.length].map(Number).join('x')+','+Number(values.weight);return {source:copy,errors};}
 if(provided){copy.packaging={...values};copy.payload.attributes=copy.payload.attributes.filter(a=>!packageFields.some(([key])=>a.id===packageId(key)));for(const [key,,unit] of packageFields)copy.payload.attributes.push({id:packageId(key),value_name:Number(values[key])+' '+unit});}
 return {source:copy,errors};
}

export function kgToGrams(raw){const m=String(raw??'').trim().match(/^(\d+)(?:[.,](\d{1,3}))?$/);if(!m)return '';const n=Number(m[1])*1000+Number((m[2]||'').padEnd(3,'0'));return Number.isSafeInteger(n)&&n>0?String(n):'';}
export function gramsToKg(raw){return /^\d+$/.test(String(raw))&&Number(raw)>0?String(Number(raw)/1000).replace('.',','):'';}
