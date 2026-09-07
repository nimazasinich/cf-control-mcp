import { readFileSync, writeFileSync } from "node:fs";

const [source, target] = process.argv.slice(2);
if (!source || !target) throw new Error("usage: node scripts/import_canonical_login.mjs <reference.html> <target.ts>");

let html = readFileSync(source, "utf8");
html = html
  .replace("<title>DreamWorker — Login Refined 1368×753</title>", "<title>cf-control-mcp — Admin · DreamWorker MCP Control Plane</title>")
  .replace('<form id="dreamworker-login-form" class="login-card" novalidate>', '<form id="dreamworker-login-form" class="login-card" method="POST" action="/admin/login" novalidate>')
  .replace('<input id="auth-email" type="email" value="admin@dreamworker.ai">', '<input id="auth-email" type="email" value="admin@dreamworker.ai" readonly aria-readonly="true">')
  .replace('<input id="auth-token" type="password" placeholder="••••••••">', '<input id="auth-token" name="token" type="password" placeholder="MCP_AUTH_TOKEN" autocomplete="current-password" required autofocus>')
  .replaceAll('<button class="social" type="button">', '<button class="social" type="button" disabled title="OAuth sign-in is not enabled">')
  .replace('Forgot password?</a>', 'Owner token</a>')
  .replace("Don't have an account? <a href=\"#\" data-ui-link>Contact your administrator</a>", 'Production owner access · MCP_AUTH_TOKEN');

const scriptStart = html.lastIndexOf("<script>");
const scriptEnd = html.lastIndexOf("</script>");
if (scriptStart < 0 || scriptEnd < scriptStart) throw new Error("reference script boundary not found");
html = html.slice(0, scriptStart) + `<script>
(function(){
  const form=document.getElementById('dreamworker-login-form');
  const token=document.getElementById('auth-token');
  const toggle=document.getElementById('toggle-password');
  const submit=document.getElementById('auth-submit');
  const label=submit.querySelector('.signin-label');
  const feedback=document.getElementById('form-feedback');
  const feedbackText=document.getElementById('form-feedback-text');
  const tokenShell=token.closest('.input-shell');
  toggle.addEventListener('click',function(){
    const visible=token.type==='text';
    token.type=visible?'password':'text';
    toggle.setAttribute('aria-label',visible?'Show token':'Hide token');
  });
  token.addEventListener('input',function(){
    tokenShell.classList.toggle('is-valid',!!token.value);
    tokenShell.classList.remove('is-error');
    feedback.className='form-feedback';
    feedbackText.textContent='';
  });
  form.addEventListener('submit',function(event){
    if(!token.value.trim()){
      event.preventDefault();
      tokenShell.classList.add('is-error');
      feedback.className='form-feedback show error';
      feedbackText.textContent='Enter the owner token.';
      token.focus();
      return;
    }
    submit.disabled=true;
    submit.classList.add('is-working');
    label.textContent='Signing in…';
  });
})();
</script>` + html.slice(scriptEnd + "</script>".length);

const module = `const REFERENCE_HTML = ${JSON.stringify(html)};

function escapeHtmlServer(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** Canonical 1368x753 login visual adapted to the real owner-token backend. */
export function loginPageHtml(error?: string): string {
  if (!error) return REFERENCE_HTML;
  const safe = escapeHtmlServer(error);
  return REFERENCE_HTML.replace(
    '<div id="form-feedback" class="form-feedback" role="status" aria-live="polite"><span class="feedback-dot"></span><span id="form-feedback-text"></span></div>',
    '<div id="form-feedback" class="form-feedback show error" role="status" aria-live="polite"><span class="feedback-dot"></span><span id="form-feedback-text">' + safe + '</span></div>',
  );
}
`;
writeFileSync(target, module);
