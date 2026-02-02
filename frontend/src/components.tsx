import React from 'react'

export function StatusBadge({status, completeness}:{status:string; completeness:number}){
  const color = status === 'valide' ? 'var(--good)' : 'var(--bad)'
  return (
    <span className="badge">
      <span className="dot" style={{background: color}} />
      {status} · {completeness}%
    </span>
  )
}

export function Issues({title, items, color}:{title:string; items:{path:string; severity:string; message:string}[]; color:string}){
  return (
    <div className="item">
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:12}}>
        <div style={{fontWeight:650}}>{title}</div>
        <span className="badge"><span className="dot" style={{background: color}} />{items.length}</span>
      </div>
      <div className="list" style={{marginTop:10}}>
        {items.length === 0 ? <div className="small">Aucun</div> : items.map((x, i)=>(
          <div key={i} className="small">
            <span style={{color:'var(--text)'}}>{x.message}</span>
            <div>{x.path}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Tabs({tabs, active, onChange}:{tabs:string[]; active:string; onChange:(t:string)=>void}){
  return (
    <div className="tabs">
      {tabs.map(t=>(
        <button key={t} className={"tab"+(t===active?" active":"")} onClick={()=>onChange(t)}>
          {t}
        </button>
      ))}
    </div>
  )
}

export function Collapsible({title, children, defaultOpen=false}:{title:string; children:React.ReactNode; defaultOpen?:boolean}){
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <div className="dc-collapse">
      <button className="dc-collapse-header" onClick={()=>setOpen(!open)}>
        <span>{title}</span>
        <span className="dc-collapse-icon">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="dc-collapse-body">{children}</div>}
    </div>
  )
}
