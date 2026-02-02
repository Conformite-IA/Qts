import React, { useEffect, useMemo, useState } from 'react'
import jsPDF from 'jspdf'
import yaml from 'js-yaml'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import ReactFlow, { Background, Controls } from 'reactflow'
import 'reactflow/dist/style.css'
import {
  DataPactMeta,
  getActivity,
  getAlerts,
  getC2S,
  getDcpod,
  getCatalogue,
  getDashboard,
  getDataPact,
  getNotifications,
  getSchema,
  historyDataPact,
  listDataPacts,
  saveDataPact
} from './api'
import { Collapsible, Issues, StatusBadge, Tabs } from './components'

type View = { kind:'list' } | { kind:'detail', id:string }
type SchemaError = { path: string; message: string }
const TABS = ["Identification","Données","Habilitations","Cas d'usage","Dépendances","Diffusion","Gouvernance","Incidents","Alertes","Validation","Journal","Pilotage","Historique"]

function isObj(v:any){
  return v && typeof v === 'object' && !Array.isArray(v)
}
function labelize(k:string){
  return k.replace(/_/g, ' ')
}
function couloirTagClass(type?: string){
  if(!type) return 'dc-tag'
  const t = type.toLowerCase()
  if(t === 'ingestion') return 'dc-tag dc-tag-ingestion'
  if(t === 'valorisation') return 'dc-tag dc-tag-valorisation'
  if(t === 'experimentation') return 'dc-tag dc-tag-experimentation'
  return 'dc-tag'
}
function displayValue(v:any): string{
  if(v === null || v === undefined || v === '') return '—'
  if(Array.isArray(v)) return v.map(displayValue).join(', ')
  if(isObj(v)){
    const parts = Object.entries(v).map(([k,val])=> `${labelize(k)}: ${displayValue(val)}`)
    return parts.join(' • ')
  }
  return String(v)
}
function pathKey(path:(string|number)[]){
  return path.map((p, i) => typeof p === 'number' ? `[${p}]` : (i === 0 ? p : `.${p}`)).join('')
}
function parseInstancePath(instancePath: string): (string|number)[] {
  const parts = instancePath.split('/').filter(Boolean)
  return parts.map(p => (String(Number(p)) === p ? Number(p) : p))
}
function updateAtPath(obj:any, path:(string|number)[], value:any): any{
  if(path.length === 0) return value
  const [head, ...rest] = path
  if(typeof head === 'number'){
    const arr = Array.isArray(obj) ? [...obj] : []
    arr[head] = updateAtPath(arr[head], rest, value)
    return arr
  }
  const base = isObj(obj) ? { ...obj } : {}
  base[head] = updateAtPath(base[head], rest, value)
  return base
}
function defaultForSchema(schema:any): any{
  if(!schema) return ''
  if(schema.default !== undefined) return schema.default
  if(schema.type === 'string') return ''
  if(schema.type === 'number' || schema.type === 'integer') return 0
  if(schema.type === 'boolean') return false
  if(schema.type === 'array') return []
  if(schema.type === 'object'){
    const out:any = {}
    const props = schema.properties || {}
    ;(schema.required || []).forEach((k:string)=>{
      out[k] = defaultForSchema(props[k])
    })
    return out
  }
  return ''
}
function getDatasets(parsed:any){
  const donnees = parsed?.donnees || []
  return Array.isArray(donnees) ? donnees : []
}
function normalizeList(v:any){
  if(!v) return []
  if(Array.isArray(v)) return v
  if(isObj(v)) return [v]
  return []
}
function collectHabilitations(datasets:any[]){
  const rows: {dataset:string; section:string; type:string; identifiant?:string; droits?:string; debut?:string; fin?:string}[] = []
  datasets.forEach((value:any)=>{
    const datasetName = value?.nom || value?.id
    const hab = value?.habilitations || {}
    for(const section of ['utilisateurs', 're_utilisateurs']){
      const sect = hab?.[section] || {}
      for(const type of ['comptes_applicatifs', 'comptes_nominatifs']){
        const list = normalizeList(sect?.[type])
        list.forEach((item:any)=>{
          rows.push({
            dataset: datasetName,
            section,
            type,
            identifiant: item?.identifiant,
            droits: item?.droits,
            debut: item?.periode_acces?.debut,
            fin: item?.periode_acces?.fin,
          })
        })
      }
    }
  })
  return rows
}
function collectIncidents(datasets:any[]){
  const items: {dataset:string; incidents:any}[] = []
  datasets.forEach((value:any)=>{
    const inc = value?.gouvernance?.transverse?.incidents
    if(inc){
      items.push({ dataset: value?.nom || value?.id, incidents: inc })
    }
  })
  return items
}
function buildPdf({id, parsed, datasets, habilitations}:{id:string; parsed:any; datasets:Dataset[]; habilitations:any[]}){
  const doc = new jsPDF({ unit:'pt', format:'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 48
  const maxWidth = pageWidth - margin * 2
  let y = 56

  function addTitle(text:string){
    doc.setFontSize(18)
    doc.text(text, margin, y)
    y += 22
  }
  function addSection(title:string, lines:string[]){
    doc.setFontSize(13)
    doc.text(title, margin, y)
    y += 16
    doc.setFontSize(10.5)
    lines.forEach(line=>{
      const wrapped = doc.splitTextToSize(line, maxWidth)
      wrapped.forEach((w:string)=>{
        if(y > 780){
          doc.addPage()
          y = 56
        }
        doc.text(w, margin, y)
        y += 14
      })
    })
    y += 8
  }

  const ident = parsed?.identification || {}
  const parties = parsed?.parties || {}
  const duree = parsed?.duree_du_datapact || {}

  addTitle(`DataPact — ${id}`)
  addSection('Identification', [
    `Nom du couloir: ${ident?.nom_couloir || '—'}`,
    `Type de couloir: ${ident?.type_couloir || '—'}`,
    `Jeu de données: ${ident?.jeu_donnees || '—'}`,
    `Environnement: ${ident?.environnement || '—'}`,
    `Version: ${ident?.version || '—'}`,
  ])
  addSection('Parties prenantes', [
    `Administration du lac: ${displayValue(parties?.administration_du_lac)}`,
    `Gouvernance: ${displayValue(parties?.administrateur_gouvernance)}`,
    `Responsable données: ${displayValue(parties?.responsables?.responsable_donnees)}`,
    `Responsable traitement: ${displayValue(parties?.responsables?.responsable_traitement)}`,
  ])
  addSection('Durée du DataPact', [
    `Durée contrat: ${duree?.duree_contrat || '—'}`,
    `Date d'effet: ${duree?.date_effet || '—'}`,
    `Date de fin: ${duree?.date_fin || '—'}`,
  ])

  datasets.forEach(({key, value})=>{
    const gov = value?.gouvernance || {}
    const loc = gov?.localisation || {}
    const files = loc?.fichiers || {}
    const proc = files?.processus_ingestion || {}
    const dates = proc?.dates_ingestion || {}
    const conf = gov?.conformite || {}
    const perso = conf?.donnees_personnelles || {}
    const cons = conf?.conservation_et_purge || {}
    addSection(`Jeu de données — ${value?.nom || key}`, [
      `Description: ${value?.description || '—'}`,
      `Finalité associée: ${value?.finalite_associee || '—'}`,
      `Zone du couloir: ${loc?.zone_du_couloir || '—'}`,
      `Chemin dossier: ${loc?.chemin_dossier || '—'}`,
      `Fichier déclaré: ${files?.nom_fichier_declare || files?.identifiant_fichier || '—'}`,
      `Format: ${files?.format || '—'}`,
      `Processus ingestion: ${proc?.nom || '—'}`,
      `Fréquence MAJ: ${proc?.frequence_mise_a_jour || '—'}`,
      `Dernière ingestion: ${dates?.date_derniere_ingestion || '—'}`,
      `Finalité principale: ${conf?.finalite_principale || '—'}`,
      `Fondement juridique: ${conf?.fondement_juridique || '—'}`,
      `Identifiant DCPOD: ${conf?.identifiant_dcpod || '—'}`,
      `Fiche conformité: ${conf?.identifiant_fiche_conformite || '—'}`,
      `Statut DCPOD: ${conf?.statut_dcpod || '—'}`,
      `Données personnelles: ${displayValue(perso?.contient_donnees_personnelles)}`,
      `Données sensibles RGPD: ${displayValue(perso?.contient_donnees_sensibles_rgpd)}`,
      `Données particulières: ${displayValue(perso?.contient_donnees_particulieres)}`,
      `Durée conservation: ${cons?.duree_conservation || '—'}`,
      `Date purge prévisionnelle: ${cons?.date_purge_previsionnelle || '—'}`,
      `Sécurité: ${displayValue(gov?.transverse?.securite)}`,
      `Incidents: ${displayValue(gov?.transverse?.incidents)}`,
    ])
  })

  if(habilitations.length){
    addSection('Habilitations', habilitations.map(h =>
      `${h.dataset} — ${labelize(h.section)} · ${labelize(h.type)} · ${h.identifiant || '—'} · ${h.droits || '—'} · ${h.debut || '—'} -> ${h.fin || '—'}`
    ))
  } else {
    addSection('Habilitations', ['Aucune habilitation déclarée.'])
  }

  return doc
}

function buildAuditPdf({id, parsed, datasets, habilitations}:{id:string; parsed:any; datasets:Dataset[]; habilitations:any[]}){
  const doc = new jsPDF({ unit:'pt', format:'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 48
  const maxWidth = pageWidth - margin * 2
  let y = 56

  function addTitle(text:string){
    doc.setFontSize(18)
    doc.text(text, margin, y)
    y += 22
  }
  function addSection(title:string, lines:string[]){
    doc.setFontSize(13)
    doc.text(title, margin, y)
    y += 16
    doc.setFontSize(10.5)
    lines.forEach(line=>{
      const wrapped = doc.splitTextToSize(line, maxWidth)
      wrapped.forEach((w:string)=>{
        if(y > 780){
          doc.addPage()
          y = 56
        }
        doc.text(w, margin, y)
        y += 14
      })
    })
    y += 8
  }

  addTitle(`Audit gouvernance — ${id}`)
  const ident = parsed?.identification || {}
  addSection('Identification', [
    `Couloir: ${ident?.nom_couloir || '—'}`,
    `Type: ${ident?.type_couloir || '—'}`,
    `Environnement: ${ident?.environnement || '—'}`,
    `Version: ${ident?.version || '—'}`,
  ])

  datasets.forEach(({key, value})=>{
    const conf = ((value?.gouvernance || {}).conformite) || {}
    const hab = value?.habilitations || {}
    addSection(`RGPD — ${value?.id || key}`, [
      `Finalité principale: ${conf?.finalite_principale || '—'}`,
      `Fondement juridique: ${conf?.fondement_juridique || '—'}`,
      `Identifiant DCPOD: ${conf?.identifiant_dcpod || '—'}`,
      `Statut DCPOD: ${conf?.statut_dcpod || '—'}`,
    ])
    addSection(`Habilitations — ${value?.id || key}`, [
      `Utilisateurs applicatifs: ${((hab?.utilisateurs || {}).comptes_applicatifs || []).length}`,
      `Utilisateurs nominatifs: ${((hab?.utilisateurs || {}).comptes_nominatifs || []).length}`,
      `Réutilisateurs applicatifs: ${((hab?.re_utilisateurs || {}).comptes_applicatifs || []).length}`,
      `Réutilisateurs nominatifs: ${((hab?.re_utilisateurs || {}).comptes_nominatifs || []).length}`,
    ])
  })

  addSection('Dépendances', (parsed?.dependances_couloirs || []).map((d:any)=>(
    `${d?.couloir_source || '—'} → ${d?.jeu_donnees || '—'} · ${d?.finalite || '—'}`
  )))
  addSection('Incidents', (datasets || []).map(({key, value})=>{
    const inc = value?.gouvernance?.transverse?.incidents
    return `${value?.id || key}: ${displayValue(inc)}`
  }))
  addSection('Habilitations (détail)', habilitations.map(h =>
    `${h.dataset} — ${labelize(h.section)} · ${labelize(h.type)} · ${h.identifiant || '—'} · ${h.droits || '—'} · ${h.debut || '—'} -> ${h.fin || '—'}`
  ))
  return doc
}

export default function App(){
  const [view, setView] = useState<View>({kind:'list'})
  const [items, setItems] = useState<DataPactMeta[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [rail, setRail] = useState<'explorer'|'search'|'alerts'|'settings'>('explorer')

  async function refresh(){
    setLoading(true)
    try{ setItems(await listDataPacts()) } finally { setLoading(false) }
  }
  useEffect(()=>{ refresh() }, [])

  const filtered = useMemo(()=>{
    const s = q.trim().toLowerCase()
    if(!s) return items
    return items.filter(x =>
      (x.id||'').toLowerCase().includes(s) ||
      (x.couloir||'').toLowerCase().includes(s) ||
      (x.jeu_donnees||'').toLowerCase().includes(s)
    )
  }, [items,q])
  const couloirTypes = useMemo(()=>{
    const map: Record<string, string> = {}
    items.forEach(x=>{
      if(x.couloir) map[x.couloir] = x.type_couloir || ''
    })
    return map
  }, [items])

  return (
    <div className="dc-app">
      <div className="dc-topbar">
        <div className="dc-brand">
          <div className="dc-logo">D</div>
          <div>
            <div className="dc-title">DataPact DGFiP</div>
            <div className="dc-subtitle">DGFiP — contrats de données</div>
          </div>
        </div>
        <button className="dc-btn" onClick={refresh}>{loading ? "…" : "Rafraîchir"}</button>
      </div>
      <div className="dc-shell">
        <aside className="dc-rail">
          <button className={`dc-rail-btn${rail === 'explorer' ? ' active' : ''}`} title="Explorateur" onClick={()=>setRail('explorer')}>▦</button>
          <button className={`dc-rail-btn${rail === 'search' ? ' active' : ''}`} title="Recherche" onClick={()=>setRail('search')}>🔎</button>
          <button className={`dc-rail-btn${rail === 'alerts' ? ' active' : ''}`} title="Alertes" onClick={()=>setRail('alerts')}>⚠︎</button>
          <button className={`dc-rail-btn${rail === 'settings' ? ' active' : ''}`} title="Paramètres" onClick={()=>setRail('settings')}>⚙︎</button>
        </aside>
        <aside className="dc-sidebar">
          {rail === 'explorer' && (
            <>
              <div className="dc-sidebar-header">DataPacts</div>
              <input className="dc-input" placeholder="Rechercher..." value={q} onChange={e=>setQ(e.target.value)} />
              <div className="dc-list">
                {filtered.map(x=>(
                  <button
                    key={x.id}
                    className={`dc-list-item${view.kind === 'detail' && view.id === x.id ? ' active' : ''}`}
                    onClick={()=>setView({kind:'detail', id:x.id})}
                  >
                    <div className="dc-list-title">
                      {x.couloir || x.id}
                      <span className={couloirTagClass(x.type_couloir)}>{x.type_couloir || '—'}</span>
                    </div>
                    <div className="dc-list-meta">{x.jeu_donnees || '—'} · {x.version || '—'}</div>
                  </button>
                ))}
                {filtered.length === 0 && (
                  <div className="dc-empty">Aucun DataPact.</div>
                )}
              </div>
            </>
          )}
          {rail === 'search' && (
            <>
              <div className="dc-sidebar-header">Recherche</div>
              <input className="dc-input" placeholder="Couloir / jeu / id..." value={q} onChange={e=>setQ(e.target.value)} />
              <div className="dc-empty">Résultats dans la liste.</div>
            </>
          )}
          {rail === 'alerts' && (
            <>
              <div className="dc-sidebar-header">Alertes</div>
              <div className="dc-empty">Voir l’onglet Alertes dans le détail.</div>
            </>
          )}
          {rail === 'settings' && (
            <>
              <div className="dc-sidebar-header">Paramètres</div>
              <div className="dc-empty">Paramètres UI à venir.</div>
            </>
          )}
        </aside>
        <main className="dc-main">
          {view.kind === 'detail' ? (
            <Detail id={view.id} onBack={()=>setView({kind:'list'})} onSaved={refresh} couloirTypes={couloirTypes} />
          ) : (
            <div className="dc-empty-state">
              Sélectionne un DataPact dans la liste.
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function Detail({id, onBack, onSaved, couloirTypes}:{id:string; onBack:()=>void; onSaved:()=>void; couloirTypes:Record<string,string>}){
  const [tab, setTab] = useState(TABS[0])
  const [data, setData] = useState<any>(null)
  const [form, setForm] = useState<any>(null)
  const [schema, setSchema] = useState<any>(null)
  const [schemaErrors, setSchemaErrors] = useState<SchemaError[]>([])
  const [hist, setHist] = useState<any>(null)
  const [alerts, setAlerts] = useState<any[]>([])
  const [notifications, setNotifications] = useState<any[]>([])
  const [activity, setActivity] = useState<any[]>([])
  const [dashboard, setDashboard] = useState<any>(null)
  const [dashboardFilters, setDashboardFilters] = useState({couloir:'', environnement:'', type_couloir:''})
  const [c2s, setC2s] = useState<any>(null)
  const [dcpodStatuses, setDcpodStatuses] = useState<any[]>([])
  const [workflowActor, setWorkflowActor] = useState('anonymous')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string|undefined>()

  async function load(){
    setErr(undefined)
    setBusy(true)
    try{
      const d = await getDataPact(id)
      const s = await getSchema()
      const h = await historyDataPact(id)
      setData(d)
      setSchema(s)
      const baseForm = d.parsed || {}
      if(!baseForm.statut_datapact) baseForm.statut_datapact = 'brouillon'
      if(!baseForm.workflow) baseForm.workflow = []
      setForm(baseForm)
      setHist(h)
      try{
        const a = await getAlerts(id)
        setAlerts(a.items || [])
      } catch { setAlerts([]) }
      try{
        const n = await getNotifications(id)
        setNotifications(n.items || [])
      } catch { setNotifications([]) }
      try{
        const act = await getActivity()
        setActivity(act.items || [])
      } catch { setActivity([]) }
      try{
        const dash = await getDashboard()
        setDashboard(dash)
      } catch { setDashboard(null) }
      try{
        const c2sRes = await getC2S(id)
        setC2s(c2sRes)
      } catch { setC2s(null) }
    } catch(e:any){
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function refreshDashboard(){
    try{
      const dash = await getDashboard({
        couloir: dashboardFilters.couloir || undefined,
        environnement: dashboardFilters.environnement || undefined,
        type_couloir: dashboardFilters.type_couloir || undefined,
      })
      setDashboard(dash)
    } catch(e:any){
      setErr(String(e?.message || e))
    }
  }

  useEffect(()=>{ load() }, [id])

  async function save(){
    setErr(undefined)
    setBusy(true)
    try{
      const yamlText = yaml.dump(form || {}, { noRefs:true, lineWidth: 120 })
      await saveDataPact(id, yamlText)
      await load()
      onSaved()
    } catch(e:any){
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  const ajvValidate = useMemo(()=>{
    if(!schema) return null
    const ajv = new Ajv({ allErrors: true, strict: false })
    addFormats(ajv)
    return ajv.compile(schema)
  }, [schema])

  useEffect(()=>{
    if(!ajvValidate || !form) return
    const ok = ajvValidate(form)
    if(ok){
      setSchemaErrors([])
      return
    }
    const errors = (ajvValidate.errors || []).map(err=>({
      path: pathKey(parseInstancePath(err.instancePath)),
      message: err.message || 'Erreur de validation',
    }))
    setSchemaErrors(errors)
  }, [form, ajvValidate])

  const parsed = data?.parsed || {}
  const validation = data?.validation
  const ident = parsed?.identification || {}
  const datasets = useMemo(()=> getDatasets(form || parsed), [form, parsed])
  const datasetIds = useMemo(()=> datasets.map((d:any)=> d?.id).filter(Boolean), [datasets])
  const habilitations = useMemo(()=> collectHabilitations(datasets), [datasets])
  const incidents = useMemo(()=> collectIncidents(datasets), [datasets])
  const canExport = Boolean(form)
  const hasBlocking = (validation?.issues || []).some((i:any)=> i.severity === 'bloquant')
  const canSave = schemaErrors.length === 0 && !hasBlocking
  const riskScore = data?.risk_score
  const yamlText = useMemo(()=> yaml.dump(form || {}, { noRefs:true, lineWidth: 120 }), [form])

  function updateForm(path:(string|number)[], value:any){
    setForm((prev:any)=> updateAtPath(prev || {}, path, value))
  }

  function nodeClassByType(type?: string){
    if(!type) return 'dc-node'
    const t = type.toLowerCase()
    if(t === 'ingestion') return 'dc-node dc-node-ingestion'
    if(t === 'valorisation') return 'dc-node dc-node-valorisation'
    if(t === 'experimentation') return 'dc-node dc-node-experimentation'
    return 'dc-node'
  }

  function updateStatus(newStatus: string, decision: string){
    const date = new Date().toISOString()
    setForm((prev:any)=>{
      const workflow = Array.isArray(prev?.workflow) ? [...prev.workflow] : []
      workflow.push({ date, acteur: workflowActor || 'anonymous', decision, statut: newStatus })
      return { ...prev, statut_datapact: newStatus, workflow }
    })
  }

  async function exportAuditJson(){
    const payload = { datapact: form || {} }
    const text = JSON.stringify(payload)
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    const hash = Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('')
    const signed = { ...payload, signature: { algo: 'SHA-256', hash } }
    const blob = new Blob([JSON.stringify(signed, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-${id}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  useEffect(()=>{
    const ids = datasets
      .map((d:any)=> d?.gouvernance?.conformite?.identifiant_dcpod)
      .filter(Boolean)
    if(ids.length === 0){
      setDcpodStatuses([])
      return
    }
    Promise.all(ids.map((dcpodId:string)=> getDcpod(dcpodId).catch(()=>({identifiant:dcpodId, status:'invalide'}))))
      .then(setDcpodStatuses)
  }, [datasets])

  function renderField(fieldKey: string, fieldSchema:any, value:any, path:(string|number)[], isRequired?: boolean){
    const error = schemaErrors.find(e => e.path === pathKey(path))
    if(fieldSchema?.enum){
      return (
        <div className="form-field">
          <label>{labelize(fieldKey)}{isRequired ? ' *' : ''}</label>
          <select className="input" value={value || ''} onChange={e=>updateForm(path, e.target.value)}>
            <option value=""></option>
            {fieldSchema.enum.map((opt:any)=> <option key={String(opt)} value={String(opt)}>{String(opt)}</option>)}
          </select>
          {error && <div className="small error">{error.message}</div>}
        </div>
      )
    }
    if(fieldSchema?.type === 'string'){
      const type = fieldSchema.format === 'date' ? 'date' : fieldSchema.format === 'date-time' ? 'datetime-local' : 'text'
      return (
        <div className="form-field">
          <label>{labelize(fieldKey)}{isRequired ? ' *' : ''}</label>
          <input className="input" type={type} value={value || ''} onChange={e=>updateForm(path, e.target.value)} />
          {error && <div className="small error">{error.message}</div>}
        </div>
      )
    }
    if(fieldSchema?.type === 'number' || fieldSchema?.type === 'integer'){
      return (
        <div className="form-field">
          <label>{labelize(fieldKey)}{isRequired ? ' *' : ''}</label>
          <input className="input" type="number" value={value ?? ''} onChange={e=>updateForm(path, Number(e.target.value))} />
          {error && <div className="small error">{error.message}</div>}
        </div>
      )
    }
    if(fieldSchema?.type === 'boolean'){
      return (
        <div className="form-field">
          <label>
            <input type="checkbox" checked={Boolean(value)} onChange={e=>updateForm(path, e.target.checked)} />
            <span style={{marginLeft:8}}>{labelize(fieldKey)}{isRequired ? ' *' : ''}</span>
          </label>
          {error && <div className="small error">{error.message}</div>}
        </div>
      )
    }
    if(fieldSchema?.type === 'array'){
      const itemsSchema = fieldSchema.items || {}
      const arr = Array.isArray(value) ? value : []
      const isStringArray = itemsSchema?.type === 'string'
      if(fieldKey === 'donnees_ids'){
        return (
          <div className="form-field">
            <label>{labelize(fieldKey)}{isRequired ? ' *' : ''}</label>
            <select className="input" multiple value={arr} onChange={e=>{
              const opts = Array.from(e.currentTarget.selectedOptions).map(o=>o.value)
              updateForm(path, opts)
            }}>
              {datasetIds.map(idOpt=> <option key={idOpt} value={idOpt}>{idOpt}</option>)}
            </select>
            {error && <div className="small error">{error.message}</div>}
          </div>
        )
      }
      return (
        <div className="form-field">
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6}}>
            <label>{labelize(fieldKey)}{isRequired ? ' *' : ''}</label>
            <button className="dc-btn dc-btn-secondary" onClick={()=>{
              const next = [...arr, defaultForSchema(itemsSchema)]
              updateForm(path, next)
            }}>Ajouter</button>
          </div>
          <div className="list">
            {arr.map((item:any, idx:number)=>(
              <div key={idx} className="item">
                <div style={{display:'flex', justifyContent:'space-between', marginBottom:8}}>
                  <div className="small">Élément {idx+1}</div>
                  <button className="dc-btn dc-btn-secondary" onClick={()=>{
                    const next = arr.filter((_:any, i:number)=> i !== idx)
                    updateForm(path, next)
                  }}>Supprimer</button>
                </div>
                {isStringArray ? (
                  <input className="input" value={item || ''} onChange={e=>{
                    const next = [...arr]
                    next[idx] = e.target.value
                    updateForm(path, next)
                  }} />
                ) : (
                  renderObject(itemsSchema, item, path.concat(idx))
                )}
              </div>
            ))}
          </div>
          {error && <div className="small error">{error.message}</div>}
        </div>
      )
    }
    if(fieldSchema?.type === 'object'){
      return (
        <div className="form-field">
          <label>{labelize(fieldKey)}{isRequired ? ' *' : ''}</label>
          {renderObject(fieldSchema, value || {}, path)}
        </div>
      )
    }
    return null
  }

  function renderObject(objSchema:any, objValue:any, path:(string|number)[], filterKeys?:string[]){
    const props = objSchema?.properties || {}
    const requiredSet = new Set(objSchema?.required || [])
    const keys = Object.keys(props).filter(k => !filterKeys || filterKeys.includes(k))
    return (
      <div className="form-grid">
        {keys.map(key => renderField(key, props[key], objValue?.[key], path.concat(key), requiredSet.has(key)))}
      </div>
    )
  }

  return (
    <div className="container">
      {notifications.length > 0 && (
        <div className="dc-banner">
          <div className="dc-banner-title">Notifications</div>
          <div className="dc-banner-list">
            {notifications.slice(0, 4).map((n, i)=>(
              <div key={i} className="dc-banner-item">{n.message}</div>
            ))}
            {notifications.length > 4 && <div className="dc-banner-item">… {notifications.length - 4} autres</div>}
          </div>
        </div>
      )}
      <div className="topbar">
        <div>
          <div className="h1">{id}</div>
          <div className="small">
            {ident?.nom_couloir || '—'} · <span className={couloirTagClass(ident?.type_couloir)}>{ident?.type_couloir || '—'}</span> · {ident?.environnement || '—'} · v{ident?.version || '—'}
          </div>
        </div>
        <div style={{display:'flex', gap:8, alignItems:'center'}}>
          {validation && <StatusBadge status={validation.status} completeness={validation.completeness} />}
          <button className="dc-btn dc-btn-secondary" onClick={onBack}>Retour</button>
          <button
            className="dc-btn"
            onClick={save}
            disabled={busy || !canSave}
          >
            Sauvegarder
          </button>
        </div>
      </div>

      {err && <div className="card" style={{borderColor:'rgba(251,113,133,0.5)', marginBottom:12}}>{err}</div>}
      {!canSave && (
        <div className="card" style={{borderColor:'rgba(251,113,133,0.5)', marginBottom:12}}>
          <div style={{fontWeight:650, marginBottom:6}}>Sauvegarde bloquée</div>
          {schemaErrors.length > 0 && (
            <div className="small">
              <div style={{marginBottom:6}}>Erreurs de schéma détectées :</div>
              <ul style={{margin:0, paddingLeft:16}}>
                {schemaErrors.slice(0, 8).map((e, i)=>(
                  <li key={i}>{e.path || 'root'} — {e.message}</li>
                ))}
              </ul>
              {schemaErrors.length > 8 && <div className="small">… {schemaErrors.length - 8} autres erreurs</div>}
            </div>
          )}
          {hasBlocking && (
            <div className="small" style={{marginTop:8}}>
              Des erreurs bloquantes sont présentes : la sauvegarde est refusée.
            </div>
          )}
        </div>
      )}
      {busy && !data && <div className="card">Chargement…</div>}

      {data && (
        <>
          <div className="dc-detail-split">
            <div className="dc-pane">
              <div className="dc-tabs">
                <Tabs tabs={TABS} active={tab} onChange={setTab} />
              </div>

              <div className="grid2">
                <Issues title="Bloquants" items={validation?.issues || []} color="var(--bad)" />
                <Issues title="Avertissements" items={validation?.warnings || []} color="var(--warn)" />
              </div>

              <div className="card" style={{marginTop:12}}>
            {tab === "Identification" && schema?.properties?.identification && (
              <div className="list">
                <Collapsible title="Identification" defaultOpen>
                  {renderField("id", schema.properties.id, form?.id || '', ["id"], true)}
                  {renderObject(schema.properties.identification, form?.identification || {}, ["identification"])}
                </Collapsible>
                <Collapsible title="Parties" defaultOpen>
                  {renderObject(schema.properties.parties, form?.parties || {}, ["parties"])}
                </Collapsible>
                <Collapsible title="Durée du DataPact" defaultOpen>
                  {renderObject(schema.properties.duree_du_datapact, form?.duree_du_datapact || {}, ["duree_du_datapact"])}
                </Collapsible>
              </div>
            )}

            {tab === "Données" && schema?.definitions?.donnee && (
              <div>
                <div className="list" style={{marginBottom:12}}>
                  {datasets.map((d:any, idx:number)=>(
                    <div key={d?.id || idx} className="item">
                      <div style={{display:'flex', justifyContent:'space-between', gap:12}}>
                        <div style={{fontWeight:650}}>{d?.id || `donnee_${idx+1}`}</div>
                        <button className="dc-btn dc-btn-secondary" disabled={!d?.id} onClick={async()=>{
                          if(!d?.id) return
                          const cat = await getCatalogue(d.id)
                          const next = {...d}
                          if(cat?.titre && !next.nom) next.nom = cat.titre
                          if(cat?.description) next.description = cat.description
                          if(cat?.metadonnees){
                            next.gouvernance = next.gouvernance || {}
                            next.gouvernance.connaissance = next.gouvernance.connaissance || {}
                            next.gouvernance.connaissance.liste_metadonnees = cat.metadonnees
                          }
                          updateForm(["donnees", idx], next)
                        }}>Préremplir catalogue</button>
                      </div>
                      <div className="small">Préremplissage mock depuis le catalogue.</div>
                    </div>
                  ))}
                </div>
                <div className="list">
                  {(form?.donnees || []).map((d:any, idx:number)=>(
                    <Collapsible key={d?.id || idx} title={`Jeu de données — ${d?.id || idx+1}`} defaultOpen={idx===0}>
                      <Collapsible title="Général" defaultOpen>
                        {renderObject(schema.definitions.donnee, d, ["donnees", idx], ["id","nom","description","finalite_associee"])}
                      </Collapsible>
                      <Collapsible title="Utilisateurs">
                        {renderObject(schema.definitions.utilisateurs, d?.utilisateurs || {}, ["donnees", idx, "utilisateurs"])}
                      </Collapsible>
                      <Collapsible title="Habilitations">
                        {renderObject(schema.definitions.habilitations, d?.habilitations || {}, ["donnees", idx, "habilitations"])}
                      </Collapsible>
                      <Collapsible title="Gouvernance">
                        <Collapsible title="Localisation">
                          {renderObject(schema.definitions.gouvernance.properties.localisation, d?.gouvernance?.localisation || {}, ["donnees", idx, "gouvernance", "localisation"])}
                        </Collapsible>
                        <Collapsible title="Connaissance">
                          {renderObject(schema.definitions.gouvernance.properties.connaissance, d?.gouvernance?.connaissance || {}, ["donnees", idx, "gouvernance", "connaissance"])}
                        </Collapsible>
                        <Collapsible title="Qualité">
                          {renderObject(schema.definitions.gouvernance.properties.qualite, d?.gouvernance?.qualite || {}, ["donnees", idx, "gouvernance", "qualite"])}
                        </Collapsible>
                        <Collapsible title="Conformité">
                          {renderObject(schema.definitions.gouvernance.properties.conformite, d?.gouvernance?.conformite || {}, ["donnees", idx, "gouvernance", "conformite"])}
                        </Collapsible>
                        <Collapsible title="Transverse">
                          {renderObject(schema.definitions.gouvernance.properties.transverse, d?.gouvernance?.transverse || {}, ["donnees", idx, "gouvernance", "transverse"])}
                        </Collapsible>
                      </Collapsible>
                    </Collapsible>
                  ))}
                  {renderField("donnees", schema.properties.donnees, form?.donnees || [], ["donnees"])}
                </div>
              </div>
            )}

            {tab === "Habilitations" && (
              <div>
                {habilitations.length === 0 ? (
                  <div className="small">Aucune habilitation.</div>
                ) : (
                  <table className="table compact">
                    <thead>
                      <tr>
                        <th>Jeu</th>
                        <th>Section</th>
                        <th>Type</th>
                        <th>Identifiant</th>
                        <th>Droits</th>
                        <th>Période</th>
                      </tr>
                    </thead>
                    <tbody>
                      {habilitations.map((h, i)=>(
                        <tr key={i}>
                          <td>{h.dataset}</td>
                          <td>{labelize(h.section)}</td>
                          <td>{labelize(h.type)}</td>
                          <td>{h.identifiant || '—'}</td>
                          <td>{h.droits || '—'}</td>
                          <td>{h.debut || '—'} · {h.fin || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="list" style={{marginTop:12}}>
                  {datasets.map((d:any, idx:number)=>(
                    <Collapsible key={d?.id || idx} title={d?.nom || d?.id || `Jeu ${idx+1}`} defaultOpen={idx===0}>
                      {schema?.definitions?.utilisateurs && (
                        <Collapsible title="Utilisateurs (sans droits)" defaultOpen>
                          {renderObject(schema.definitions.utilisateurs, d?.utilisateurs || {}, ["donnees", idx, "utilisateurs"])}
                        </Collapsible>
                      )}
                      {schema?.definitions?.habilitations && (
                        <Collapsible title="Habilitations" defaultOpen>
                          {renderObject(schema.definitions.habilitations, d?.habilitations || {}, ["donnees", idx, "habilitations"])}
                        </Collapsible>
                      )}
                    </Collapsible>
                  ))}
                </div>
              </div>
            )}

            {tab === "Cas d'usage" && schema?.properties?.cas_d_usage && (
              <Collapsible title="Cas d'usage" defaultOpen>
                {renderField("cas_d_usage", schema.properties.cas_d_usage, form?.cas_d_usage || [], ["cas_d_usage"])}
              </Collapsible>
            )}

            {tab === "Dépendances" && (
              <div>
                {schema?.properties?.dependances_couloirs && (
                  <Collapsible title="Dépendances" defaultOpen>
                    {renderField("dependances_couloirs", schema.properties.dependances_couloirs, form?.dependances_couloirs || [], ["dependances_couloirs"])}
                  </Collapsible>
                )}
                <div style={{height:320, marginTop:12}}>
                  <ReactFlow
                    nodes={(form?.dependances_couloirs || []).map((d:any, i:number)=>({
                      id: `src-${i}`,
                      data:{label: d.couloir_source || `Source ${i+1}`},
                      position:{x: 50, y: i*60},
                      className: nodeClassByType(couloirTypes[d.couloir_source || ''])
                    })).concat([{
                      id: 'self',
                      data:{label: ident?.nom_couloir || 'Couloir'},
                      position:{x: 300, y: 80},
                      className: nodeClassByType(ident?.type_couloir)
                    }])}
                    edges={(form?.dependances_couloirs || []).map((_:any, i:number)=>({ id:`e-${i}`, source:`src-${i}`, target:'self' }))}
                    fitView
                  >
                    <Background />
                    <Controls />
                  </ReactFlow>
                </div>
              </div>
            )}

            {tab === "Diffusion" && schema?.properties?.politique_diffusion && (
              <Collapsible title="Politique de diffusion" defaultOpen>
                {renderField("politique_diffusion", schema.properties.politique_diffusion, form?.politique_diffusion || [], ["politique_diffusion"])}
              </Collapsible>
            )}

            {tab === "Gouvernance" && (
              <div style={{height:360}}>
                <ReactFlow
                  nodes={[
                    { id: 'self', data:{label: ident?.nom_couloir || 'Couloir'}, position:{x: 50, y: 80}, className: nodeClassByType(ident?.type_couloir) },
                    ...(form?.politique_diffusion || []).map((d:any, i:number)=>({
                      id: `target-${i}`,
                      data:{label: d.couloir_cible || `Cible ${i+1}`},
                      position:{x: 260, y: 40 + i*80},
                      className: nodeClassByType(couloirTypes[d.couloir_cible || ''])
                    }))
                  ]}
                  edges={(form?.politique_diffusion || []).map((_:any, i:number)=>({ id:`e-${i}`, source:'self', target:`target-${i}` }))}
                  fitView
                >
                  <Background />
                  <Controls />
                </ReactFlow>
              </div>
            )}

            {tab === "Incidents" && (
              <div className="list">
                {incidents.length === 0 && <div className="small">Aucun incident référencé.</div>}
                {incidents.map((it, i)=>(
                  <div key={i} className="item">
                    <div className="section-title">{it.dataset}</div>
                    <div className="kv">
                      {Object.entries(it.incidents || {}).map(([k, v])=>(
                        <React.Fragment key={k}>
                          <div className="k">{labelize(k)}</div>
                          <div>{displayValue(v)}</div>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === "Alertes" && (
              <div className="list">
                {alerts.length === 0 && <div className="small">Aucune alerte.</div>}
                {alerts.map((a, i)=>(
                  <div key={i} className="item">
                    <div style={{display:'flex', justifyContent:'space-between', gap:12}}>
                      <div style={{fontWeight:650}}>{a.kind}</div>
                      <div className="small">J-{a.days_left}</div>
                    </div>
                    <div className="small">{a.title}</div>
                    <div className="small">{a.date}</div>
                  </div>
                ))}
              </div>
            )}

            {tab === "Validation" && (
              <div className="list">
                <Collapsible title="Statut DataPact" defaultOpen>
                  {renderField("statut_datapact", schema?.properties?.statut_datapact, form?.statut_datapact || 'brouillon', ["statut_datapact"], true)}
                  <div className="form-field">
                    <label>Acteur</label>
                    <input className="input" value={workflowActor} onChange={e=>setWorkflowActor(e.target.value)} />
                  </div>
                  <div style={{display:'flex', gap:8}}>
                    <button className="dc-btn dc-btn-secondary" onClick={()=>updateStatus('en_validation', 'Demande de validation')}>Demander validation</button>
                    <button className="dc-btn dc-btn-secondary" onClick={()=>updateStatus('valide', 'Validation approuvée')}>Valider</button>
                    <button className="dc-btn dc-btn-secondary" onClick={()=>updateStatus('retire', 'Retrait')}>Retirer</button>
                  </div>
                </Collapsible>
                <Collapsible title="Exports audit" defaultOpen>
                  <div style={{display:'flex', gap:8}}>
                    <button
                      className="dc-btn dc-btn-secondary"
                      onClick={()=>{
                        const doc = buildAuditPdf({ id, parsed: form || parsed, datasets: datasets.map(d=>({ key: d.id, value: d })), habilitations })
                        doc.save(`audit-${id}.pdf`)
                      }}
                    >
                      Exporter PDF gouvernance
                    </button>
                    <button className="dc-btn dc-btn-secondary" onClick={exportAuditJson}>
                      Exporter JSON signé
                    </button>
                  </div>
                </Collapsible>
                <Collapsible title="Historique de validation" defaultOpen>
                  {(form?.workflow || []).length === 0 ? (
                    <div className="small">Aucune entrée.</div>
                  ) : (
                    <div className="dc-compare-list">
                      {(form?.workflow || []).map((w:any, i:number)=>(
                        <div key={i} className="dc-compare-row">
                          <div className="dc-compare-name">{w.statut}</div>
                          <div className="dc-compare-chip">{w.acteur}</div>
                          <div className="dc-compare-chip">{w.date}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </Collapsible>
              </div>
            )}

            {tab === "Journal" && (
              <div className="list">
                <button className="dc-btn dc-btn-secondary" onClick={()=>{
                  const blob = new Blob([JSON.stringify(activity || [], null, 2)], { type: 'application/json' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `datapact-activity-${id}.json`
                  a.click()
                  URL.revokeObjectURL(url)
                }}>Exporter JSON</button>
                {activity.length === 0 && <div className="small">Aucune entrée.</div>}
                {activity.map((it, i)=>(
                  <div key={i} className="item">
                    <div style={{display:'flex', justifyContent:'space-between', gap:12}}>
                      <div style={{fontWeight:650}}>{it.datapact_id}</div>
                      <div className="small">{it.date}</div>
                    </div>
                    <div className="small">{it.user}</div>
                    <pre className="small">{JSON.stringify(it.changes || {}, null, 2)}</pre>
                  </div>
                ))}
              </div>
            )}

            {tab === "Pilotage" && (
              <div className="list">
                <div className="item">
                  <div className="section-title">Filtres</div>
                  <div className="form-grid">
                    <div className="form-field">
                      <label>Couloir</label>
                      <input className="input" value={dashboardFilters.couloir} onChange={e=>setDashboardFilters({...dashboardFilters, couloir: e.target.value})} />
                    </div>
                    <div className="form-field">
                      <label>Environnement</label>
                      <input className="input" value={dashboardFilters.environnement} onChange={e=>setDashboardFilters({...dashboardFilters, environnement: e.target.value})} />
                    </div>
                    <div className="form-field">
                      <label>Type couloir</label>
                      <input className="input" value={dashboardFilters.type_couloir} onChange={e=>setDashboardFilters({...dashboardFilters, type_couloir: e.target.value})} />
                    </div>
                  </div>
                  <div style={{marginTop:8}}>
                    <button className="dc-btn dc-btn-secondary" onClick={refreshDashboard}>Appliquer</button>
                  </div>
                </div>

                <div className="dc-metrics">
                  <div className="dc-metric-card">
                    <div className="dc-metric-label">Score de risque</div>
                    <div className="dc-metric-value">{riskScore ?? '—'}</div>
                    <div className="dc-progress">
                      <div className="dc-progress-fill" style={{width: `${Math.min(100, Number(riskScore || 0))}%`}} />
                    </div>
                  </div>
                  <div className="dc-metric-card">
                    <div className="dc-metric-label">Conformité moyenne</div>
                    <div className="dc-metric-value">{dashboard?.avg_completeness ?? 0}%</div>
                    <div className="dc-progress">
                      <div className="dc-progress-fill" style={{width: `${Math.min(100, Number(dashboard?.avg_completeness || 0))}%`}} />
                    </div>
                  </div>
                  <div className="dc-metric-card">
                    <div className="dc-metric-label">DataPacts à risque</div>
                    <div className="dc-metric-value">{dashboard?.high_risk ?? 0}</div>
                    <div className="small">Total: {dashboard?.total ?? 0}</div>
                  </div>
                  <div className="dc-metric-card">
                    <div className="dc-metric-label">Données sensibles</div>
                    <div className="dc-metric-value">{dashboard?.sensitive_exposed ?? 0}</div>
                    <div className="small">Expositions détectées</div>
                  </div>
                  <div className="dc-metric-card">
                    <div className="dc-metric-label">Habilitations à risque</div>
                    <div className="dc-metric-value">{dashboard?.habilitations_risk ?? 0}</div>
                    <div className="small">Échéances ≤ 30 jours</div>
                  </div>
                </div>

                <div className="item">
                  <div className="section-title">Distribution des risques</div>
                  <div className="dc-bars">
                    {(dashboard?.risk_items || []).length === 0 && <div className="small">Aucune donnée.</div>}
                    {(dashboard?.risk_items || []).map((item:any, i:number)=>(
                      <div key={i} className="dc-bar-row">
                        <div className="dc-bar-title">{item.id || `#${i+1}`}</div>
                        <div className="dc-bar-line">
                          <div className="dc-bar">
                            <div className="dc-bar-fill" style={{width: `${Math.min(100, Number(item.score || 0))}%`}} />
                          </div>
                          <div className="dc-bar-value">{item.score}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="dc-compare">
                  <div className="dc-compare-card">
                    <div className="section-title">Comparaison C2S</div>
                    {(c2s?.diff || []).length === 0 ? (
                      <div className="small">Aucun écart détecté.</div>
                    ) : (
                      <div className="dc-compare-list">
                        {c2s.diff.map((d:any, i:number)=>(
                          <div key={i} className="dc-compare-row">
                            <div className="dc-compare-name">{d.dataset_id}</div>
                            <div className="dc-compare-chip">Déclaré: {d.declared}</div>
                            <div className="dc-compare-chip warn">Effectif: {d.effective}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="dc-compare-card">
                    <div className="section-title">Contrôle DCPOD</div>
                    {dcpodStatuses.length === 0 ? (
                      <div className="small">Aucun identifiant DCPOD.</div>
                    ) : (
                      <div className="dc-compare-list">
                        {dcpodStatuses.map((d:any, i:number)=>(
                          <div key={i} className="dc-compare-row">
                            <div className="dc-compare-name">{d.identifiant}</div>
                            <div className={`dc-compare-chip ${d.status === 'valide' ? 'ok' : 'warn'}`}>
                              {d.status}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {tab === "Historique" && (
              <div>
                <div className="small">Versions</div>
                <div className="list" style={{marginTop:10}}>
                  {(hist?.versions || []).map((v:any, i:number)=>(
                    <div key={i} className="item">
                      <div style={{display:'flex', justifyContent:'space-between', gap:12}}>
                        <div style={{fontWeight:650}}>{v.stamp}</div>
                        <div className="small">{v.size} octets</div>
                      </div>
                      <div className="small">{v.path}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
            </div>
            <div className="dc-pane dc-pane-preview">
              <div className="dc-preview-header">
                <div className="dc-preview-title">Prévisualisation</div>
                <button
                  className="dc-btn dc-btn-secondary"
                  onClick={()=>{
                    if(!canExport) return
                    const doc = buildPdf({ id, parsed: form || parsed, datasets: datasets.map(d=>({ key: d.id, value: d })), habilitations })
                    doc.save(`datapact-${id}.pdf`)
                  }}
                  disabled={!canExport}
                >
                  Exporter PDF
                </button>
              </div>
              <div className="dc-preview-block">
                <div className="small">YAML (lecture seule)</div>
                <textarea className="input dc-yaml" value={yamlText} readOnly />
              </div>
              <div className="dc-preview-block">
                <div className="small">Résumé validation</div>
                <div className="dc-kv">
                  <div className="k">Statut</div><div>{validation?.status || '—'}</div>
                  <div className="k">Complétude</div><div>{validation?.completeness ?? '—'}%</div>
                  <div className="k">Score risque</div><div>{riskScore ?? '—'}</div>
                </div>
              </div>
              <div className="dc-preview-block">
                <div className="small">Complétude par section</div>
                <div className="dc-kv">
                  {Object.entries(validation?.section_completeness || {}).map(([k, v]:any)=>(
                    <React.Fragment key={k}>
                      <div className="k">{k}</div><div>{v}%</div>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
