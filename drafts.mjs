import {UserError} from './security.mjs';
export const writable = a => !a.tags?.read_only && !a.tags?.inferred;
const text = a => a?.values?.length>1 ? a.values.map(v=>v.name||'').join('; ') : String(a?.value_name??a?.values?.[0]?.name??'');
export function makeDraft(result,category,schema){
 const {item,profile,description,compatibility}=result;
 if(item.variations?.length)throw new UserError('Este primeiro formulário aceita anúncios sem variações. Escolha um anúncio simples para começar.',409);
 if(!Array.isArray(schema)||!category?.id||category.id!==item.category_id)throw new UserError('Não foi possível obter a ficha técnica da categoria.',502);
 const definitions=schema.filter(writable);
 const originals=Object.fromEntries((item.attributes||[]).map(a=>[a.id,a]));
 const attrs={};for(const a of definitions)attrs[a.id]=text(originals[a.id]);
 const pictures=(item.pictures||[]).filter(p=>typeof p.id==='string').map(p=>({id:p.id,url:pictureUrl(p.secure_url||p.url)}));
 return {sourceId:item.id,sellerId:String(profile.id),categoryId:item.category_id,categoryName:category.name||item.category_id,
 mode:profile.tags?.includes('user_product_seller')||item.family_name?'family':'title',schema:definitions,categorySettings:category.settings||{},originals,pictures,
 descriptionError:description.error||'',compatibilityCount:compatibility.data?.products?.length??null,compatibilityError:compatibility.error||'',
 officialStoreId:item.official_store_id??null,shipping:shippingFields(item.shipping),
 values:{name:item.family_name||item.title||'',price:String(item.price??''),quantity:'',condition:item.condition||'new',listingType:item.listing_type_id||'gold_special',description:description.data?.plain_text||'',attributes:attrs,pictureIds:pictures.map(p=>p.id),
 warrantyType:text(item.sale_terms?.find(a=>a.id==='WARRANTY_TYPE')),warrantyTime:text(item.sale_terms?.find(a=>a.id==='WARRANTY_TIME'))},validation:null};
}
export function pictureUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='mlstatic.com'||u.hostname.endsWith('.mlstatic.com'))?u.href:'';}catch{return '';}}
function shippingFields(s){if(!s)return undefined;const result={};if(['me1','me2','custom','not_specified'].includes(s.mode))result.mode=s.mode;if(typeof s.free_shipping==='boolean')result.free_shipping=s.free_shipping;if(typeof s.local_pick_up==='boolean')result.local_pick_up=s.local_pick_up;return result;}
export function applyForm(draft,form){
 const value=(name,max=500)=>{const v=String(form.get(name)||'').trim();if(v.length>max)throw new UserError('Um campo excedeu o tamanho permitido. Reduza o texto e tente novamente.');return v;};
 const attributes={};for(const a of draft.schema)attributes[a.id]=value('attr:'+a.id,2000);
 const pictureIds=[...new Set(form.getAll('picture').map(String))];
 if(pictureIds.some(id=>!draft.pictures.some(p=>p.id===id)))throw new UserError('Foto inválida para este rascunho.');
 return {...draft,validation:null,values:{name:value('name',200),price:value('price',30),quantity:value('quantity',12),condition:value('condition',30),listingType:value('listingType',40),description:value('description',50000),warrantyType:value('warrantyType',200),warrantyTime:value('warrantyTime',200),attributes,pictureIds}};
}
export function preparePayload(draft,schema=draft.schema,categorySettings=draft.categorySettings){
 const v=draft.values,issues=[];
 if(!v.name)issues.push('Preencha o nome do produto.');
 if(draft.mode==='title'&&v.name.length>(categorySettings.max_title_length||60))issues.push('O título ultrapassa o tamanho permitido para a categoria.');
 if(!/^\d+(?:[.,]\d{1,2})?$/.test(v.price)||Number(v.price.replace(',','.'))<=0)issues.push('Informe um preço maior que zero, como 329,00, sem separador de milhar.');
 if(!/^\d+$/.test(v.quantity)||!Number.isSafeInteger(Number(v.quantity))||Number(v.quantity)<1)issues.push('Informe uma quantidade inteira maior que zero para o novo anúncio.');
 if(!['new','used','not_specified'].includes(v.condition))issues.push('Selecione uma condição válida.');
 if(!['gold_special','gold_pro'].includes(v.listingType))issues.push('Selecione Clássico ou Premium.');
 if(!v.pictureIds.length)issues.push('Selecione pelo menos uma foto.');
 const attributes=[];
 for(const a of schema.filter(writable)){
  const value=String(v.attributes[a.id]||'').trim();
  if(!value){if(a.tags?.required||(a.tags?.new_required&&v.condition==='new'))issues.push('Preencha o atributo: '+(a.name||a.id)+'.');continue;}
  const original=draft.originals[a.id];
  if(original&&value===text(original)){
   if(original.values?.length>1)attributes.push({id:a.id,values:original.values.map(x=>({...x.id?{id:x.id}:{},...x.name?{name:x.name}:{}}))});
   else attributes.push({id:a.id,...original.value_id!=null?{value_id:String(original.value_id)}:{value_name:value}});
  }else{
   const option=a.values?.find(x=>x.name===value);
   attributes.push({id:a.id,...option?{value_id:String(option.id)}:{value_name:value}});
  }
 }
 const payload={category_id:draft.categoryId,currency_id:'BRL',price:Number(v.price.replace(',','.')),available_quantity:Number(v.quantity),buying_mode:'buy_it_now',listing_type_id:v.listingType,condition:v.condition,pictures:v.pictureIds.map(id=>({id})),attributes};
 payload[draft.mode==='family'?'family_name':'title']=v.name;
 if(draft.officialStoreId!=null)payload.official_store_id=draft.officialStoreId;
 if(draft.shipping&&Object.keys(draft.shipping).length)payload.shipping=draft.shipping;
 const sale_terms=[];if(v.warrantyType)sale_terms.push({id:'WARRANTY_TYPE',value_name:v.warrantyType});if(v.warrantyTime)sale_terms.push({id:'WARRANTY_TIME',value_name:v.warrantyTime});if(sale_terms.length)payload.sale_terms=sale_terms;
 return {payload,issues};
}
