from __future__ import annotations
from typing import Any, Dict, List, Tuple, Optional
import datetime as dt

def _truthy(v: Any) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v.strip().lower() in {"oui", "yes", "true", "vrai", "1"}
    return bool(v)

def _get_jeux(obj: Dict[str, Any]) -> List[Tuple[str, Dict[str, Any]]]:
    donnees = obj.get("donnees") or []
    out: List[Tuple[str, Dict[str, Any]]] = []
    if isinstance(donnees, list):
        for i, v in enumerate(donnees):
            if isinstance(v, dict):
                key = v.get("id") or f"donnees[{i}]"
                out.append((key, v))
    elif isinstance(donnees, dict):
        for k, v in donnees.items():
            if isinstance(v, dict):
                out.append((k, v))
    return out

def _as_list(v: Any) -> List[Any]:
    if v is None:
        return []
    if isinstance(v, list):
        return v
    if isinstance(v, dict):
        return [v]
    return []

def _parse_date(s: Any) -> Optional[dt.date]:
    if not s or not isinstance(s, str):
        return None
    try:
        return dt.date.fromisoformat(s)
    except Exception:
        return None

def compute_alerts(obj: Dict[str, Any]) -> List[Dict[str, Any]]:
    alerts: List[Dict[str, Any]] = []
    today = dt.date.today()
    parties = obj.get("parties") or {}
    responsables = (parties.get("responsables") or {})
    emails = [
        (responsables.get("responsable_donnees") or {}).get("email"),
        (responsables.get("responsable_couloir") or {}).get("email"),
        (responsables.get("responsable_traitement") or {}).get("email"),
    ]
    emails = [e for e in emails if e]

    def add_alert(kind: str, title: str, target_date: str, emails: List[str], path: str):
        date_val = _parse_date(target_date)
        if not date_val:
            return
        days_left = (date_val - today).days
        if days_left not in {30, 7}:
            return
        alerts.append({
            "kind": kind,
            "title": title,
            "date": target_date,
            "days_left": days_left,
            "path": path,
            "emails": emails,
        })

    duree = obj.get("duree_du_datapact") or {}
    add_alert(
        "datapact_fin",
        "Fin de DataPact",
        duree.get("date_fin"),
        emails,
        "duree_du_datapact.date_fin",
    )

    datasets = _get_jeux(obj)
    for key, jd in datasets:
        habilitations = (jd.get("habilitations") or {})
        for sect_name in ["comptes_applicatifs", "comptes_nominatifs"]:
            for item in _as_list((habilitations.get("utilisateurs") or {}).get(sect_name)):
                periode = item.get("periode_acces") or {}
                add_alert(
                    "habilitation_fin",
                    f"Fin habilitation ({key})",
                    periode.get("fin"),
                    emails,
                    f"donnees.{key}.habilitations.utilisateurs.{sect_name}",
                )
            for item in _as_list((habilitations.get("re_utilisateurs") or {}).get(sect_name)):
                periode = item.get("periode_acces") or {}
                add_alert(
                    "habilitation_fin",
                    f"Fin habilitation réutilisateurs ({key})",
                    periode.get("fin"),
                    emails,
                    f"donnees.{key}.habilitations.re_utilisateurs.{sect_name}",
                )

    cas_d_usage = _as_list(obj.get("cas_d_usage"))
    for i, item in enumerate(cas_d_usage):
        periode = (item or {}).get("periode") or {}
        add_alert(
            "cas_usage_fin",
            f"Fin cas d'usage {item.get('id') or i+1}",
            periode.get("fin"),
            emails,
            f"cas_d_usage[{i}].periode.fin",
        )
    for key, jd in datasets:
        qualite = ((jd.get("gouvernance") or {}).get("qualite") or {})
        indicateurs = _as_list(qualite.get("indicateurs"))
        for i, ind in enumerate(indicateurs):
            try:
                target = float(ind.get("valeur_cible_alerte"))
                resultat = float(((ind.get("dernier_calcul") or {}).get("resultat")))
            except Exception:
                continue
            if resultat < target:
                alerts.append({
                    "kind": "qualite_degradation",
                    "title": f"Qualité en baisse ({key})",
                    "date": (ind.get("dernier_calcul") or {}).get("date"),
                    "days_left": 0,
                    "path": f"donnees.{key}.gouvernance.qualite.indicateurs[{i}]",
                    "emails": emails,
                })
    return alerts

def compute_risk_score(obj: Dict[str, Any]) -> int:
    score = 0
    datasets = _get_jeux(obj)
    for _, jd in datasets:
        conf = (jd.get("gouvernance") or {}).get("conformite") or {}
        dp = (conf.get("donnees_personnelles") or {})
        if _truthy(dp.get("contient_donnees_personnelles")):
            score += 20
        if _truthy(dp.get("contient_donnees_sensibles_rgpd")):
            score += 20
        if _truthy(dp.get("contient_donnees_particulieres")):
            score += 20
        hab = jd.get("habilitations") or {}
        for sect_name in ["utilisateurs", "re_utilisateurs"]:
            sect = hab.get(sect_name) or {}
            for acct_type in ["comptes_applicatifs", "comptes_nominatifs"]:
                score += 2 * len(_as_list(sect.get(acct_type)))
    deps = _as_list(obj.get("dependances_couloirs"))
    score += 5 * len(deps)
    return min(score, 100)

def validate_datapact(obj: Dict[str, Any], couloir_types: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    issues: List[Dict[str, str]] = []
    warnings: List[Dict[str, str]] = []
    checks_total = 0
    checks_ok = 0
    section_total: Dict[str, int] = {}
    section_ok: Dict[str, int] = {}

    def check(path: str, ok: bool, severity: str, message: str):
        nonlocal checks_total, checks_ok
        checks_total += 1
        if ok:
            checks_ok += 1
            return
        (issues if severity == "bloquant" else warnings).append(
            {"path": path, "severity": severity, "message": message}
        )

    def check_section(section: str, path: str, ok: bool, severity: str, message: str):
        section_total[section] = section_total.get(section, 0) + 1
        if ok:
            section_ok[section] = section_ok.get(section, 0) + 1
        check(path, ok, severity, message)

    ident = obj.get("identification") or {}
    type_couloir = str(ident.get("type_couloir") or "").lower()
    check_section("identification", "identification.nom_couloir", bool(ident.get("nom_couloir")), "bloquant", "Nom du couloir obligatoire.")
    check_section("identification", "identification.type_couloir", bool(ident.get("type_couloir")), "bloquant", "Type de couloir obligatoire.")
    check_section("identification", "identification.version", bool(ident.get("version")), "bloquant", "Version obligatoire.")
    check_section("identification", "identification.environnement", bool(ident.get("environnement")), "alerte", "Environnement manquant.")

    duree = obj.get("duree_du_datapact") or {}
    check_section("identification", "duree_du_datapact.duree_contrat", bool(duree.get("duree_contrat")), "alerte", "Durée du DataPact manquante.")
    check_section("identification", "duree_du_datapact.date_effet", bool(duree.get("date_effet")), "alerte", "Date d'effet manquante.")
    check_section("identification", "duree_du_datapact.date_fin", bool(duree.get("date_fin")), "alerte", "Date de fin manquante.")

    jeux = _get_jeux(obj)
    check("donnees", len(jeux) > 0, "alerte", "Au moins un jeu de données doit être décrit.")

    dataset_ids = [k for k, _ in jeux]
    if len(dataset_ids) != len(set(dataset_ids)):
        check("donnees", False, "bloquant", "Identifiants de jeux de données non uniques.")

    for key, jd in jeux:
        gouv = jd.get("gouvernance") or {}
        conf = (gouv.get("conformite") or {})
        dp = (conf.get("donnees_personnelles") or {})
        contient_perso = _truthy(dp.get("contient_donnees_personnelles"))
        contient_sens = _truthy(dp.get("contient_donnees_sensibles_rgpd"))
        contient_part = _truthy(dp.get("contient_donnees_particulieres"))

        check_section("conformite", f"donnees.{key}.gouvernance.conformite.identifiant_dcpod",
                      (not contient_perso) or bool(conf.get("identifiant_dcpod")),
                      "bloquant",
                      "Données personnelles: identifiant_dcpod obligatoire.")
        ident_dcpod = conf.get("identifiant_dcpod")
        if ident_dcpod and not str(ident_dcpod).startswith("DCPOD-"):
            check_section("conformite", f"donnees.{key}.gouvernance.conformite.identifiant_dcpod",
                          False,
                          "alerte",
                          "Identifiant DCPOD invalide (mock).")

        cons = (conf.get("conservation_et_purge") or {})
        check_section("conformite", f"donnees.{key}.gouvernance.conformite.conservation_et_purge.duree_conservation",
                      bool(cons.get("duree_conservation")),
                      "bloquant",
                      "Durée de conservation obligatoire.")
        check(f"donnees.{key}.gouvernance.conformite.conservation_et_purge.date_purge_previsionnelle",
              bool(cons.get("date_purge_previsionnelle")),
              "alerte",
              "Date de purge prévisionnelle manquante.")

        loc = (gouv.get("localisation") or {})
        check_section("conformite", f"donnees.{key}.gouvernance.localisation.chemin_dossier",
                      bool(loc.get("chemin_dossier")),
                      "bloquant",
                      "Chemin dossier obligatoire.")

        files = loc.get("fichiers") or {}
        proc = files.get("processus_ingestion") if isinstance(files, dict) else {}
        dates_ing = (proc.get("dates_ingestion") or {}) if isinstance(proc, dict) else {}
        check_section("conformite", f"donnees.{key}.gouvernance.localisation.fichiers.processus_ingestion.dates_ingestion.date_derniere_ingestion",
                      bool(dates_ing.get("date_derniere_ingestion")),
                      "alerte",
                      "Date de dernière ingestion manquante.")

        # Habilitations: require date fin & droits
        utilisateurs = jd.get("utilisateurs") or {}
        for sect_name in ["comptes_applicatifs", "comptes_nominatifs"]:
            for i, item in enumerate(_as_list(utilisateurs.get(sect_name))):
                if not isinstance(item, dict):
                    continue
                if "droits" in item or "periode_acces" in item:
                    check_section("habilitations", f"donnees.{key}.utilisateurs.{sect_name}[{i}]",
                                  False,
                                  "bloquant",
                                  "Les champs droits et periode_acces sont interdits dans utilisateurs.")

        hab = jd.get("habilitations") or {}
        for sect_name in ["utilisateurs", "re_utilisateurs"]:
            sect = hab.get(sect_name) or {}
            for acct_type in ["comptes_applicatifs", "comptes_nominatifs"]:
                for i, item in enumerate(_as_list(sect.get(acct_type))):
                    if not isinstance(item, dict):
                        continue
                    periode = item.get("periode_acces") or {}
                    check_section("habilitations", f"donnees.{key}.habilitations.{sect_name}.{acct_type}[{i}].periode_acces.fin",
                                  bool(periode.get("fin")),
                                  "bloquant",
                                  "Habilitation: date de fin obligatoire.")
                    check_section("habilitations", f"donnees.{key}.habilitations.{sect_name}.{acct_type}[{i}].droits",
                                  bool(item.get("droits")),
                                  "bloquant",
                                  "Habilitation: droits obligatoires.")

        if contient_sens or contient_part:
            trans = (gouv.get("transverse") or {})
            check_section("conformite", f"donnees.{key}.gouvernance.transverse.securite",
                          bool(trans.get("securite")),
                          "alerte",
                          "Données sensibles/particulières: section sécurité attendue.")

        qualite = (gouv.get("qualite") or {})
        indicateurs = _as_list(qualite.get("indicateurs"))
        for i, ind in enumerate(indicateurs):
            check_section("qualite", f"donnees.{key}.gouvernance.qualite.indicateurs[{i}].nom_indicateur",
                          bool(ind.get("nom_indicateur")),
                          "alerte",
                          "Indicateur qualité: nom manquant.")
            dernier = ind.get("dernier_calcul") or {}
            check_section("qualite", f"donnees.{key}.gouvernance.qualite.indicateurs[{i}].dernier_calcul.resultat",
                          bool(dernier.get("resultat")),
                          "alerte",
                          "Indicateur qualité: résultat manquant.")

    cas_d_usage = _as_list(obj.get("cas_d_usage"))
    cas_ids = [c.get("id") for c in cas_d_usage if isinstance(c, dict)]
    if len(cas_ids) != len(set(cas_ids)):
        check("cas_d_usage", False, "bloquant", "Identifiants de cas d'usage non uniques.")
    for i, c in enumerate(cas_d_usage):
        if not isinstance(c, dict):
            continue
        check(f"cas_d_usage[{i}].finalite", bool(c.get("finalite")), "bloquant", "Finalité du cas d'usage obligatoire.")
        periode = c.get("periode") or {}
        check(f"cas_d_usage[{i}].periode.debut", bool(periode.get("debut")), "bloquant", "Début de période obligatoire.")
        check(f"cas_d_usage[{i}].periode.fin", bool(periode.get("fin")), "bloquant", "Fin de période obligatoire.")
        donnees_ids = c.get("donnees_ids") or []
        check(f"cas_d_usage[{i}].donnees_ids", isinstance(donnees_ids, list) and len(donnees_ids) > 0, "bloquant", "Au moins un jeu de données associé.")
        if isinstance(donnees_ids, list):
            for did in donnees_ids:
                if did not in dataset_ids:
                    check(f"cas_d_usage[{i}].donnees_ids", False, "bloquant", f"Jeu de données introuvable: {did}")

    deps = _as_list(obj.get("dependances_couloirs"))
    if type_couloir == "ingestion" and deps:
        check("dependances_couloirs", False, "bloquant", "Un couloir d'ingestion ne dépend pas d'autres couloirs.")
    if type_couloir in {"valorisation", "experimentation"}:
        for d in deps:
            src = d.get("couloir_source")
            if not src:
                continue
            src_type = (couloir_types or {}).get(src)
            if src_type:
                if src_type not in {"Ingestion", "Valorisation"}:
                    check("dependances_couloirs", False, "bloquant", f"Dépendance interdite depuis {src_type}: {src}.")
            else:
                check("dependances_couloirs", False, "alerte", f"Type de couloir inconnu pour la dépendance: {src}.")
    for i, dep in enumerate(deps):
        if not isinstance(dep, dict):
            continue
        check(f"dependances_couloirs[{i}].finalite", bool(dep.get("finalite")), "bloquant", "Finalité obligatoire.")
        duree_dep = dep.get("duree") or {}
        check(f"dependances_couloirs[{i}].duree.debut", bool(duree_dep.get("debut")), "bloquant", "Début de durée obligatoire.")
        check(f"dependances_couloirs[{i}].duree.fin", bool(duree_dep.get("fin")), "bloquant", "Fin de durée obligatoire.")

    diffusions = _as_list(obj.get("politique_diffusion"))
    for d in diffusions:
        target = d.get("couloir_cible")
        if not target:
            continue
        target_type = (couloir_types or {}).get(target)
        if target_type:
            if target_type == "Ingestion":
                check("politique_diffusion", False, "bloquant", f"Diffusion vers un couloir d'ingestion interdite: {target}.")
            if type_couloir == "ingestion" and target_type != "Valorisation":
                check("politique_diffusion", False, "bloquant", f"Un couloir d'ingestion ne diffuse que vers la valorisation: {target}.")
        else:
            check("politique_diffusion", False, "alerte", f"Type de couloir inconnu pour la diffusion: {target}.")
    for i, d in enumerate(diffusions):
        if not isinstance(d, dict):
            continue
        check(f"politique_diffusion[{i}].couloir_cible", bool(d.get("couloir_cible")), "bloquant", "Couloir cible obligatoire.")
        check(f"politique_diffusion[{i}].perimetre_donnees", bool(d.get("perimetre_donnees")), "bloquant", "Périmètre des données obligatoire.")
        duree_aut = d.get("duree_autorisation") or {}
        check(f"politique_diffusion[{i}].duree_autorisation.debut", bool(duree_aut.get("debut")), "bloquant", "Début d'autorisation obligatoire.")
        check(f"politique_diffusion[{i}].duree_autorisation.fin", bool(duree_aut.get("fin")), "bloquant", "Fin d'autorisation obligatoire.")
        check(f"politique_diffusion[{i}].justification", bool(d.get("justification")), "bloquant", "Justification obligatoire.")

    section_completeness = {
        k: round((section_ok.get(k, 0) / section_total.get(k, 1)) * 100) if section_total.get(k, 0) else 0
        for k in section_total.keys()
    }
    critical_sections = ["identification", "conformite", "habilitations", "qualite"]
    for sec in critical_sections:
        if section_total.get(sec, 0) and section_completeness.get(sec, 0) < 100:
            check(f"completeness.{sec}", False, "bloquant", f"Complétude {sec} < 100%.")

    statut = obj.get("statut_datapact")
    if statut != "valide" and diffusions:
        check("politique_diffusion", False, "bloquant", "Diffusion interdite sans validation complète.")

    completeness = round((checks_ok / checks_total) * 100) if checks_total else 0
    status = "valide" if not issues else "incomplet"
    return {
        "status": status,
        "completeness": completeness,
        "checks_total": checks_total,
        "checks_ok": checks_ok,
        "section_completeness": section_completeness,
        "issues": issues,
        "warnings": warnings,
    }
