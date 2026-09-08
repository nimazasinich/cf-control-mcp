
import tkinter as tk
from tkinter import ttk, scrolledtext
import os, subprocess, json, urllib.request, urllib.error

URL="https://cf-control-mcp.amin-chinisaz-edu.workers.dev/v1/chat/completions"

def load_dotenv():
    env={}
    p=os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            line=line.strip()
            if line and not line.startswith("#") and "=" in line:
                k,v=line.split("=",1)
                env[k.strip()]=v.strip().strip('"')
                os.environ[k.strip()]=v.strip().strip('"')
    return env

cfg=load_dotenv()

def run_verify():
    log.insert("end","\n=== Production Acceptance ===\n")
    try:
        p=subprocess.run(
            ["python","scripts/verify_production.py"],
            cwd=os.path.dirname(__file__),
            capture_output=True,
            text=True,
            env=os.environ
        )
        log.insert("end",p.stdout)
        log.insert("end",p.stderr)
    except Exception as e:
        log.insert("end",f"ERROR {e}\n")

def test_chat():
    log.insert("end","\n=== Chat Test ===\n")
    token=os.environ.get("GATEWAY_AUTH_TOKEN")
    if not token:
        log.insert("end","Missing GATEWAY_AUTH_TOKEN in .env\n")
        return
    body=json.dumps({
        "model":"fast",
        "messages":[{"role":"user","content":"ping"}]
    }).encode()

    req=urllib.request.Request(
        URL,
        data=body,
        headers={
            "Authorization":"Bearer "+token,
            "Content-Type":"application/json"
        }
    )
    try:
        with urllib.request.urlopen(req,timeout=30) as r:
            log.insert("end",f"HTTP {r.status}\n")
            log.insert("end",r.read().decode(errors="ignore"))
    except urllib.error.HTTPError as e:
        log.insert("end",f"HTTP ERROR {e.code}\n")
        log.insert("end",e.read().decode(errors="ignore"))
    except Exception as e:
        log.insert("end",f"ERROR {e}\n")

root=tk.Tk()
root.title("cf-control-mcp One Click Acceptance")
root.geometry("900x600")

ttk.Label(
    root,
    text="cf-control-mcp Production Acceptance",
    font=("Segoe UI",18,"bold")
).pack(pady=12)

status=ttk.Label(root,text="Loaded .env: "+("YES" if cfg else "NO"))
status.pack()

ttk.Button(root,text="RUN FULL VERIFICATION",command=run_verify).pack(pady=8)
ttk.Button(root,text="TEST /v1/chat/completions",command=test_chat).pack(pady=8)

log=scrolledtext.ScrolledText(root,height=25)
log.pack(fill="both",expand=True,padx=10,pady=10)

root.mainloop()
