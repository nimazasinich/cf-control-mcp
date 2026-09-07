export function preLoginLoadingHtml(): string {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DreamWorker — Loading</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;font-family:Inter,"Segoe UI",system-ui,sans-serif;color:#0b2354;background:#eef6fb}.viewport{width:100vw;height:100vh;display:grid;place-items:center}.stage{position:relative;width:1368px;height:753px;overflow:hidden;display:grid;place-items:center;background:radial-gradient(500px 260px at 50% 34%,rgba(42,151,235,.12),transparent 70%),linear-gradient(180deg,#fbfdff,#f3f9fd)}@media(max-width:1368px),(max-height:753px){.stage{transform:scale(min(calc(100vw / 1368),calc(100vh / 753)))}}.card{position:relative;width:610px;padding:44px 54px 40px;text-align:center;border:1px solid #dbe8f3;border-radius:20px;background:rgba(255,255,255,.93);box-shadow:0 28px 78px rgba(35,70,110,.14)}.brand{display:inline-flex;align-items:center;gap:10px}.brand svg{width:44px;height:44px}.brand b{display:block;text-align:left;font-size:17px}.brand span{display:block;text-align:left;font-size:9px;color:#7c90b5}.orbit{position:relative;width:112px;height:112px;margin:28px auto 20px;border-radius:50%;background:conic-gradient(#2b79ef,#2fb5df,#39cdaa,#2b79ef);animation:spin 1.25s linear infinite;box-shadow:0 14px 35px rgba(44,137,204,.18)}.orbit:before{content:"";position:absolute;inset:8px;border-radius:50%;background:#fbfdff}.core{position:absolute;inset:0;display:grid;place-items:center;z-index:2}.core svg{width:35px;height:35px;stroke:#2582df;fill:none;stroke-width:1.6;animation:counter 1.25s linear infinite}.card h1{margin:0;font-size:25px;letter-spacing:-.6px}.card p{margin:9px 0 24px;color:#6f83ad;font-size:11px}.track{height:5px;border-radius:99px;background:#e5edf5;overflow:hidden}.fill{height:100%;width:15%;border-radius:inherit;background:linear-gradient(90deg,#2b79ef,#2fb5df,#39cdaa);transition:width .35s cubic-bezier(.2,.8,.2,1)}.meta{display:flex;justify-content:space-between;margin-top:8px;font-size:8px;color:#8093b5}.secure{margin:22px auto 0;padding:10px;border:1px solid #e1eaf3;border-radius:9px;background:#f8fbfe;color:#6d82aa;font-size:8px}.wave{position:absolute;left:0;right:0;bottom:0;height:210px;opacity:.45}@keyframes spin{to{transform:rotate(360deg)}}@keyframes counter{to{transform:rotate(-360deg)}}
</style></head><body><div class="viewport"><main class="stage"><section class="card"><div class="brand"><svg viewBox="0 0 48 48" fill="none"><defs><linearGradient id="g" x1="4" y1="4" x2="44" y2="44"><stop stop-color="#2b79ef"/><stop offset=".55" stop-color="#25bfe7"/><stop offset="1" stop-color="#3bd1b8"/></linearGradient></defs><path d="M8 11.5 24 4l16 7.5v14.8c0 7.5-5.9 13.3-16 17.7C13.9 39.6 8 33.8 8 26.3Z" stroke="url(#g)" stroke-width="2.6"/><path d="M15 25.7 21.2 32 34 18.8" stroke="url(#g)" stroke-width="3" stroke-linecap="round"/></svg><div><b>DreamWorker</b><span>MCP Control Plane</span></div></div><div class="orbit"><div class="core"><svg viewBox="0 0 24 24"><path d="M12 3v4m0 10v4M3 12h4m10 0h4M5.6 5.6l2.8 2.8m7.2 7.2 2.8 2.8m0-12.8-2.8 2.8m-7.2 7.2-2.8 2.8"/></svg></div></div><h1 id="loading-heading">Initializing Control Plane...</h1><p id="loading-sub">Connecting to Cloudflare Worker runtime...</p><div class="track"><div id="loading-fill" class="fill"></div></div><div class="meta"><span id="loading-status">Checking Worker status...</span><b>DreamWorker</b></div><div id="loading-error" class="secure" style="display:none;color:#b3261e;background:#fdeeed;border-color:#f8c8c5"></div><div id="loading-disclaimer" class="secure">Validating cryptographic session and control plane readiness.</div></section><svg class="wave" viewBox="0 0 1368 210" preserveAspectRatio="none"><path d="M0 140C230 60 360 190 580 118s340-35 520 28 190 18 268-10" fill="none" stroke="#43b9e3"/><path d="M0 174c220-60 380 55 590 8s350-30 530 16 190 4 248-8" fill="none" stroke="#63d1bc"/></svg></main></div><script>(async function(){
  var h1=document.getElementById('loading-heading'),sub=document.getElementById('loading-sub'),status=document.getElementById('loading-status'),fill=document.getElementById('loading-fill'),errBox=document.getElementById('loading-error'),disc=document.getElementById('loading-disclaimer');
  function setStage(pct,text,subtext){if(fill)fill.style.width=pct+'%';if(status)status.textContent=text;if(sub&&subtext)sub.textContent=subtext;}
  function showError(msg){if(fill)fill.style.background='#e53935';if(h1)h1.textContent='Service Unavailable';if(status)status.textContent='Connection failed';if(sub)sub.textContent='The Cloudflare Worker or backend service is unreachable.';if(errBox){errBox.style.display='block';errBox.textContent=msg;}if(disc)disc.style.display='none';}
  var startTime=Date.now(),MIN_DELAY_MS=1200;
  try{
    setStage(25,'Initializing Control Plane...','Validating worker runtime environment...');
    var checkPromise=fetch('/admin/api/overview',{credentials:'same-origin',headers:{'Accept':'application/json'}});
    await new Promise(function(r){setTimeout(r,400);});
    setStage(60,'Checking Worker status...','Querying Cloudflare edge node...');
    var res=await checkPromise;
    await new Promise(function(r){setTimeout(r,400);});
    setStage(85,'Loading secure session...','Validating session credentials...');
    var elapsed=Date.now()-startTime;
    if(elapsed<MIN_DELAY_MS){await new Promise(function(r){setTimeout(r,MIN_DELAY_MS-elapsed);});}
    if(res.status===200){
      setStage(100,'Session verified','Session active. Entering control plane...');
      setTimeout(function(){window.location.replace('/admin');},180);
    }else if(res.status===401){
      setStage(100,'Authentication required','Redirecting to login...');
      setTimeout(function(){window.location.replace('/admin/login');},180);
    }else{
      var errorText=await res.text().catch(function(){return '';});
      showError('Worker returned HTTP '+res.status+'. '+(errorText.slice(0,100)||''));
    }
  }catch(err){
    showError('Service unavailable: '+(err.message||'Network error'));
  }
})();</script></body></html>`;
}
