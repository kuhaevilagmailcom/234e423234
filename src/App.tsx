import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, CircleDotDashed, CircleGauge, FileText, ShieldCheck, Trophy, UserRound, UsersRound } from 'lucide-react';
import Admin from './Admin';
import { api } from './api';
import type { LeaderRow, MePayload, Statement } from './types';

type Tab = 'zayava' | 'upgrade' | 'wheel' | 'rating' | 'profile' | 'admin';

const nav: { id: Tab; label: string; icon: string }[] = [
  { id: 'zayava', label: 'Заява', icon: 'file' },
  { id: 'upgrade', label: 'Апгрейд', icon: 'upgrade' },
  { id: 'wheel', label: 'Колесо', icon: 'wheel' },
  { id: 'rating', label: 'Рейтинг', icon: 'cup' },
  { id: 'profile', label: 'Профиль', icon: 'user' },
];

const iconMap = { file: FileText, upgrade: CircleGauge, wheel: CircleDotDashed, cup: Trophy, user: UserRound, chev: ChevronRight };
function Icon({ name, size = 22 }: { name: keyof typeof iconMap; size?: number }) {
  const Component = iconMap[name] || FileText;
  return <Component size={size} strokeWidth={1.9}/>;
}

function format(n: number) { return new Intl.NumberFormat('ru-RU').format(Math.round(n)); }
function haptic(type: 'success' | 'error' | 'light' = 'light') {
  if (type === 'light') window.Telegram?.WebApp.HapticFeedback?.impactOccurred('light');
  else window.Telegram?.WebApp.HapticFeedback?.notificationOccurred(type);
}

function rarityClass(rarity: string) { return `rarity rarity-${rarity.toLowerCase().replaceAll(' ', '-')}`; }

export default function App() {
  const [tab, setTab] = useState<Tab>('zayava');
  const [me, setMe] = useState<MePayload | null>(null);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [reasons, setReasons] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [intro, setIntro] = useState(() => localStorage.getItem('zayava_intro_seen') !== '1');

  async function refresh() {
    try {
      const [m, s, r] = await Promise.all([api.me(), api.statements(), api.reasons()]);
      setMe(m); setStatements(s.statements); setReasons(r.reasons); setLocations(r.locations); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка загрузки'); }
  }

  useEffect(() => { refresh().finally(() => setLoading(false)); }, []);

  if (loading) return <div className="splash"><div className="loader"/><b>ЗАГРУЖАЕМ ДЕЛО</b></div>;
  if (!me) return <div className="error-screen"><b>Не удалось открыть игру</b><span>{error}</span><button onClick={() => location.reload()}>Повторить</button></div>;

  if (intro) return <Intro onStart={() => { localStorage.setItem('zayava_intro_seen','1'); setIntro(false); }} />;

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">З</span><div><b>ЗАЯВА</b><small>на Лимузинова</small></div></div>
      <div className="header-actions">
        {me.user.is_admin && <button className="admin-entry" onClick={() => setTab('admin')} aria-label="Админка"><ShieldCheck size={19}/></button>}
        <div className="balance"><span>₽</span>{format(me.user.balance)}</div>
      </div>
    </header>

    <main className="content">
      {error && <div className="toast error">{error}</div>}
      {tab === 'zayava' && <Zayava me={me} statements={statements} reasons={reasons} locations={locations} onChanged={refresh} />}
      {tab === 'upgrade' && <Upgrade statements={statements.filter(s => s.is_active)} onChanged={refresh} />}
      {tab === 'wheel' && <Wheel me={me} onChanged={refresh} />}
      {tab === 'rating' && <Rating />}
      {tab === 'profile' && <Profile me={me} onAdmin={() => setTab('admin')} />}
      {tab === 'admin' && me.user.is_admin && <Admin onBack={() => setTab('profile')} />}
    </main>

    <nav className="bottom-nav">
      {nav.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => { haptic(); setTab(item.id); }}>
        <Icon name={item.icon}/><span>{item.label}</span>
      </button>)}
    </nav>
  </div>;
}

function Intro({ onStart }: { onStart: () => void }) {
  return <div className="intro">
    <div className="intro-stamp">ПАРОДИЯ</div>
    <div className="intro-logo">З</div>
    <h1>ЗАЯВА<br/><span>НА ЛИМУЗИНОВА</span></h1>
    <p>Пиши игровые заявы. Получай рейтинг. Апгрейди документы. Залетай в топ.</p>
    <button className="primary big" onClick={onStart}>НАЧАТЬ</button>
    <small>Игровая пародия. Никакие заявления в реальные органы не отправляются.</small>
  </div>;
}

function Zayava({ me, statements, reasons, locations, onChanged }: { me: MePayload; statements: Statement[]; reasons: string[]; locations: string[]; onChanged: () => Promise<void> }) {
  const receiver = window.Telegram?.WebApp.initDataUnsafe?.receiver;
  const receiverName = receiver ? [receiver.first_name, receiver.last_name].filter(Boolean).join(' ') : '';
  const [mode, setMode] = useState<'home'|'form'|'result'>('home');
  const [category, setCategory] = useState(reasons[0] || 'слишком подозрительно молчит');
  const [location, setLocation] = useState(locations[0] || 'в Telegram');
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState(false);
  const [target, setTarget] = useState<{id?:number; username?:string; name:string}|null>(() => receiver ? { id: receiver.id, username: receiver.username, name: receiverName || receiver.username || 'Пользователь Telegram' } : null);
  const [result, setResult] = useState<{ statement: Statement; reward: { rating: number; balance: number }; phrase: string } | null>(null);
  const active = statements.filter(s => s.is_active);

  useEffect(() => {
    if(receiver) setTarget({ id: receiver.id, username: receiver.username, name: receiverName || receiver.username || 'Пользователь Telegram' });
  }, [receiver?.id]);

  function chooseFriend(){
    const link='https://t.me/perekup_app_bot?startattach=zayava_target&choose=users';
    if(window.Telegram?.WebApp.openTelegramLink) window.Telegram.WebApp.openTelegramLink(link);
    else window.location.href=link;
  }

  if (mode === 'form') return <section className="screen">
    <div className="screen-title"><button className="back" onClick={() => setMode('home')} aria-label="Назад"><ArrowLeft size={20}/></button><div><h2>НОВАЯ ЗАЯВА</h2><p>Заполни игровой бланк</p></div></div>
    <div className="document-card">
      <div className="doc-head"><small>ИГРОВАЯ ПАРОДИЯ</small><b>ЗАЯВЛЕНИЕ</b></div>
      <label><span>От кого</span><div className="static-field">@{me.user.username || me.user.first_name}</div></label>
      <label><span>На кого</span>
        <div className={target ? 'target-card selected' : 'target-card'}>
          <div className="target-avatar"><UserRound size={20}/></div>
          <div><b>{target ? target.name : 'Никто не выбран'}</b><span>{target?.username ? '@'+target.username : 'Выбери человека из личных чатов'}</span></div>
        </div>
        <div className="target-actions">
          <button type="button" onClick={chooseFriend}><UsersRound size={17}/>Выбрать друга из Telegram</button>
          <button type="button" onClick={() => setTarget({ username:'limuzinov', name:'Лимузинов' })}><UserRound size={17}/>@limuzinov</button>
        </div>
      </label>
      <label><span>Причина</span><select value={category} onChange={e => setCategory(e.target.value)}>{reasons.map(r => <option key={r}>{r}</option>)}</select></label>
      <label><span>Место</span><select value={location} onChange={e => setLocation(e.target.value)}>{locations.map(r => <option key={r}>{r}</option>)}</select></label>
      <label><span>Описание ситуации</span><textarea maxLength={500} value={description} onChange={e => setDescription(e.target.value)} placeholder="Опиши событие последовательно: что произошло, когда, где, что было до и после."/><small className="counter">{description.length}/500</small></label>
    </div>
    <button className="primary" disabled={!target || description.trim().length < 20 || sending} onClick={async () => {
      if (!target) return;
      if (!confirm('Подать игровую заяву на '+target.name+'? Она никуда реально не отправится.')) return;
      try {
        setSending(true);
        const r = await api.createStatement({ category, location, description, targetUserId: target.id ?? null, targetUsername: target.username ?? null, targetName: target.name });
        setResult(r); setMode('result'); haptic('success'); await onChanged();
      } catch (e) { alert(e instanceof Error ? e.message : 'Ошибка'); haptic('error'); } finally { setSending(false); }
    }}>{sending ? 'ОЦЕНИВАЕМ…' : 'ПОДАТЬ ИГРОВУЮ ЗАЯВУ'}</button>
    <p className="legal-note">Это пародийная игра. Не указывай реальные адреса, телефоны и другие личные данные.</p>
  </section>;

  if (mode === 'result' && result) return <section className="screen result-screen">
    <div className="stamp">ПРИНЯТО</div>
    <span className="muted">ЗАЯВА №{String(result.statement.id).padStart(7,'0')}</span>
    <div className="score">{result.statement.score}<small>/100</small></div>
    <div className={rarityClass(result.statement.rarity)}>{result.statement.rarity}</div>
    <p className="result-phrase">«{result.phrase}»</p>
    <div className="score-breakdown">
      {(result.statement.score_breakdown || []).map(item => <div className="score-row" key={item.key}>
        <div><b>{item.label}</b><span>{item.note}</span></div>
        <strong>{item.score}/{item.max}</strong>
      </div>)}
    </div>
    <div className="reward-grid"><div><small>РЕЙТИНГ</small><b>+{result.reward.rating} RP</b></div><div><small>ИГРОВЫЕ РУБЛИ</small><b>+{format(result.reward.balance)} ₽</b></div></div>
    <button className="primary" onClick={() => { setDescription(''); setMode('home'); }}>ГОТОВО</button>
  </section>;

  return <section className="screen">
    <div className="hero-card">
      <span className="eyebrow">ТВОЙ СТАТУС</span>
      <div className="rank-line"><div><h2>{me.user.rank_name}</h2><p>{format(me.user.rating)} RP</p></div><div className="place">#{me.stats.place || '—'}</div></div>
      <div className="progress"><span style={{width: String(me.user.rank_progress)+'%'}}/></div>
      <small>{me.user.next_rank_at ? 'До следующего ранга '+format(Math.max(0, me.user.next_rank_at - me.user.rating))+' RP' : 'Максимальный ранг'}</small>
    </div>

    <button className="new-case" onClick={() => setMode('form')}><div className="case-icon"><Icon name="file" size={28}/></div><div><b>НАПИСАТЬ ЗАЯВУ</b><span>Получи оценку, RP и игровые ₽</span></div><Icon name="chev"/></button>

    <div className="section-head"><div><h3>МОИ ЗАЯВЫ</h3><span>{active.length} активных</span></div></div>
    <div className="statement-list">
      {active.length === 0 ? <div className="empty"><b>Пока ни одной заявы</b><span>Самое время исправить.</span></div> : active.slice(0,8).map(item => <StatementRow key={item.id} s={item}/>) }
    </div>
  </section>;
}

function StatementRow({ s, selected, onClick }: { s: Statement; selected?: boolean; onClick?: () => void }) {
  return <button className={`statement-row ${selected ? 'selected' : ''}`} onClick={onClick} disabled={!onClick}>
    <div className="statement-id">№{s.id}</div>
    <div className="statement-main"><b>{s.category}</b><span><i className={rarityClass(s.rarity)}>{s.rarity}</i> · {s.score}/100</span></div>
    <strong>{format(s.value)} З</strong>
  </button>;
}

function Upgrade({ statements, onChanged }: { statements: Statement[]; onChanged: () => Promise<void> }) {
  const [source, setSource] = useState<Statement | null>(statements[0] || null);
  const [multiplier, setMultiplier] = useState(2);
  const [preview, setPreview] = useState<{ targetValue: number; chance: number } | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [angle, setAngle] = useState(0);
  const [outcome, setOutcome] = useState<string>('');

  useEffect(() => { if (!source && statements[0]) setSource(statements[0]); }, [statements, source]);
  useEffect(() => {
    if (!source) { setPreview(null); return; }
    api.upgradePreview(source.id, multiplier).then(setPreview).catch(() => setPreview(null));
  }, [source, multiplier]);

  const chance = preview?.chance ?? 0;
  const circumference = 2 * Math.PI * 74;

  return <section className="screen">
    <div className="screen-title"><div><h2>ПЕРЕСМОТР</h2><p>Апгрейд игровой заявы</p></div></div>
    <div className="upgrade-circle-wrap">
      <div className="pointer">▼</div>
      <svg className="upgrade-svg" viewBox="0 0 180 180">
        <circle cx="90" cy="90" r="74" className="ring-bg"/>
        <circle cx="90" cy="90" r="74" className="ring-win" strokeDasharray={`${circumference * chance/100} ${circumference}`} transform="rotate(-90 90 90)"/>
      </svg>
      <div className="upgrade-marker" style={{ transform: `rotate(${angle}deg)` }}><span/></div>
      <div className="upgrade-center"><b>{chance.toFixed(1)}%</b><span>ШАНС УСПЕХА</span></div>
    </div>

    <div className="multis">{[1.5,2,3,5].map(m => <button className={m===multiplier?'active':''} onClick={() => setMultiplier(m)} key={m}>x{m}</button>)}</div>

    <div className="upgrade-pair">
      <div><small>ТВОЯ ЗАЯВА</small><b>{source ? `${format(source.value)} З` : '—'}</b></div>
      <span>→</span>
      <div><small>ЦЕЛЬ</small><b>{preview ? `${format(preview.targetValue)} З` : '—'}</b></div>
    </div>

    <div className="section-head"><div><h3>ВЫБЕРИ ЗАЯВУ</h3><span>она будет использована</span></div></div>
    <div className="statement-list compact">{statements.length ? statements.slice(0,7).map(s => <StatementRow key={s.id} s={s} selected={source?.id===s.id} onClick={() => setSource(s)}/>) : <div className="empty"><b>Нет активных заяв</b><span>Сначала напиши новую.</span></div>}</div>

    {outcome && <div className={`outcome ${outcome.includes('ОДОБРЕН') ? 'good' : 'bad'}`}>{outcome}</div>}
    <button className="primary" disabled={!source || spinning} onClick={async () => {
      if (!source) return;
      setSpinning(true); setOutcome('');
      try {
        const r = await api.upgrade(source.id, multiplier);
        setAngle(prev => (Math.floor(prev / 360) + 5) * 360 + r.finalAngle);
        setTimeout(async () => { setOutcome(r.success ? 'ПЕРЕСМОТР ОДОБРЕН' : 'В ПЕРЕСМОТРЕ ОТКАЗАНО'); haptic(r.success ? 'success':'error'); await onChanged(); setSource(null); setSpinning(false); }, 2400);
      } catch (e) { alert(e instanceof Error ? e.message : 'Ошибка'); setSpinning(false); }
    }}>{spinning ? 'РАССМАТРИВАЕМ…' : 'ПОДАТЬ НА ПЕРЕСМОТР'}</button>
  </section>;
}

const wheelLabels = ['50 З','100 З','250 З','500 З','25 RP','50 RP','РЕДКАЯ','ЭПИК','x2','ДЖЕКПОТ'];
function polar(cx:number, cy:number, r:number, a:number){ const rad=(a-90)*Math.PI/180; return {x:cx+r*Math.cos(rad), y:cy+r*Math.sin(rad)}; }
function sectorPath(i:number,total:number){ const a0=i*360/total, a1=(i+1)*360/total; const p0=polar(100,100,92,a0), p1=polar(100,100,92,a1); return `M100 100 L${p0.x} ${p0.y} A92 92 0 0 1 ${p1.x} ${p1.y} Z`; }

function Wheel({ me, onChanged }: { me: MePayload; onChanged: () => Promise<void> }) {
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [reward, setReward] = useState('');
  const seg = 360 / wheelLabels.length;
  return <section className="screen">
    <div className="screen-title"><div><h2>КОЛЕСО УЧАСТКОВОГО</h2><p>Только виртуальные игровые награды</p></div></div>
    <div className="wheel-status"><div><small>БЕСПЛАТНОЕ ВРАЩЕНИЕ</small><b>{me.wheel.freeAvailable ? '1 / 1' : '0 / 1'}</b></div><span>{me.wheel.freeAvailable ? 'Доступно сейчас' : `Ещё одно — ${me.wheel.paidCost} З`}</span></div>
    <div className="wheel-wrap"><div className="wheel-pointer">▼</div><svg viewBox="0 0 200 200" className="wheel-svg" style={{transform:`rotate(${rotation}deg)`}}>
      {wheelLabels.map((label,i) => {
        const mid=i*seg+seg/2; const p=polar(100,100,65,mid);
        return <g key={label}><path d={sectorPath(i,wheelLabels.length)} className={`wheel-sector s${i}`}/><text x={p.x} y={p.y} transform={`rotate(${mid} ${p.x} ${p.y})`} className="wheel-text" textAnchor="middle">{label}</text></g>;
      })}
      <circle cx="100" cy="100" r="23" className="wheel-hub"/><text x="100" y="104" textAnchor="middle" className="wheel-z">З</text>
    </svg></div>
    {reward && <div className="wheel-reward"><small>ВЫПАЛО</small><b>{reward}</b></div>}
    <button className="primary" disabled={spinning} onClick={async () => {
      setSpinning(true); setReward('');
      try { const r=await api.spin(); setRotation(prev => (Math.floor(prev / 360) + 7) * 360 - (r.segmentIndex * seg + seg / 2)); setTimeout(async()=>{setReward(r.reward.label);haptic('success');await onChanged();setSpinning(false);},3000); }
      catch(e){alert(e instanceof Error?e.message:'Ошибка');setSpinning(false);}
    }}>{spinning?'КРУТИМ…':me.wheel.freeAvailable?'КРУТИТЬ БЕСПЛАТНО':`КРУТИТЬ ЗА ${me.wheel.paidCost} З`}</button>
    <p className="legal-note">Нет реальных денег, ставок и вывода средств — только игровая валюта.</p>
  </section>;
}

function Rating() {
  const [period,setPeriod]=useState('all');
  const [rows,setRows]=useState<LeaderRow[]>([]);
  const [mine,setMine]=useState({place:0,rating:0});
  useEffect(()=>{api.leaderboard(period).then(r=>{setRows(r.rows);setMine({place:r.myPlace,rating:r.myRating});});},[period]);
  return <section className="screen"><div className="screen-title"><div><h2>ТОП ЗАЯВЩИКОВ</h2><p>Кто сегодня главный по бумагам</p></div></div>
    <div className="period-tabs">{[['day','День'],['week','Неделя'],['month','Месяц'],['all','Всё']].map(([v,l])=><button key={v} className={period===v?'active':''} onClick={()=>setPeriod(v)}>{l}</button>)}</div>
    <div className="leaderboard">{rows.map((r,i)=><div className={`leader-row ${i<3?'top':''}`} key={`${r.username}-${r.place}`}><div className="leader-place">{i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${r.place}`}</div><div><b>@{r.username || r.first_name}</b><span>{format(r.rating)} RP</span></div></div>)}</div>
    <div className="my-rank"><div><small>ТВОЁ МЕСТО</small><b>#{mine.place}</b></div><strong>{format(mine.rating)} RP</strong></div>
  </section>;
}

function Profile({me}:{me:MePayload}) {
  const u=me.user,s=me.stats;
  return <section className="screen"><div className="profile-head">{u.avatar_url?<img src={u.avatar_url}/>:<div className="avatar-fallback">{u.first_name[0]?.toUpperCase()}</div>}<div><h2>{u.first_name}</h2><p>@{u.username || 'telegram_user'}</p></div></div>
    <div className="profile-rank"><small>ТВОЙ РАНГ</small><b>{u.rank_name}</b><span>{format(u.rating)} RP · место #{s.place}</span></div>
    <div className="stats-grid"><Stat n={s.statements} l="Заяв"/><Stat n={Math.round(s.avg_score)} l="Средняя"/><Stat n={s.best_score} l="Лучшая"/><Stat n={s.upgrades} l="Апгрейдов"/><Stat n={s.upgrade_wins} l="Успешных"/><Stat n={s.spins} l="Вращений"/></div>
    <div className="disclaimer-card"><b>Это пародийная игра</b><p>Никакие формы из приложения не отправляются в МВД, полицию, Госуслуги или другие реальные организации.</p></div>
  </section>;
}
function Stat({n,l}:{n:number;l:string}){return <div className="stat"><b>{format(n)}</b><span>{l}</span></div>}
