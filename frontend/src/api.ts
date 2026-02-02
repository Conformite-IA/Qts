export type Validation = {
  status: string
  completeness: number
  issues: {path:string; severity:string; message:string}[]
  warnings: {path:string; severity:string; message:string}[]
}

export type DataPactMeta = {
  id: string
  couloir?: string
  type_couloir?: string
  jeu_donnees?: string
  environnement?: string
  version?: string
  updated_at?: string
  responsable_donnees?: string
}

const API = 'http://localhost:8000/api'

export async function listDataPacts(): Promise<DataPactMeta[]> {
  const r = await fetch(`${API}/datapacts`)
  if(!r.ok) throw new Error('Erreur liste')
  return r.json()
}

export async function getDataPact(id: string): Promise<{id:string; yaml:string; parsed:any; validation:Validation; risk_score:number}> {
  const r = await fetch(`${API}/datapacts/${encodeURIComponent(id)}`)
  if(!r.ok) throw new Error('Introuvable')
  return r.json()
}

export async function saveDataPact(id: string, yaml: string): Promise<{meta:any; validation:Validation}> {
  const r = await fetch(`${API}/datapacts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({yaml})
  })
  const text = await r.text()
  if(!r.ok) throw new Error(text || 'Erreur sauvegarde')
  return JSON.parse(text)
}

export async function historyDataPact(id: string): Promise<{id:string; versions:{path:string; stamp:string; size:number}[]}> {
  const r = await fetch(`${API}/datapacts/${encodeURIComponent(id)}/history`)
  if(!r.ok) throw new Error('Erreur historique')
  return r.json()
}

export async function getSchema(): Promise<any> {
  const r = await fetch(`${API}/schema`)
  if(!r.ok) throw new Error('Erreur schema')
  return r.json()
}

export async function getAlerts(datapactId?: string): Promise<{items:any[]}> {
  const q = datapactId ? `?datapact_id=${encodeURIComponent(datapactId)}` : ''
  const r = await fetch(`${API}/alerts${q}`)
  if(!r.ok) throw new Error('Erreur alertes')
  return r.json()
}

export async function getNotifications(datapactId?: string): Promise<{items:any[]}> {
  const q = datapactId ? `?datapact_id=${encodeURIComponent(datapactId)}` : ''
  const r = await fetch(`${API}/notifications${q}`)
  if(!r.ok) throw new Error('Erreur notifications')
  return r.json()
}

export async function getActivity(): Promise<{items:any[]}> {
  const r = await fetch(`${API}/activity`)
  if(!r.ok) throw new Error('Erreur journal')
  return r.json()
}

export async function getDashboard(filters?: {couloir?:string; environnement?:string; type_couloir?:string}): Promise<any> {
  const params = new URLSearchParams()
  if(filters?.couloir) params.set('couloir', filters.couloir)
  if(filters?.environnement) params.set('environnement', filters.environnement)
  if(filters?.type_couloir) params.set('type_couloir', filters.type_couloir)
  const qs = params.toString()
  const r = await fetch(`${API}/dashboard${qs ? `?${qs}` : ''}`)
  if(!r.ok) throw new Error('Erreur dashboard')
  return r.json()
}

export async function getC2S(datapactId: string): Promise<any> {
  const r = await fetch(`${API}/integrations/c2s/${encodeURIComponent(datapactId)}`)
  if(!r.ok) throw new Error('Erreur C2S')
  return r.json()
}

export async function getDcpod(id: string): Promise<any> {
  const r = await fetch(`${API}/integrations/dcpod/${encodeURIComponent(id)}`)
  if(!r.ok) throw new Error('Erreur DCPOD')
  return r.json()
}

export async function getCatalogue(datasetId: string): Promise<any> {
  const r = await fetch(`${API}/integrations/catalogue/${encodeURIComponent(datasetId)}`)
  if(!r.ok) throw new Error('Erreur catalogue')
  return r.json()
}
