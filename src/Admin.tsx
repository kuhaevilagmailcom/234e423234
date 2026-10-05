import { useEffect, useState } from 'react';
import { ArrowLeft, Eye, Search, ShieldCheck, UserRound, X } from 'lucide-react';
import { api } from './api';
import type { AdminStatement } from './types';

function format(n:number){ return new Intl.NumberFormat('ru-RU').format(Math.round(n)); }

export default function Admin({ onBack }:{ onBack:()=>void }) {
  const [items,setItems]=useState<AdminStatement[]>([]);
  const [query,setQuery]=useState('');
  const [selected,setSelected]=useState<AdminStatement|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');

  async function load(q=''){
    try{
      setLoading(true);
      const r=await api.adminStatements(q);
      setItems(r.statements);
      setError('');
    }catch(e){
      setError(e instanceof Error?e.message:'Ошибка загрузки');
    }finally{
      setLoading(false);
    }
  }

  useEffect(()=>{ void load(); },[]);

  return <section className="screen admin-screen">
    <div className="screen-title">
      <button className="back" onClick={onBack} aria-label="Назад"><ArrowLeft size={20}/></button>
      <div><h2>АДМИНКА</h2><p>Все игровые заявы пользователей</p></div>
    </div>

    <div className="admin-search">
      <Search size={18}/>
      <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Автор, адресат или тема"
        onKeyDown={e=>{ if(e.key==='Enter') void load(query); }}/>
      <button onClick={()=>void load(query)}>Найти</button>
    </div>

    <div className="admin-summary">
      <ShieldCheck size={20}/>
      <div><b>{items.length}</b><span>последних заяв загружено</span></div>
    </div>

    {error && <div className="toast error">{error}</div>}
    {loading ? <div className="empty"><b>Загружаю заявы…</b></div> :
      <div className="admin-list">
        {items.length===0 ? <div className="empty"><b>Ничего не найдено</b></div> :
          items.map(item=><button className="admin-item" key={item.id} onClick={()=>setSelected(item)}>
            <div className="admin-item-icon"><UserRound size={18}/></div>
            <div className="admin-item-main">
              <b>№{item.id} · @{item.author_username||item.author_name}</b>
              <span>на {item.target_username?('@'+item.target_username):(item.target_name||'не указано')}</span>
              <small>{item.category}</small>
            </div>
            <div className="admin-item-score"><b>{item.score}</b><span>/100</span><Eye size={15}/></div>
          </button>)
        }
      </div>
    }

    {selected && <div className="admin-modal-backdrop" onClick={()=>setSelected(null)}>
      <div className="admin-modal" onClick={e=>e.stopPropagation()}>
        <button className="admin-close" onClick={()=>setSelected(null)} aria-label="Закрыть"><X size={19}/></button>
        <span className="eyebrow">ЗАЯВА №{selected.id}</span>
        <h3>{selected.category}</h3>
        <div className="admin-meta">
          <div><small>От</small><b>@{selected.author_username||selected.author_name}</b></div>
          <div><small>На</small><b>{selected.target_username?('@'+selected.target_username):(selected.target_name||'—')}</b></div>
          <div><small>Оценка</small><b>{selected.score}/100</b></div>
          <div><small>Игровая ценность</small><b>{format(selected.value)} ₽</b></div>
        </div>
        <div className="admin-description">{selected.description}</div>
        <div className="score-breakdown admin-breakdown">
          {(selected.score_breakdown||[]).map(x=><div className="score-row" key={x.key}>
            <div><b>{x.label}</b><span>{x.note}</span></div>
            <strong>{x.score}/{x.max}</strong>
          </div>)}
        </div>
      </div>
    </div>}
  </section>;
}
