from __future__ import annotations
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any, Dict, List, Optional
import datetime as dt
from functools import lru_cache
from jsonschema import Draft7Validator, FormatChecker

from storage import (
    list_datapacts,
    read_datapact_yaml,
    write_new_version,
    parse_yaml,
    parse_yaml_raw,
    history,
    find_legacy_keys,
    load_schema,
    append_activity_log,
    read_activity_log,
    append_alerts_log,
    append_quality_history,
    read_quality_history,
    log_event,
    record_metric,
    create_backup,
)
from rules import validate_datapact, compute_alerts, compute_risk_score

app = FastAPI(title="DataPact DGFiP MVP", version="0.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SaveRequest(BaseModel):
    yaml: str

@lru_cache(maxsize=1)
def _validator() -> Optional[Draft7Validator]:
    schema = load_schema()
    if not schema:
        return None
    return Draft7Validator(schema, format_checker=FormatChecker())

def _schema_errors(obj: Dict[str, Any]) -> List[str]:
    validator = _validator()
    if not validator:
        return []
    return [f"{'/'.join([str(x) for x in err.absolute_path])}: {err.message}" for err in validator.iter_errors(obj)]

def _couloir_types_map() -> Dict[str, str]:
    out: Dict[str, str] = {}
    for item in list_datapacts():
        if item.get("couloir"):
            out[item["couloir"]] = item.get("type_couloir") or ""
    return out

ALLOWED_TRANSITIONS = {
    "brouillon": {"en_validation", "retire"},
    "en_validation": {"valide", "brouillon", "retire"},
    "valide": {"expire", "retire"},
    "expire": {"retire"},
    "retire": set(),
}

def _enforce_transition(prev_status: str, new_status: str) -> None:
    if prev_status == new_status:
        return
    allowed = ALLOWED_TRANSITIONS.get(prev_status, set())
    if new_status not in allowed:
        raise HTTPException(400, f"Transition statut interdite: {prev_status} -> {new_status}")

def _quality_items(datapact_id: str, obj: Dict[str, Any]) -> List[Dict[str, Any]]:
    out = []
    donnees = obj.get("donnees") or []
    for jd in donnees if isinstance(donnees, list) else []:
        indicateurs = (((jd or {}).get("gouvernance") or {}).get("qualite") or {}).get("indicateurs") or []
        for ind in indicateurs if isinstance(indicateurs, list) else []:
            dernier = (ind or {}).get("dernier_calcul") or {}
            out.append({
                "datapact_id": datapact_id,
                "dataset_id": jd.get("id"),
                "indicateur": ind.get("nom_indicateur"),
                "date": dernier.get("date"),
                "resultat": dernier.get("resultat"),
            })
    return out

def _diff_sections(before: Dict[str, Any], after: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    sections = [
        "identification",
        "parties",
        "duree_du_datapact",
        "donnees",
        "cas_d_usage",
        "dependances_couloirs",
        "politique_diffusion",
    ]
    changes = {}
    for section in sections:
        if before.get(section) != after.get(section):
            changes[section] = {"before": before.get(section), "after": after.get(section)}
    return changes

@app.get("/api/datapacts")
def api_list() -> List[Dict[str, Any]]:
    return list_datapacts()

@app.get("/api/schema")
def api_schema() -> Dict[str, Any]:
    return load_schema()

@app.get("/api/datapacts/{datapact_id}")
def api_get(datapact_id: str) -> Dict[str, Any]:
    y = read_datapact_yaml(datapact_id)
    if y is None:
        raise HTTPException(404, "DataPact introuvable")
    parse_error = None
    try:
        obj = parse_yaml(y)
    except Exception as e:
        obj = {}
        parse_error = f"YAML invalide: {e}"
    if parse_error:
        validation = {
            "status": "incomplet",
            "completeness": 0,
            "checks_total": 0,
            "checks_ok": 0,
            "issues": [{"path": "yaml", "severity": "bloquant", "message": parse_error}],
            "warnings": [],
        }
    else:
        validation = validate_datapact(obj, _couloir_types_map())
        for err in _schema_errors(obj):
            validation["issues"].append({"path": "schema", "severity": "bloquant", "message": err})
    return {
        "id": datapact_id,
        "yaml": y,
        "parsed": obj,
        "validation": validation,
        "risk_score": compute_risk_score(obj),
    }

@app.put("/api/datapacts/{datapact_id}")
def api_put(
    datapact_id: str,
    req: SaveRequest,
    x_user: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    try:
        raw_obj = parse_yaml_raw(req.yaml)
    except Exception as e:
        raise HTTPException(400, f"YAML invalide: {e}")
    legacy = find_legacy_keys(raw_obj)
    if legacy:
        raise HTTPException(400, f"Clés non canoniques interdites: {', '.join(legacy)}")
    obj = parse_yaml(req.yaml)
    declared_id = obj.get("id")
    if declared_id and declared_id != datapact_id:
        raise HTTPException(400, f"Le champ 'id' ({declared_id}) ne correspond pas à l'URL ({datapact_id}).")
    previous_yaml = read_datapact_yaml(datapact_id) or ""
    if previous_yaml:
        try:
            previous_obj = parse_yaml(previous_yaml)
        except Exception:
            previous_obj = {}
    else:
        previous_obj = {}
    prev_status = previous_obj.get("statut_datapact") or "brouillon"
    new_status = obj.get("statut_datapact") or "brouillon"
    _enforce_transition(prev_status, new_status)
    schema_errors = _schema_errors(obj)
    validation = validate_datapact(obj, _couloir_types_map())
    if schema_errors:
        raise HTTPException(400, "Schema invalide:\n" + "\n".join(schema_errors))
    if any(i.get("severity") == "bloquant" for i in validation.get("issues", [])):
        raise HTTPException(400, "Validation bloquante:\n" + "\n".join([i.get("message") for i in validation.get("issues", [])]))
    meta = write_new_version(datapact_id, req.yaml)
    changes = _diff_sections(previous_obj, obj)
    append_activity_log({
        "datapact_id": datapact_id,
        "user": x_user or "anonymous",
        "date": dt.datetime.utcnow().isoformat() + "Z",
        "changes": changes,
    })
    log_event({
        "event": "save",
        "datapact_id": datapact_id,
        "user": x_user or "anonymous",
        "date": dt.datetime.utcnow().isoformat() + "Z",
        "status": new_status,
    })
    append_quality_history(_quality_items(datapact_id, obj))
    return {"meta": meta, "validation": validation}

@app.get("/api/datapacts/{datapact_id}/history")
def api_history(datapact_id: str) -> Dict[str, Any]:
    y = read_datapact_yaml(datapact_id)
    if y is None:
        raise HTTPException(404, "DataPact introuvable")
    return {"id": datapact_id, "versions": history(datapact_id)}

@app.get("/api/alerts")
def api_alerts(datapact_id: Optional[str] = None) -> Dict[str, Any]:
    items = []
    targets = [datapact_id] if datapact_id else [x["id"] for x in list_datapacts()]
    for did in targets:
        y = read_datapact_yaml(did)
        if not y:
            continue
        try:
            obj = parse_yaml(y)
        except Exception:
            continue
        for alert in compute_alerts(obj):
            items.append({"datapact_id": did, **alert})
    append_alerts_log([f"{dt.datetime.utcnow().isoformat()}Z {a['datapact_id']} {a['kind']} {a['date']}" for a in items])
    return {"items": items}

@app.get("/api/activity")
def api_activity() -> Dict[str, Any]:
    return {"items": read_activity_log()}

@app.get("/api/dashboard")
def api_dashboard_filtered(couloir: Optional[str] = None, environnement: Optional[str] = None, type_couloir: Optional[str] = None) -> Dict[str, Any]:
    return _api_dashboard(couloir=couloir, environnement=environnement, type_couloir=type_couloir)

def _parse_date_str(s: Optional[str]) -> Optional[dt.date]:
    if not s:
        return None
    try:
        return dt.date.fromisoformat(s)
    except Exception:
        return None

def _api_dashboard(couloir: Optional[str] = None, environnement: Optional[str] = None, type_couloir: Optional[str] = None) -> Dict[str, Any]:
    datapacts = list_datapacts()
    if couloir:
        datapacts = [d for d in datapacts if d.get("couloir") == couloir]
    if environnement:
        datapacts = [d for d in datapacts if d.get("environnement") == environnement]
    if type_couloir:
        datapacts = [d for d in datapacts if d.get("type_couloir") == type_couloir]
    total = len(datapacts)
    risks = []
    risk_items = []
    completeness = []
    sensitive_exposed = 0
    habilitations_risk = 0
    today = dt.date.today()
    for item in datapacts:
        y = read_datapact_yaml(item["id"])
        if not y:
            continue
        try:
            obj = parse_yaml(y)
        except Exception:
            continue
        validation = validate_datapact(obj, _couloir_types_map())
        completeness.append(validation.get("completeness", 0))
        score = compute_risk_score(obj)
        risks.append(score)
        risk_items.append({"id": item.get("id"), "score": score})
        for jd in (obj.get("donnees") or []):
            if not isinstance(jd, dict):
                continue
            conf = ((jd.get("gouvernance") or {}).get("conformite") or {})
            dp = (conf.get("donnees_personnelles") or {})
            if dp.get("contient_donnees_personnelles") in {"oui", "true", True}:
                sensitive_exposed += 1
            hab = jd.get("habilitations") or {}
            for sect in ["utilisateurs", "re_utilisateurs"]:
                for acct in ["comptes_applicatifs", "comptes_nominatifs"]:
                    for item_h in hab.get(sect, {}).get(acct, []) or []:
                        fin = _parse_date_str((item_h.get("periode_acces") or {}).get("fin"))
                        if fin and 0 <= (fin - today).days <= 30:
                            habilitations_risk += 1
    return {
        "total": total,
        "avg_completeness": round(sum(completeness) / len(completeness), 1) if completeness else 0,
        "high_risk": len([r for r in risks if r >= 60]),
        "sensitive_exposed": sensitive_exposed,
        "habilitations_risk": habilitations_risk,
        "risk_scores": risks,
        "risk_items": risk_items,
        "quality_history": read_quality_history(),
    }

@app.get("/api/notifications")
def api_notifications(datapact_id: Optional[str] = None) -> Dict[str, Any]:
    items = []
    targets = [datapact_id] if datapact_id else [x["id"] for x in list_datapacts()]
    for did in targets:
        y = read_datapact_yaml(did)
        if not y:
            continue
        try:
            obj = parse_yaml(y)
        except Exception:
            continue
        statut = obj.get("statut_datapact") or "brouillon"
        if statut == "en_validation":
            items.append({"datapact_id": did, "kind": "validation_requise", "message": "Validation requise"})
        for alert in compute_alerts(obj):
            items.append({"datapact_id": did, "kind": alert["kind"], "message": alert["title"]})
        for d in (obj.get("donnees") or []):
            inc = ((d.get("gouvernance") or {}).get("transverse") or {}).get("incidents") or {}
            if inc.get("statut") == "declare":
                items.append({"datapact_id": did, "kind": "incident", "message": "Incident déclaré"})
    append_alerts_log([f"{dt.datetime.utcnow().isoformat()}Z {i['datapact_id']} {i['kind']}" for i in items])
    return {"items": items}

@app.get("/api/metrics")
def api_metrics() -> Dict[str, Any]:
    record_metric({"date": dt.datetime.utcnow().isoformat() + "Z", "datapacts": len(list_datapacts())})
    return {"datapacts": len(list_datapacts())}

@app.post("/api/backup")
def api_backup() -> Dict[str, Any]:
    return create_backup()

@app.get("/api/integrations/c2s/{datapact_id}")
def api_c2s(datapact_id: str) -> Dict[str, Any]:
    y = read_datapact_yaml(datapact_id)
    if not y:
        raise HTTPException(404, "DataPact introuvable")
    try:
        obj = parse_yaml(y)
    except Exception:
        return {"declared": [], "effective": [], "diff": []}
    declared = obj.get("donnees") or []
    declared_counts = []
    for d in declared if isinstance(declared, list) else []:
        hab = (d.get("habilitations") or {})
        count = 0
        for sect_name in ["utilisateurs", "re_utilisateurs"]:
            sect = hab.get(sect_name) or {}
            for acct_type in ["comptes_applicatifs", "comptes_nominatifs"]:
                count += len(sect.get(acct_type) or [])
        declared_counts.append({"dataset_id": d.get("id"), "comptes": count})
    effective = [{"dataset_id": x["dataset_id"], "comptes": x["comptes"] + (1 if x["dataset_id"] else 0)} for x in declared_counts]
    diff = []
    for dec in declared_counts:
        eff = next((e for e in effective if e["dataset_id"] == dec["dataset_id"]), None)
        if eff and eff["comptes"] != dec["comptes"]:
            diff.append({"dataset_id": dec["dataset_id"], "declared": dec["comptes"], "effective": eff["comptes"]})
    return {"declared": declared_counts, "effective": effective, "diff": diff}

@app.get("/api/integrations/dcpod/{identifiant}")
def api_dcpod(identifiant: str) -> Dict[str, Any]:
    status = "valide" if identifiant.startswith("DCPOD-") else "invalide"
    return {"identifiant": identifiant, "status": status}

@app.get("/api/integrations/catalogue/{dataset_id}")
def api_catalogue(dataset_id: str) -> Dict[str, Any]:
    return {
        "dataset_id": dataset_id,
        "titre": f"Catalogue {dataset_id}",
        "description": "Données issues du catalogue (mock).",
        "metadonnees": ["annee", "montant", "identifiant"],
    }
