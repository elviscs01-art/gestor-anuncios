export function editorLink(raw,itemId,productId){
 try{const u=new URL(raw);if(u.protocol==='https:'&&u.hostname==='www.mercadolivre.com.br'&&!u.username&&!u.password&&!u.port&&(u.pathname.startsWith('/syi/')||u.pathname.startsWith('/publicaciones/')||u.pathname.startsWith('/anuncios/'))&&[itemId,productId].filter(Boolean).some(id=>u.href.includes(id)))return u.href;}catch{}
 return 'https://www.mercadolivre.com.br/syi/core/modify?itemId='+encodeURIComponent(itemId);
}
export function qualityData(data,item){
 const expected=item.user_product_id||item.id;
 if(data.entity_id!==expected)throw new Error('Identificação da avaliação divergente');
 const score=typeof data.score==='number'&&Number.isFinite(data.score)&&data.score>=0&&data.score<=100?data.score:null;
 const actions=(data.buckets||[]).flatMap(b=>(b.variables||[]).flatMap(v=>(v.rules||[]).filter(r=>r.status==='PENDING').map(r=>r.wordings))).filter(Boolean);
 return {score,userProductId:item.user_product_id||null,level:String(data.level_wording||data.level||''),calculatedAt:data.calculated_at||null,scope:item.user_product_id?'Produto':'Anúncio',editUrl:editorLink(actions.find(a=>a.link)?.link,item.id,item.user_product_id)};
}
export function qualityRows(rows,q=''){
 const search=q.trim().toLowerCase();return rows.filter(r=>!search||[r.id,r.title,...r.skus||[]].some(s=>String(s).toLowerCase().includes(search))).slice().sort((a,b)=>(a.score??Infinity)-(b.score??Infinity)||a.id.localeCompare(b.id));
}
