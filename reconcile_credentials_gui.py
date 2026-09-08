#!/usr/bin/env python3
"""Modern Tkinter operator UI for scripts/reconcile_credentials.py.

No secret values are rendered by this UI. It only passes the selected .env path
to the reconciler, which performs its own redaction and fail-closed checks.
"""
from __future__ import annotations

import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from tkinter.scrolledtext import ScrolledText

APP_TITLE = "cf-control-mcp · Credential Reconciler v1.4"
DEFAULT_BRANCH = "main"
DEFAULT_REPO = "nimazasinich/cf-control-mcp"

BG = "#f3f6fb"
SURFACE = "#ffffff"
SURFACE_ALT = "#eef3f9"
TEXT = "#162033"
MUTED = "#637083"
BORDER = "#d8e1ec"
ACCENT = "#315cf4"
ACCENT_HOVER = "#244bd3"
SUCCESS = "#16855b"
WARNING = "#b87314"
DANGER = "#c93e45"
LOG_BG = "#0f1725"
LOG_FG = "#d8e5f5"


class ReconcileApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title(APP_TITLE)
        self.geometry("1320x820")
        self.minsize(1080, 700)
        self.configure(bg=BG)
        self.option_add("*Font", ("Segoe UI", 10))

        self.root_dir = Path(__file__).resolve().parent
        self.script_path = self.root_dir / "scripts" / "reconcile_credentials.py"
        self.proc: subprocess.Popen[str] | None = None
        self.output_q: queue.Queue[tuple[str, str | int | None]] = queue.Queue()

        self._configure_style()
        self._vars()
        self._build()
        self._append_log(
            "Credential Reconciler UI ready.\n"
            "1) Confirm Project root and Full-secret .env on the left.\n"
            "2) Click Audit only first.\n"
            "3) Use Apply + verify only after the audit gates are acceptable.\n\n",
            "muted",
        )
        self.after(80, self._pump_queue)
        self.after(200, self.run_preflight)

    def _configure_style(self) -> None:
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("TFrame", background=BG)
        style.configure("Surface.TFrame", background=SURFACE)
        style.configure("Alt.TFrame", background=SURFACE_ALT)
        style.configure("TLabel", background=BG, foreground=TEXT)
        style.configure("Surface.TLabel", background=SURFACE, foreground=TEXT)
        style.configure("Muted.Surface.TLabel", background=SURFACE, foreground=MUTED)
        style.configure("Title.TLabel", background=BG, foreground=TEXT, font=("Segoe UI Semibold", 20))
        style.configure("Subtitle.TLabel", background=BG, foreground=MUTED, font=("Segoe UI", 10))
        style.configure("CardTitle.TLabel", background=SURFACE, foreground=TEXT, font=("Segoe UI Semibold", 11))
        style.configure("Success.Surface.TLabel", background=SURFACE, foreground=SUCCESS, font=("Segoe UI Semibold", 10))
        style.configure("Warning.Surface.TLabel", background=SURFACE, foreground=WARNING, font=("Segoe UI Semibold", 10))
        style.configure("Danger.Surface.TLabel", background=SURFACE, foreground=DANGER, font=("Segoe UI Semibold", 10))
        style.configure("TEntry", fieldbackground="#fbfdff", foreground=TEXT, bordercolor=BORDER, lightcolor=BORDER, darkcolor=BORDER, padding=7)
        style.configure("TCombobox", fieldbackground="#fbfdff", foreground=TEXT, padding=6)
        style.configure("TCheckbutton", background=SURFACE, foreground=TEXT)
        style.map("TCheckbutton", background=[("active", SURFACE)])
        style.configure("Primary.TButton", background=ACCENT, foreground="#ffffff", borderwidth=0, padding=(16, 10), font=("Segoe UI Semibold", 10))
        style.map("Primary.TButton", background=[("active", ACCENT_HOVER), ("disabled", "#aab7d5")])
        style.configure("Secondary.TButton", background="#e8eef8", foreground=TEXT, borderwidth=0, padding=(14, 9))
        style.map("Secondary.TButton", background=[("active", "#dbe5f3")])
        style.configure("Danger.TButton", background="#fce8ea", foreground=DANGER, borderwidth=0, padding=(14, 9))
        style.map("Danger.TButton", background=[("active", "#f8d9dc")])
        style.configure("TNotebook", background=BG, borderwidth=0)
        style.configure("TNotebook.Tab", padding=(15, 8), background="#e7edf6", foreground=MUTED)
        style.map("TNotebook.Tab", background=[("selected", SURFACE)], foreground=[("selected", TEXT)])
        style.configure("Horizontal.TProgressbar", troughcolor="#e4eaf3", background=ACCENT, bordercolor="#e4eaf3", lightcolor=ACCENT, darkcolor=ACCENT)

    def _vars(self) -> None:
        default_env = self.root_dir / "cf-control-mcp.env.full-secrets"
        self.env_var = tk.StringVar(value=str(default_env if default_env.exists() else self.root_dir / ".env"))
        self.branch_var = tk.StringVar(value=DEFAULT_BRANCH)
        self.repo_var = tk.StringVar(value=DEFAULT_REPO)
        self.repo_root_var = tk.StringVar(value=str(self.root_dir))
        self.apex_account_var = tk.StringVar(value="")
        self.patch_var = tk.BooleanVar(value=True)
        self.dispatch_var = tk.BooleanVar(value=True)
        self.wait_var = tk.BooleanVar(value=True)
        self.runner_pat_var = tk.BooleanVar(value=False)
        self.skip_google_var = tk.BooleanVar(value=False)
        self.status_var = tk.StringVar(value="Ready")
        self.summary_var = tk.StringVar(value="No run yet")
        self.preflight_var = tk.StringVar(value="Checking local tools…")

    def _card(self, parent: tk.Widget, title: str) -> tk.Frame:
        """Create a visible bordered card and return its content container.

        The previous implementation returned the inner frame before the outer border
        frame was ever managed by pack/grid, which made every control card invisible.
        This version returns the *outer* card while exposing ``card.content`` as the
        managed content area. Callers can pack the card and add widgets to content.
        """
        outer = tk.Frame(parent, bg=BORDER, bd=0, highlightthickness=0)
        inner = ttk.Frame(outer, style="Surface.TFrame", padding=16)
        inner.pack(fill="both", expand=True, padx=1, pady=1)
        ttk.Label(inner, text=title, style="CardTitle.TLabel").pack(anchor="w", pady=(0, 12))
        outer.content = inner  # type: ignore[attr-defined]
        return outer

    def _build(self) -> None:
        header = ttk.Frame(self, padding=(24, 18, 24, 10))
        header.pack(fill="x")
        left_h = ttk.Frame(header)
        left_h.pack(side="left", fill="x", expand=True)
        ttk.Label(left_h, text="Credential Reconciler", style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            left_h,
            text="Live audit → safe canonicalization → Worker secret sync → branch-aware workflow migration → production verify",
            style="Subtitle.TLabel",
        ).pack(anchor="w", pady=(3, 0))

        status_box = ttk.Frame(header)
        status_box.pack(side="right")
        self.status_pill = tk.Label(status_box, textvariable=self.status_var, bg="#e7edf6", fg=TEXT, padx=14, pady=7, font=("Segoe UI Semibold", 9))
        self.status_pill.pack()

        body = ttk.Frame(self, padding=(24, 4, 24, 22))
        body.pack(fill="both", expand=True)
        body.columnconfigure(0, weight=0, minsize=390)
        body.columnconfigure(1, weight=1)
        body.rowconfigure(0, weight=1)

        # Scrollable control column: keeps every action visible on Windows when
        # display scaling is 125%/150% or the window is shorter than expected.
        controls_shell = ttk.Frame(body)
        controls_shell.grid(row=0, column=0, sticky="nsew", padx=(0, 16))
        controls_shell.rowconfigure(0, weight=1)
        controls_shell.columnconfigure(0, weight=1)

        controls_canvas = tk.Canvas(
            controls_shell, bg=BG, highlightthickness=0, bd=0, width=405
        )
        controls_scroll = ttk.Scrollbar(controls_shell, orient="vertical", command=controls_canvas.yview)
        controls_canvas.configure(yscrollcommand=controls_scroll.set)
        controls_canvas.grid(row=0, column=0, sticky="nsew")
        controls_scroll.grid(row=0, column=1, sticky="ns")

        controls = ttk.Frame(controls_canvas)
        controls_window = controls_canvas.create_window((0, 0), window=controls, anchor="nw")

        def _sync_controls_scroll(_event=None) -> None:
            controls_canvas.configure(scrollregion=controls_canvas.bbox("all"))

        def _sync_controls_width(event) -> None:
            controls_canvas.itemconfigure(controls_window, width=max(380, event.width))

        controls.bind("<Configure>", _sync_controls_scroll)
        controls_canvas.bind("<Configure>", _sync_controls_width)

        def _wheel(event) -> None:
            delta = -1 if event.delta > 0 else 1
            controls_canvas.yview_scroll(delta * 3, "units")

        controls_canvas.bind("<Enter>", lambda _e: controls_canvas.bind_all("<MouseWheel>", _wheel))
        controls_canvas.bind("<Leave>", lambda _e: controls_canvas.unbind_all("<MouseWheel>"))

        project = self._card(controls, "Project & secret source")
        project.pack(fill="x", pady=(0, 12))
        project_c = project.content  # type: ignore[attr-defined]
        self._labeled_path(project_c, "Project root", self.repo_root_var, self.choose_root)
        self._labeled_path(project_c, "Full-secret .env", self.env_var, self.choose_env)
        self._labeled_entry(project_c, "Repository", self.repo_var)
        self._labeled_entry(project_c, "Target branch", self.branch_var)

        actions = self._card(controls, "Actions")
        actions.pack(fill="x", pady=(0, 12))
        actions_c = actions.content  # type: ignore[attr-defined]
        row = ttk.Frame(actions_c, style="Surface.TFrame")
        row.pack(fill="x")
        self.audit_btn = ttk.Button(row, text="Audit only", style="Secondary.TButton", command=lambda: self.start_run(False))
        self.audit_btn.pack(side="left", fill="x", expand=True, padx=(0, 7))
        self.apply_btn = ttk.Button(row, text="Apply + verify", style="Primary.TButton", command=lambda: self.start_run(True))
        self.apply_btn.pack(side="left", fill="x", expand=True)
        row2 = ttk.Frame(actions_c, style="Surface.TFrame")
        row2.pack(fill="x", pady=(8, 0))
        ttk.Button(row2, text="Preflight", style="Secondary.TButton", command=self.run_preflight).pack(side="left", fill="x", expand=True, padx=(0, 7))
        self.stop_btn = ttk.Button(row2, text="Stop", style="Danger.TButton", command=self.stop_run, state="disabled")
        self.stop_btn.pack(side="left", fill="x", expand=True)
        self.progress = ttk.Progressbar(actions_c, mode="indeterminate")
        self.progress.pack(fill="x", pady=(12, 4))
        ttk.Label(actions_c, textvariable=self.preflight_var, style="Muted.Surface.TLabel", wraplength=340).pack(anchor="w", pady=(5, 0))

        options = self._card(controls, "Run options")
        options.pack(fill="x", pady=(0, 12))
        options_c = options.content  # type: ignore[attr-defined]
        for text, var in [
            ("Patch workflows with canonical + legacy fallback", self.patch_var),
            ("Dispatch verify-only.yml after apply", self.dispatch_var),
            ("Wait for GitHub Actions result", self.wait_var),
            ("Migrate exact local runner PAT to canonical name", self.runner_pat_var),
            ("Skip direct Google AI Studio key check", self.skip_google_var),
        ]:
            ttk.Checkbutton(options_c, text=text, variable=var).pack(anchor="w", pady=3)
        ttk.Label(options_c, text="Optional APEX account ID (only used to prove APEX token scope)", style="Muted.Surface.TLabel").pack(anchor="w", pady=(9, 4))
        ttk.Entry(options_c, textvariable=self.apex_account_var).pack(fill="x")

        summary = self._card(controls, "Last result")
        summary.pack(fill="x")
        summary_c = summary.content  # type: ignore[attr-defined]
        ttk.Label(summary_c, textvariable=self.summary_var, style="Muted.Surface.TLabel", wraplength=340, justify="left").pack(anchor="w")

        right = ttk.Frame(body)
        right.grid(row=0, column=1, sticky="nsew")
        right.rowconfigure(0, weight=1)
        right.columnconfigure(0, weight=1)
        notebook = ttk.Notebook(right)
        notebook.grid(row=0, column=0, sticky="nsew")

        log_tab = ttk.Frame(notebook, style="Surface.TFrame", padding=12)
        files_tab = ttk.Frame(notebook, style="Surface.TFrame", padding=18)
        notebook.add(log_tab, text="Live log")
        notebook.add(files_tab, text="Reports & outputs")

        self.log = ScrolledText(
            log_tab,
            bg=LOG_BG,
            fg=LOG_FG,
            insertbackground="#ffffff",
            selectbackground="#304763",
            relief="flat",
            borderwidth=0,
            font=("Cascadia Mono", 9),
            padx=12,
            pady=12,
            wrap="word",
        )
        self.log.pack(fill="both", expand=True)
        self.log.tag_config("success", foreground="#65d7a4")
        self.log.tag_config("warning", foreground="#ffd27a")
        self.log.tag_config("error", foreground="#ff8f97")
        self.log.tag_config("muted", foreground="#8da1b8")

        ttk.Label(files_tab, text="Generated locally after a run", style="CardTitle.TLabel").pack(anchor="w")
        ttk.Label(
            files_tab,
            text="The reconciler writes a full-secret runtime .env plus redacted JSON/Markdown audit reports into the project root.",
            style="Muted.Surface.TLabel",
            wraplength=720,
            justify="left",
        ).pack(anchor="w", pady=(5, 18))

        outputs = [
            ("Runtime tested env", "cf-control-mcp.env.runtime-tested"),
            ("Markdown audit", "credential-reconcile-report.md"),
            ("JSON audit", "credential-reconcile-report.json"),
        ]
        for label, filename in outputs:
            frame = tk.Frame(files_tab, bg=BORDER)
            frame.pack(fill="x", pady=5)
            inner = ttk.Frame(frame, style="Surface.TFrame", padding=(13, 10))
            inner.pack(fill="x", padx=1, pady=1)
            ttk.Label(inner, text=label, style="Surface.TLabel", font=("Segoe UI Semibold", 10)).pack(side="left")
            ttk.Label(inner, text=filename, style="Muted.Surface.TLabel").pack(side="left", padx=(12, 0))
            ttk.Button(inner, text="Open", style="Secondary.TButton", command=lambda f=filename: self.open_output(f)).pack(side="right")

        btns = ttk.Frame(files_tab, style="Surface.TFrame")
        btns.pack(fill="x", pady=(16, 0))
        ttk.Button(btns, text="Open project folder", style="Secondary.TButton", command=self.open_project_folder).pack(side="left")
        ttk.Button(btns, text="Clear log", style="Secondary.TButton", command=self.clear_log).pack(side="left", padx=(8, 0))

        footer = ttk.Frame(self, padding=(24, 0, 24, 12))
        footer.pack(fill="x")
        ttk.Label(
            footer,
            text="Safety: no automatic legacy-secret deletion or revocation · no secret values intentionally rendered in UI logs",
            style="Subtitle.TLabel",
        ).pack(anchor="w")

    def _labeled_entry(self, parent: ttk.Frame, label: str, var: tk.StringVar) -> None:
        ttk.Label(parent, text=label, style="Muted.Surface.TLabel").pack(anchor="w", pady=(5, 4))
        ttk.Entry(parent, textvariable=var).pack(fill="x")

    def _labeled_path(self, parent: ttk.Frame, label: str, var: tk.StringVar, command) -> None:
        ttk.Label(parent, text=label, style="Muted.Surface.TLabel").pack(anchor="w", pady=(5, 4))
        line = ttk.Frame(parent, style="Surface.TFrame")
        line.pack(fill="x")
        ttk.Entry(line, textvariable=var).pack(side="left", fill="x", expand=True)
        ttk.Button(line, text="Browse", style="Secondary.TButton", command=command).pack(side="left", padx=(7, 0))

    def choose_env(self) -> None:
        value = filedialog.askopenfilename(
            title="Select full-secret environment file",
            initialdir=self.repo_root_var.get() or str(self.root_dir),
            filetypes=[("Environment files", "*.env*"), ("All files", "*.*")],
        )
        if value:
            self.env_var.set(value)

    def choose_root(self) -> None:
        value = filedialog.askdirectory(title="Select cf-control-mcp project root", initialdir=self.repo_root_var.get() or str(self.root_dir))
        if value:
            self.repo_root_var.set(value)
            possible = Path(value) / "cf-control-mcp.env.full-secrets"
            if possible.exists():
                self.env_var.set(str(possible))

    def run_preflight(self) -> None:
        def work() -> None:
            checks = []
            for tool in ("git", "node", "npm", "npx"):
                path = shutil.which(tool)
                checks.append(f"{tool}={'OK' if path else 'MISSING'}")
            checks.append(f"python={sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")
            checks.append(f"reconciler={'OK' if self.script_path.exists() else 'MISSING'}")
            checks.append(f"env={'OK' if Path(self.env_var.get()).exists() else 'MISSING'}")
            try:
                import nacl  # noqa: F401
                checks.append("PyNaCl=OK")
            except Exception:
                checks.append("PyNaCl=MISSING (required only when updating GitHub secrets)")
            self.output_q.put(("preflight", " · ".join(checks)))
        threading.Thread(target=work, daemon=True).start()

    def _build_command(self, apply: bool) -> list[str]:
        root = Path(self.repo_root_var.get()).resolve()
        script = root / "scripts" / "reconcile_credentials.py"
        if not script.exists():
            script = self.script_path
        cmd = [
            sys.executable,
            str(script),
            "--env-file", self.env_var.get(),
            "--repo-root", str(root),
            "--repo", self.repo_var.get().strip() or DEFAULT_REPO,
            "--target-branch", self.branch_var.get().strip() or DEFAULT_BRANCH,
        ]
        if self.skip_google_var.get():
            cmd.append("--skip-google-direct")
        if apply:
            cmd.append("--apply")
            if self.patch_var.get():
                cmd.append("--patch-workflows")
            if self.dispatch_var.get():
                cmd.append("--dispatch-verify")
            if self.wait_var.get():
                cmd.append("--wait-actions")
            if self.runner_pat_var.get():
                cmd.append("--migrate-runner-pat")
            apex = self.apex_account_var.get().strip()
            if apex:
                cmd += ["--apex-account-id", apex]
        return cmd

    def start_run(self, apply: bool) -> None:
        if self.proc and self.proc.poll() is None:
            messagebox.showinfo(APP_TITLE, "A reconciliation process is already running.")
            return
        env_path = Path(self.env_var.get())
        root_path = Path(self.repo_root_var.get())
        if not env_path.exists():
            messagebox.showerror(APP_TITLE, f"Environment file not found:\n{env_path}")
            return
        if not root_path.exists():
            messagebox.showerror(APP_TITLE, f"Project root not found:\n{root_path}")
            return
        if apply:
            ok = messagebox.askyesno(
                APP_TITLE,
                "Apply mode will perform safe remote mutations: install Worker CF_AIG_TOKEN, sync canonical GitHub secret/variables, optionally patch/push workflows, and dispatch production verification.\n\nLegacy secrets will NOT be deleted. Continue?",
            )
            if not ok:
                return
        self.clear_log()
        self._set_running(True, "Applying + verifying…" if apply else "Auditing…")
        cmd = self._build_command(apply)
        self._append_log("Starting command (secret values are not part of CLI arguments):\n", "muted")
        self._append_log(" ".join(self._safe_cli(cmd)) + "\n\n", "muted")
        threading.Thread(target=self._run_process, args=(cmd,), daemon=True).start()

    def _safe_cli(self, cmd: list[str]) -> list[str]:
        safe = list(cmd)
        if "--env-file" in safe:
            # path is safe to display, but never parse/render file contents.
            pass
        return safe

    def _run_process(self, cmd: list[str]) -> None:
        try:
            root = self.repo_root_var.get()
            creationflags = 0
            if os.name == "nt":
                creationflags = subprocess.CREATE_NO_WINDOW  # type: ignore[attr-defined]
            self.proc = subprocess.Popen(
                cmd,
                cwd=root,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                creationflags=creationflags,
            )
            assert self.proc.stdout is not None
            for line in self.proc.stdout:
                self.output_q.put(("line", line))
            rc = self.proc.wait()
            self.output_q.put(("done", rc))
        except Exception as exc:
            self.output_q.put(("line", f"GUI launch error: {type(exc).__name__}: {exc}\n"))
            self.output_q.put(("done", 1))

    def stop_run(self) -> None:
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.terminate()
                self._append_log("\nStop requested. Waiting for process termination…\n", "warning")
            except Exception as exc:
                self._append_log(f"Could not terminate: {exc}\n", "error")

    def _pump_queue(self) -> None:
        try:
            while True:
                kind, value = self.output_q.get_nowait()
                if kind == "line":
                    line = str(value)
                    tag = "success" if line.lstrip().startswith("PASS") else "error" if any(x in line for x in ("FAIL", "FATAL", "ERROR")) else "warning" if any(x in line for x in ("WARN", "BLOCKED", "PARTIAL")) else None
                    self._append_log(line, tag)
                elif kind == "done":
                    rc = int(value or 0)
                    self._set_running(False, "Complete" if rc == 0 else "Needs attention", success=rc == 0)
                    self._load_summary(rc)
                elif kind == "preflight":
                    self.preflight_var.set(str(value))
        except queue.Empty:
            pass
        self.after(80, self._pump_queue)

    def _load_summary(self, rc: int) -> None:
        report = Path(self.repo_root_var.get()) / "credential-reconcile-report.json"
        if report.exists():
            try:
                data = json.loads(report.read_text(encoding="utf-8"))
                counts: dict[str, int] = {}
                for item in data.get("results", []):
                    status = str(item.get("status", "UNKNOWN"))
                    counts[status] = counts.get(status, 0) + 1
                parts = [f"exit={rc}"] + [f"{k}={v}" for k, v in sorted(counts.items())]
                self.summary_var.set(" · ".join(parts) + "\nSee the Reports & outputs tab for full details.")
                return
            except Exception:
                pass
        self.summary_var.set(f"Process exit code: {rc}")

    def _set_running(self, running: bool, text: str, success: bool | None = None) -> None:
        self.status_var.set(text)
        self.audit_btn.configure(state="disabled" if running else "normal")
        self.apply_btn.configure(state="disabled" if running else "normal")
        self.stop_btn.configure(state="normal" if running else "disabled")
        if running:
            self.progress.start(12)
            self.status_pill.configure(bg="#e9efff", fg=ACCENT)
        else:
            self.progress.stop()
            if success is True:
                self.status_pill.configure(bg="#e5f5ef", fg=SUCCESS)
            elif success is False:
                self.status_pill.configure(bg="#fdecee", fg=DANGER)
            else:
                self.status_pill.configure(bg="#e7edf6", fg=TEXT)

    def _append_log(self, text: str, tag: str | None = None) -> None:
        self.log.configure(state="normal")
        if tag:
            self.log.insert("end", text, tag)
        else:
            self.log.insert("end", text)
        self.log.see("end")
        self.log.configure(state="disabled")

    def clear_log(self) -> None:
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")

    def open_output(self, filename: str) -> None:
        path = Path(self.repo_root_var.get()) / filename
        if not path.exists():
            messagebox.showinfo(APP_TITLE, f"File has not been generated yet:\n{path}")
            return
        self._open_path(path)

    def open_project_folder(self) -> None:
        self._open_path(Path(self.repo_root_var.get()))

    def _open_path(self, path: Path) -> None:
        try:
            if os.name == "nt":
                os.startfile(str(path))  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                subprocess.Popen(["open", str(path)])
            else:
                subprocess.Popen(["xdg-open", str(path)])
        except Exception as exc:
            messagebox.showerror(APP_TITLE, f"Could not open path:\n{exc}")


if __name__ == "__main__":
    app = ReconcileApp()
    app.mainloop()
