(()=>{
 const root=document.querySelector('#overview');if(!root)return;
 const kind=root.dataset.kind,base=kind==='catalog'?'/anuncios':'/painel',csrf=document.querySelector('[name="csrf"]').value;
 const button=document.querySelector('#overview-refresh'),error=document.querySelector('#overview-error');let status=root.dataset.status,busy=false,stopped=false;
 const params=new URLSearchParams(location.search);
 async function request(path,post=false){const response=await fetch(base+path+'?'+params,{method:post?'POST':'GET',credentials:'same-origin',headers:{Accept:'application/json',...(post?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(post?{body:new URLSearchParams({csrf})}:{}),signal:AbortSignal.timeout(180000)});const data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível atualizar. Tente novamente.');return data;}
 function render(data){status=data.status;document.querySelector('#overview-progress').innerHTML=data.progress;document.querySelector('#overview-content').innerHTML=data.html;button.disabled=status==='running';}
 async function run(start=false){if(busy||stopped)return;busy=true;button.disabled=true;error.textContent='';try{if(start)render(await request('/iniciar',true));while(status==='running'&&!stopped){render(await request('/avancar',true));if(status==='running')await new Promise(r=>setTimeout(r,800));}}catch(e){error.textContent=e.message||'Conexão interrompida. Clique em atualizar para retomar.';}finally{busy=false;button.disabled=false;}}
 button.addEventListener('click',()=>run(true));
 async function filter(){if(busy)return;busy=true;try{render(await request('/dados'));history.replaceState(null,'',location.pathname+'?'+params);}catch(e){error.textContent=e.message;}finally{busy=false;}}
 document.querySelector('#catalog-filter')?.addEventListener('submit',event=>{event.preventDefault();if(busy)return;const f=new FormData(event.target);params.set('q',f.get('q'));params.set('status',f.get('status'));params.set('page','1');filter();});
 document.querySelector('#overview-content').addEventListener('click',event=>{const b=event.target.closest('[data-page]');if(b&&!busy){params.set('page',b.dataset.page);filter();}});
 document.querySelector('#overview-content').addEventListener('change',event=>{if(event.target.id==='sales-days'&&!busy){params.set('days',event.target.value);filter();}});
 const form=document.querySelector('#catalog-filter');if(form){form.elements.q.value=params.get('q')||'';form.elements.status.value=params.get('status')||'all';}
 let liveBusy=false;setInterval(async()=>{if(kind!=='dashboard'||document.hidden||busy||liveBusy||!document.querySelector('#recent-sales'))return;liveBusy=true;try{const data=await request('/vendas');document.querySelector('#recent-sales').innerHTML=data.html;}catch{const box=document.querySelector('#recent-sales');if(box&&!box.querySelector('[data-live-error]'))box.insertAdjacentHTML('afterbegin','<p class="notice" data-live-error>Atualização automática indisponível. Os dados abaixo são da última consulta bem-sucedida.</p>');}finally{liveBusy=false;}},60000);
 addEventListener('pagehide',()=>{stopped=true;});
 if(root.dataset.ready==='true'&&(status==='running'||status==='empty'))run(status==='empty');
})();
