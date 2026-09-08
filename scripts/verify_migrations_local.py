#!/usr/bin/env python3
"""Local, credential-free D1 migration contract verifier."""
from __future__ import annotations
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def table_columns(db: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in db.execute(f"PRAGMA table_info({table})")}


def assert_contract(db: sqlite3.Connection) -> None:
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    for required in {"providers", "models", "routing_rules", "health_checks", "audit_events", "oauth_codes", "refresh_token_families", "provider_operations", "rate_limit_buckets"}:
        assert required in tables, f"missing table: {required}"
    assert "correlation_id" in table_columns(db, "health_checks")
    assert "display_name" in table_columns(db, "models"), "missing models.display_name (migration 0009)"
    assert "description" in table_columns(db, "models"), "missing models.description (migration 0009)"
    for provider_id in ("tabitoken", "gorouter", "new-api"):
        row = db.execute("SELECT enabled, health_state, transport, auth_type FROM providers WHERE id=?", (provider_id,)).fetchone()
        assert row is not None, f"missing provider preset: {provider_id}"
        assert row[0] == 0 and row[1] == "NOT_CONFIGURED"
        assert row[2] == "gateway-custom" and row[3] == "byok"


def verify_fresh_schema() -> None:
    db = sqlite3.connect(":memory:")
    db.executescript((ROOT / "src/admin/schema.sql").read_text())
    assert_contract(db)


def verify_upgrade_chain() -> None:
    db = sqlite3.connect(":memory:")
    db.executescript("""
    CREATE TABLE providers (
      id TEXT PRIMARY KEY, display_name TEXT NOT NULL, kind TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0, byok_alias TEXT, health_state TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
      last_success_at TEXT, last_error_at TEXT, last_error_message TEXT, last_latency_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE models (
      id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES providers(id), public_alias TEXT,
      enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE routing_rules (
      public_alias TEXT PRIMARY KEY, model_id TEXT NOT NULL REFERENCES models(id),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE health_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, provider_id TEXT NOT NULL REFERENCES providers(id),
      checked_at TEXT NOT NULL DEFAULT (datetime('now')), state TEXT NOT NULL,
      latency_ms INTEGER, error_message TEXT
    );
    CREATE TABLE audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL DEFAULT (datetime('now')),
      actor TEXT NOT NULL DEFAULT 'admin', action TEXT NOT NULL, target TEXT, detail TEXT
    );
    INSERT INTO providers (id,display_name,kind,enabled,byok_alias,health_state)
      VALUES ('google-ai-studio','Google AI Studio','google-ai-studio',1,'default','CONFIGURED');
    """)
    for name in [
        "0002_update_gemini_models_v18.sql",
        "0003_provider_registry_v3.sql",
        "0004_new_api_gateways.sql",
        "0005_oauth_state.sql",
        "0006_lifecycle_state.sql",
        "0007_observability.sql",
        "0008_rate_limits.sql",
        "0009_model_metadata.sql",
    ]:
        db.executescript((ROOT / "migrations" / name).read_text())
    assert_contract(db)


if __name__ == "__main__":
    verify_fresh_schema()
    verify_upgrade_chain()
    print("migration verification: PASS (fresh schema + 0002->0009 upgrade chain)")
