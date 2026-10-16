(()=>{
 'use strict';
 const filters=document.getElementById('diagnostic-filters');
 if(!filters)return;
 const progress=document.getElementById('diagnostic-progress'),results=document.getElementById('diagnostic-results'),errorBox=document.getElementById('diagnostic-error');
 const csrf=document.querySelector('input[name="csrf"]')?.value||'';
 let query=new URLSearchParams(location.search);query.delete('auto');let applied=query.toString();
 let epoch=0,serial=0,lastProgress=0,lastResults=0,auto=false,stepBusy=false,controlBusy=false,timer;
 const message=text=>{errorBox.textContent=text;};
 function apply(data,q,id,generation){
  if(generation!==epoch)return;
  if(id>=lastProgress){lastProgress=id;if(progress.innerHTML!==data.progressHtml)progress.innerHTML=data.progressHtml;}
  if(q===applied&&id>=lastResults){lastResults=id;if(results.innerHTML!==data.resultsHtml)results.innerHTML=data.resultsHtml;}
 }
 async function request(path,{method='GET',body,q=applied}={}){
  const id=++serial,generation=epoch,controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),190000);
  try{
   const response=await fetch(path+(q?'?'+q:''),{method,credentials:'same-origin',redirect:'follow',headers:{Accept:'application/json',...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(method==='POST'?{body:new URLSearchParams({csrf,...body})}:{}),signal:controller.signal});
   if(response.status===401||!response.headers.get('content-type')?.includes('application/json'))throw Error('Sua sessão pode ter expirado. Entre novamente no aplicativo.');
   const data=await response.json();if(!response.ok)throw Error(data.error||'Não foi possível atualizar o diagnóstico.');
   if(typeof data.progressHtml!=='string'||typeof data.resultsHtml!=='string')throw Error('Resposta inesperada. Reabra o diagnóstico para conferir o progresso.');
   apply(data,q,id,generation);return {data,generation};
  }catch(e){if(e.name==='AbortError')throw Error('A consulta demorou mais que o esperado. Clique em Continuar diagnóstico para conferir o progresso salvo.');throw e;}
  finally{clearTimeout(timeout);}
 }
 function schedule(){clearTimeout(timer);if(auto&&!stepBusy&&!controlBusy)timer=setTimeout(step,700);}
 async function step(){
  if(!auto||stepBusy||controlBusy)return;
  stepBusy=true;const stepEpoch=epoch;
  try{
   const {data,generation}=await request('/metricas/avancar',{method:'POST'});
   if(generation===epoch){auto=data.status==='running';if(!auto)await request('/metricas/dados');}
  }catch(e){if(stepEpoch===epoch){auto=false;message(e.message);recovery();}}
  finally{stepBusy=false;schedule();}
 }
 function recovery(){
  if(!progress.querySelector('[data-retry]')){
   const button=document.createElement('button');button.type='button';button.dataset.retry='1';button.textContent='Continuar diagnóstico';button.className='secondary';progress.append(button);
  }
 }
 document.addEventListener('submit',async event=>{
  const form=event.target;
  if(form===filters){
   event.preventDefault();
   applied=new URLSearchParams(new FormData(filters)).toString();
   history.replaceState(null,'','/metricas?'+applied);
   const button=filters.querySelector('button');button.disabled=true;message('');
   try{await request('/metricas/dados');}catch(e){message(e.message);}finally{button.disabled=false;}
   return;
  }
  if(!form.matches('[data-diagnostic-action]'))return;
  event.preventDefault();if(controlBusy)return;
  controlBusy=true;auto=false;clearTimeout(timer);epoch++;message('');
  const path=new URL(form.action).pathname;
  for(const button of progress.querySelectorAll('button'))button.disabled=true;
  if(path==='/metricas/iniciar'||path==='/metricas/retomar'){
   progress.innerHTML='<div class="diag-load"><button disabled><span class="diag-spinner" aria-hidden="true"></span>Preparando diagnóstico…</button></div><progress class="diag-progress" max="100" aria-label="Preparando diagnóstico"></progress>';
  }
  try{const {data,generation}=await request(path,{method:'POST'});if(generation===epoch)auto=data.status==='running';}
  catch(e){message(e.message);recovery();}
  finally{controlBusy=false;schedule();}
 });
 document.addEventListener('click',async event=>{
  const copy=event.target.closest('[data-copy]');
  if(copy){
   const status=document.getElementById('diagnostic-copy-status'),text=copy.dataset.copy;
   try{
    if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);
    else{const input=document.createElement('textarea');input.value=text;input.style.position='fixed';input.style.opacity='0';document.body.append(input);input.select();const ok=document.execCommand('copy');input.remove();if(!ok)throw Error('copy');copy.focus();}
    status.textContent='Copiado: '+text;
   }catch{status.textContent='Não foi possível copiar automaticamente. Selecione o código e copie pelo teclado.';}
   return;
  }
  const link=event.target.closest('[data-diagnostic-page]');
  if(link){
   event.preventDefault();applied=new URL(link.href).searchParams.toString();history.replaceState(null,'','/metricas?'+applied);message('');
   try{await request('/metricas/dados');}catch(e){message(e.message);}
   return;
  }
  if(event.target.closest('[data-retry]')){
   if(controlBusy||stepBusy)return;epoch++;message('');
   try{const {data}=await request('/metricas/dados');auto=data.status==='running';schedule();}catch(e){message(e.message);}
  }
 });
 window.addEventListener('pagehide',()=>{auto=false;clearTimeout(timer);});
 request('/metricas/dados').then(({data,generation})=>{if(generation===epoch){auto=data.status==='running';schedule();}}).catch(e=>{message(e.message);recovery();});
})();
