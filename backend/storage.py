from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional
import datetime as dt
import yaml

DATA_DIR = Path(__file__).parent / "data"
INDEX_PATH = DATA_DIR / "index.json"
SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schemas" / "datapact.schema.json"
ACTIVITY_LOG_PATH = DATA_DIR / "activity.log.jsonl"
ALERTS_LOG_PATH = DATA_DIR / "alerts.log"
QUALITY_LOG_PATH = DATA_DIR / "quality_history.jsonl"
LOG_PATH = DATA_DIR / "logs.jsonl"
METRICS_PATH = DATA_DIR / "metrics.jsonl"
BACKUP_DIR = DATA_DIR / "backups"

LEGACY_KEY_MAP = {
    "Parites": "parties",
    "duree du DataPact": "duree_du_datapact",
    "duree_du_DataPact": "duree_du_datapact",
}

def _now_stamp() -> str:
    return dt.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")

def _safe_id(datapact_id: str) -> str:
    return datapact_id.replace("/", "_").replace(":", "_")

def load_index() -> Dict[str, Any]:
    if not INDEX_PATH.exists():
        return {"items": {}}
    return json.loads(INDEX_PATH.read_text(encoding="utf-8"))

def save_index(index: Dict[str, Any]) -> None:
    INDEX_PATH.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")

def _stamp_from_mtime(p: Path) -> str:
    return dt.datetime.utcfromtimestamp(p.stat().st_mtime).strftime("%Y%m%dT%H%M%SZ")

def _meta_from_yaml_path(p: Path) -> Dict[str, Any]:
    obj = {}
    try:
        obj = parse_yaml(p.read_text(encoding="utf-8"))
    except Exception:
        obj = {}
    ident = (obj or {}).get("identification", {}) or {}
    parties = (obj or {}).get("parties", {}) or {}
    datapact_id = (obj or {}).get("id") or p.stem
    return {
        "id": datapact_id,
        "couloir": ident.get("nom_couloir"),
        "type_couloir": ident.get("type_couloir"),
        "jeu_donnees": ident.get("jeu_donnees"),
        "environnement": ident.get("environnement"),
        "version": ident.get("version"),
        "updated_at": _stamp_from_mtime(p),
        "latest_path": str(p.relative_to(DATA_DIR)),
        "responsable_donnees": (((parties.get("responsables") or {}).get("responsable_donnees") or {}).get("email")),
    }

def list_datapacts() -> List[Dict[str, Any]]:
    idx = load_index()
    items_by_id: Dict[str, Dict[str, Any]] = dict((idx.get("items") or {}))
    indexed_paths = {meta.get("latest_path") for meta in items_by_id.values() if meta.get("latest_path")}

    if DATA_DIR.exists():
        for p in DATA_DIR.glob("*.yaml"):
            rel = str(p.relative_to(DATA_DIR))
            if rel in indexed_paths:
                continue
            meta = _meta_from_yaml_path(p)
            if meta.get("id") in items_by_id:
                continue
            items_by_id[meta["id"]] = meta

    items = list(items_by_id.values())
    items.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
    return items

def get_latest_path(datapact_id: str) -> Optional[Path]:
    idx = load_index()
    meta = (idx.get("items") or {}).get(datapact_id)
    if not meta:
        # Fallback: find a YAML file by id or filename
        if DATA_DIR.exists():
            for p in DATA_DIR.glob("*.yaml"):
                if p.stem == datapact_id:
                    return p
                try:
                    obj = parse_yaml(p.read_text(encoding="utf-8"))
                except Exception:
                    obj = {}
                if (obj or {}).get("id") == datapact_id:
                    return p
        return None
    latest = meta.get("latest_path")
    if not latest:
        return None
    p = (DATA_DIR / latest).resolve()
    return p if p.exists() else None

def read_datapact_yaml(datapact_id: str) -> Optional[str]:
    p = get_latest_path(datapact_id)
    if not p:
        return None
    return p.read_text(encoding="utf-8")

def parse_yaml_raw(yaml_str: str) -> Dict[str, Any]:
    return yaml.safe_load(yaml_str) or {}

def _normalize_donnees(donnees: Any) -> List[Dict[str, Any]]:
    if isinstance(donnees, list):
        out = []
        for i, item in enumerate(donnees):
            if isinstance(item, dict):
                if not item.get("id"):
                    item = {"id": f"donnee_{i+1}", **item}
                out.append(item)
        return out
    if isinstance(donnees, dict):
        out = []
        for k, v in donnees.items():
            if isinstance(v, dict):
                out.append({"id": k, **v})
        return out
    return []

def _normalize_cas_d_usage(items: Any) -> List[Dict[str, Any]]:
    if isinstance(items, list):
        out = []
        for i, item in enumerate(items):
            if isinstance(item, dict):
                if not item.get("id"):
                    item = {"id": f"cas_{i+1}", **item}
                out.append(item)
        return out
    if isinstance(items, dict):
        out = []
        for k, v in items.items():
            if isinstance(v, dict):
                out.append({"id": k, **v})
        return out
    return []

def normalize_keys(obj: Any) -> Any:
    if not isinstance(obj, dict):
        return obj
    out: Dict[str, Any] = {}
    for k, v in obj.items():
        nk = LEGACY_KEY_MAP.get(k, k)
        if nk in out:
            continue
        out[nk] = v
    if "donnees" in out:
        out["donnees"] = _normalize_donnees(out.get("donnees"))
    if "cas_d_usage" in out:
        out["cas_d_usage"] = _normalize_cas_d_usage(out.get("cas_d_usage"))
    return out

def find_legacy_keys(obj: Any) -> List[str]:
    if not isinstance(obj, dict):
        return []
    return [k for k in obj.keys() if k in LEGACY_KEY_MAP]

def parse_yaml(yaml_str: str) -> Dict[str, Any]:
    return normalize_keys(parse_yaml_raw(yaml_str))

def load_schema() -> Dict[str, Any]:
    if not SCHEMA_PATH.exists():
        return {}
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))

def append_activity_log(entry: Dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ACTIVITY_LOG_PATH.open("a", encoding="utf-8").write(json.dumps(entry, ensure_ascii=False) + "\n")

def read_activity_log(limit: int = 200) -> List[Dict[str, Any]]:
    if not ACTIVITY_LOG_PATH.exists():
        return []
    lines = ACTIVITY_LOG_PATH.read_text(encoding="utf-8").splitlines()
    out = []
    for line in lines[-limit:]:
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return out

def append_alerts_log(lines: List[str]) -> None:
    if not lines:
        return
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with ALERTS_LOG_PATH.open("a", encoding="utf-8") as f:
        for line in lines:
            f.write(line + "\n")

def append_quality_history(items: List[Dict[str, Any]]) -> None:
    if not items:
        return
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with QUALITY_LOG_PATH.open("a", encoding="utf-8") as f:
        for item in items:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

def read_quality_history(limit: int = 500) -> List[Dict[str, Any]]:
    if not QUALITY_LOG_PATH.exists():
        return []
    lines = QUALITY_LOG_PATH.read_text(encoding="utf-8").splitlines()
    out = []
    for line in lines[-limit:]:
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return out

def log_event(event: Dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LOG_PATH.open("a", encoding="utf-8").write(json.dumps(event, ensure_ascii=False) + "\n")

def record_metric(metric: Dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    METRICS_PATH.open("a", encoding="utf-8").write(json.dumps(metric, ensure_ascii=False) + "\n")

def create_backup() -> Dict[str, Any]:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = _now_stamp()
    archive_base = BACKUP_DIR / f"backup_{stamp}"
    import shutil
    path = shutil.make_archive(str(archive_base), "zip", DATA_DIR)
    return {"path": str(path), "stamp": stamp}

def write_new_version(datapact_id: str, yaml_str: str) -> Dict[str, Any]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    stamp = _now_stamp()
    safe = _safe_id(datapact_id)
    version_path = DATA_DIR / f"{safe}.{stamp}.yaml"
    version_path.write_text(yaml_str, encoding="utf-8")

    obj = parse_yaml(yaml_str)
    ident = obj.get("identification", {}) or {}
    parties = obj.get("parties", {}) or {}

    meta = {
        "id": datapact_id,
        "couloir": ident.get("nom_couloir"),
        "type_couloir": ident.get("type_couloir"),
        "jeu_donnees": ident.get("jeu_donnees"),
        "environnement": ident.get("environnement"),
        "version": ident.get("version"),
        "updated_at": stamp,
        "latest_path": str(version_path.relative_to(DATA_DIR)),
        "responsable_donnees": (((parties.get("responsables") or {}).get("responsable_donnees") or {}).get("email")),
    }

    idx = load_index()
    idx.setdefault("items", {})
    idx["items"][datapact_id] = meta
    save_index(idx)
    return meta

def history(datapact_id: str) -> List[Dict[str, Any]]:
    safe = _safe_id(datapact_id)
    versions = []
    for p in DATA_DIR.glob(f"{safe}.*.yaml"):
        parts = p.name.split(".")
        stamp = parts[-2] if len(parts) >= 3 else ""
        versions.append({"path": str(p.relative_to(DATA_DIR)), "stamp": stamp, "size": p.stat().st_size})
    versions.sort(key=lambda x: x["stamp"], reverse=True)
    return versions
