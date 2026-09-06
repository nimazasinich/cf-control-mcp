import { ICONS } from "./icons";

function escapeHtmlServer(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

export function loginPageHtml(error?: string): string {
	const safeError = error ? escapeHtmlServer(error) : "";
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>cf-control-mcp — Admin · DreamWorker MCP Control Plane</title>
<style>
:root{--ink:#07123f;--muted:#6075b0;--muted2:#8193c1;--line:#d9e5f3;--line2:#cbd9ee;--blue:#2b79ef;--cyan:#25bfe7;--mint:#3bd1b8;--green:#12b97a;--danger:#db4b61}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:var(--ink);background:#eaf2f8}body{overflow:hidden}button,input{font:inherit}
.viewport{width:100vw;height:100vh;display:grid;place-items:center;background:linear-gradient(180deg,#f4f9fd,#eaf2f8)}
.stage{position:relative;width:1368px;height:753px;overflow:hidden;transform-origin:center;background:radial-gradient(520px 300px at 58% 21%,rgba(104,205,237,.10),transparent 70%),radial-gradient(480px 240px at 79% 12%,rgba(95,206,220,.055),transparent 70%),linear-gradient(180deg,#fbfdff 0%,#f6faff 66%,#fafdff 100%);box-shadow:0 24px 70px rgba(24,55,92,.13)}
@media(max-width:1368px),(max-height:753px){.stage{transform:scale(min(calc(100vw / 1368),calc(100vh / 753)))}}
.brand{position:absolute;left:52px;top:32px;display:flex;align-items:center;gap:12px}.brand-mark{width:42px;height:42px}.brand-mark svg{width:100%;height:100%}.brand-copy strong{display:block;font-size:20px;letter-spacing:-.45px}.brand-copy span{display:block;margin-top:2px;font-size:11px;color:#7387b7}
.login-card{position:absolute;left:76px;top:130px;width:462px;height:490px;padding:34px 30px;z-index:5;border:1px solid rgba(216,229,244,.96);border-radius:15px;background:linear-gradient(145deg,rgba(255,255,255,.96),rgba(255,255,255,.75));box-shadow:0 18px 46px rgba(50,84,126,.08),inset 0 1px 0 rgba(255,255,255,.95);backdrop-filter:blur(8px)}
.login-card h1{margin:0;font-size:35px;line-height:1.03;font-weight:820;letter-spacing:-1.15px}.subtitle{margin:9px 0 30px;font-size:14px;color:#5369ab}.field{margin-bottom:18px}.field label{display:block;margin-bottom:7px;font-size:11px;font-weight:700;color:#16366f}.input-shell{height:45px;border:1px solid var(--line2);border-radius:9px;background:rgba(255,255,255,.72);display:flex;align-items:center;padding:0 12px;transition:.16s ease}.input-shell:focus-within{border-color:#83b3f5;box-shadow:0 0 0 3px rgba(47,119,238,.08)}.input-shell svg{width:18px;height:18px;stroke:#4967ad;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.input-shell input{flex:1;border:0;outline:0;background:transparent;padding:0 10px;font-size:12px;color:#314f91}.eye{width:28px;height:28px;border:0;background:transparent;display:grid;place-items:center;color:#5872ad;cursor:pointer}.signin{width:100%;height:46px;margin-top:6px;border:0;border-radius:9px;color:#fff;background:linear-gradient(90deg,#56a6f4 0%,#50c6df 54%,#58d9bd 100%);box-shadow:0 10px 21px rgba(74,177,222,.16);font-size:13px;font-weight:700;cursor:pointer;transition:.16s}.signin:hover{transform:translateY(-1px);box-shadow:0 13px 24px rgba(74,177,222,.2)}.signin:disabled{opacity:.65;transform:none;cursor:wait}
.feedback{min-height:36px;margin:16px 0 0;padding:9px 11px;border-radius:8px;font-size:11px;display:flex;align-items:center;gap:8px;color:#5b6fa7;background:#f4f8fd;border:1px solid #e1eaf5}.feedback.error{color:#9b2f46;background:#fff4f6;border-color:#f5cbd4}.feedback svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.8}
.security-note{position:absolute;left:628px;top:196px;width:570px}.security-note .eyebrow{font-size:11px;letter-spacing:.13em;text-transform:uppercase;color:#2d7adf;font-weight:800}.security-note h2{margin:11px 0 12px;font-size:34px;line-height:1.08;letter-spacing:-1px}.security-note p{width:500px;margin:0;color:#6479ae;font-size:14px;line-height:1.75}.security-grid{display:grid;grid-template-columns:repeat(2,240px);gap:13px;margin-top:30px}.secure{height:88px;border:1px solid #dce7f3;border-radius:12px;background:rgba(255,255,255,.66);padding:14px;display:flex;gap:12px;box-shadow:0 7px 24px rgba(47,77,115,.04)}.secure .ico{width:32px;height:32px;border-radius:9px;background:#edf7ff;color:#2581df;display:grid;place-items:center}.secure svg{width:17px;height:17px;stroke:currentColor;fill:none;stroke-width:1.8}.secure b{display:block;font-size:12px}.secure span{display:block;margin-top:4px;font-size:10px;line-height:1.45;color:#7084b4}
.wave{position:absolute;left:0;right:0;bottom:28px;height:180px;opacity:.48;pointer-events:none}.footer{position:absolute;left:52px;right:52px;bottom:19px;display:flex;font-size:9px;color:#7387b7}.footer b{color:#166be9}.footer span:last-child{margin-left:auto}
</style>
</head><body>
${ICONS}
<div class="viewport"><div class="stage">
  <div class="brand"><div class="brand-mark"><svg viewBox="0 0 48 48" fill="none"><defs><linearGradient id="lg" x1="4" y1="4" x2="44" y2="44"><stop stop-color="#2b79ef"/><stop offset=".55" stop-color="#25bfe7"/><stop offset="1" stop-color="#3bd1b8"/></linearGradient></defs><path d="M8 11.5 24 4l16 7.5v14.8c0 7.5-5.9 13.3-16 17.7C13.9 39.6 8 33.8 8 26.3Z" stroke="url(#lg)" stroke-width="2.6"/><path d="M15 25.7 21.2 32 34 18.8" stroke="url(#lg)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="brand-copy"><strong>DreamWorker</strong><span>MCP Control Plane</span></div></div>
  <form id="login-form" class="login-card" method="POST" action="/admin/login" novalidate>
    <div class="eyebrow" style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#2d7adf;font-weight:800;margin-bottom:10px">Owner Admin</div>
    <h1>Welcome back</h1><div class="subtitle">Sign in to the production control plane.</div>
    <div class="field"><label for="owner-token">Owner token</label><div class="input-shell"><svg><use href="#i-lock"/></svg><input id="owner-token" type="password" name="token" placeholder="MCP_AUTH_TOKEN" autocomplete="current-password" required autofocus><button id="toggle-password" class="eye" type="button" aria-label="Show token"><svg><use href="#i-eye"/></svg></button></div></div>
    <button id="sign-in" class="signin" type="submit"><span>Sign in</span></button>
    <div class="feedback${safeError ? " error" : ""}" role="status" aria-live="polite"><svg><use href="#${safeError ? "i-alert" : "i-shield"}"/></svg><span>${safeError || "Session cookies are signed server-side. Privileged tokens are never stored in localStorage."}</span></div>
  </form>
  <section class="security-note"><div class="eyebrow">Production access</div><h2>More capable tomorrow,<br>built on truthful runtime state.</h2><p>This sign-in adapts the approved DreamWorker visual language to the existing owner-only authentication flow. No social login is shown because the backend does not expose one.</p><div class="security-grid"><div class="secure"><div class="ico"><svg><use href="#i-shield"/></svg></div><div><b>Owner-only session</b><span>The existing MCP_AUTH_TOKEN-backed session remains authoritative.</span></div></div><div class="secure"><div class="ico"><svg><use href="#i-key"/></svg></div><div><b>No client secret storage</b><span>Credentials stay server-side; privileged tokens are not persisted in the browser.</span></div></div></div></section>
  <svg class="wave" viewBox="0 0 1368 180" preserveAspectRatio="none"><path d="M0 115 C170 40 315 165 495 92S835 55 1030 108 1240 105 1368 62" fill="none" stroke="#43b9e3" stroke-width="1.2"/><path d="M0 137 C210 84 330 154 528 118S870 85 1030 129 1233 129 1368 98" fill="none" stroke="#63d1bc" stroke-width="1"/></svg>
  <div class="footer"><span><b>DreamWorker</b> · cf-control-mcp</span><span>Secure Admin Control Plane</span></div>
</div></div>
<script>
(function(){
  var form=document.getElementById('login-form');
  var token=document.getElementById('owner-token');
  var toggle=document.getElementById('toggle-password');
  var submit=document.getElementById('sign-in');
  toggle.addEventListener('click',function(){var showing=token.type==='text';token.type=showing?'password':'text';toggle.setAttribute('aria-label',showing?'Show token':'Hide token');});
  form.addEventListener('submit',function(e){if(!token.value.trim()){e.preventDefault();token.focus();return;}submit.disabled=true;submit.querySelector('span').textContent='Signing in…';});
})();
</script>
</body></html>`;
}
