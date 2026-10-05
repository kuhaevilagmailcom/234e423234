import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 8787);
const dbPath = path.resolve(root, process.env.DATABASE_PATH || './data/zayava.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '50kb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

const ranks = [
  { min:0, name:'Свидетель' }, { min:100, name:'Заявитель' }, { min:250, name:'Постоянный посетитель' },
  { min:500, name:'Опытный заявщик' }, { min:1000, name:'Старший заявщик' }, { min:2500, name:'Гроза Лимузинова' },
  { min:5000, name:'Главный свидетель' }, { min:10000, name:'Особо важный заявитель' }
];
const locations = ['во дворе','у подъезда','в Telegram','в школе','в магазине','на районе','в лимузине','на парковке','в чате','неизвестно','другое'];
const verbs = ['украл','спрятал','забрал','проигнорировал','перепутал','удалил','сломал','заспамил','занял','присвоил'];
const objects = ['последнюю шаурму','лучший ник в Telegram','мем из чата','зарядку от телефона','последний энергетик','место у окна','пачку сухариков','стикерпак','музыку из плейлиста','пульт от телевизора'];
const reasons = Array.from({length:100}, (_,i) => {
  if (i===0) return 'сказал «щас выйду» и не вышел';
  if (i===1) return 'слишком долго печатает и ничего не отправляет';
  if (i===2) return 'проехал мимо на лимузине и не поздоровался';
  if (i===3) return 'поставил реакцию не по пацанскому кодексу';
  if (i===4) return 'объявил себя главным без голосования';
  const v=verbs[i%verbs.length], o=objects[Math.floor(i/verbs.length)%objects.length];
  return `${v} ${o}`;
});
const phrases = ['Участковый впечатлён.','Материал выглядит подробно.','Тема раскрыта последовательно.','Не хватает конкретики, но принято.','Хорошо описана последовательность событий.','Документ зарегистрирован в игровой базе.','Оценка рассчитана по содержанию и деталям.'];

const adminUsernames = new Set(
  (process.env.ADMIN_USERNAMES || 'limuzinov')
    .split(',')
    .map(v => v.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean)
);
const adminTelegramIds = new Set(
  (process.env.ADMIN_TELEGRAM_IDS || '')
    .split(',')
    .map(v => Number(v.trim()))
    .filter(Number.isFinite)
);

function ensureColumn(table:string,column:string,definition:string){
  const cols=db.prepare('PRAGMA table_info('+table+')').all() as Array<{name:string}>;
  if(!cols.some(c=>c.name===column)) db.exec('ALTER TABLE '+table+' ADD COLUMN '+column+' '+definition);
}

function initDb(){
  db.exec(`
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER UNIQUE NOT NULL, username TEXT DEFAULT '', first_name TEXT NOT NULL, avatar_url TEXT, balance INTEGER NOT NULL DEFAULT 1000, rating INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS statements(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, category TEXT NOT NULL, location TEXT NOT NULL, description TEXT NOT NULL, score INTEGER NOT NULL, rarity TEXT NOT NULL, value INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, is_active INTEGER NOT NULL DEFAULT 1, FOREIGN KEY(user_id) REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS upgrades(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, source_statement_id INTEGER NOT NULL, target_value INTEGER NOT NULL, chance REAL NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS wheel_spins(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, reward_type TEXT NOT NULL, reward_value INTEGER NOT NULL, paid INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS rating_history(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS idx_statements_user_active ON statements(user_id,is_active);
    CREATE INDEX IF NOT EXISTS idx_rating_history_user_date ON rating_history(user_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_wheel_user_date ON wheel_spins(user_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_users_activity ON users(last_seen,telegram_id);
  `);
  ensureColumn('statements','target_user_id','INTEGER');
  ensureColumn('statements','target_username','TEXT');
  ensureColumn('statements','target_name','TEXT');
  ensureColumn('statements','score_breakdown','TEXT');
  db.prepare('DELETE FROM users WHERE telegram_id < 0').run();
}
initDb();

function validateInitData(initData:string, token:string){
  const p=new URLSearchParams(initData); const hash=p.get('hash'); if(!hash || !/^[a-f0-9]{64}$/i.test(hash)) return false; p.delete('hash');
  const data=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
  const secret=crypto.createHmac('sha256','WebAppData').update(token).digest();
  const calc=crypto.createHmac('sha256',secret).update(data).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(calc,'hex'),Buffer.from(hash,'hex'));
}

declare global {
  namespace Express { interface Request { userId: number } }
}
function auth(req:Request,res:Response,next:NextFunction){
  const initData=String(req.headers['x-telegram-init-data']||'');
  const token=process.env.BOT_TOKEN||'';
  const demoAllowed=process.env.ALLOW_DEMO_AUTH==='true' && process.env.NODE_ENV!=='production';
  let tgUser:{id:number;first_name:string;username?:string;photo_url?:string}|null=null;
  if(initData){
    if(token){
      if(!validateInitData(initData,token)) return res.status(401).json({error:'Не удалось проверить Telegram-сессию'});
    } else if(!demoAllowed){
      return res.status(503).json({error:'BOT_TOKEN не настроен на сервере'});
    }
    try{const raw=new URLSearchParams(initData).get('user');if(raw)tgUser=JSON.parse(raw);}catch{}
  }
  if(!tgUser){ if(!demoAllowed) return res.status(401).json({error:'Открой игру внутри Telegram'}); tgUser={id:777000001,first_name:'Брат',username:'demo_user'}; }
  db.prepare(`INSERT INTO users(telegram_id,username,first_name,avatar_url,last_seen) VALUES(?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username,first_name=excluded.first_name,avatar_url=COALESCE(excluded.avatar_url,users.avatar_url),last_seen=CURRENT_TIMESTAMP`).run(tgUser.id,tgUser.username||'',tgUser.first_name,tgUser.photo_url||null);
  const row=db.prepare('SELECT id FROM users WHERE telegram_id=?').get(tgUser.id) as {id:number}; req.userId=row.id; next();
}
app.use('/api',auth);

function getRank(rating:number){let cur=ranks[0],next:null|typeof ranks[number]=null;for(let i=0;i<ranks.length;i++){if(rating>=ranks[i].min)cur=ranks[i];else{next=ranks[i];break;}}const base=cur.min;const progress=next?Math.max(0,Math.min(100,((rating-base)/(next.min-base))*100)):100;return {rank_name:cur.name,next_rank_at:next?.min??null,rank_progress:progress};}
function rarity(score:number){if(score>=100)return 'Золотая';if(score>=95)return 'Особо важная';if(score>=80)return 'Легендарная';if(score>=60)return 'Эпическая';if(score>=40)return 'Редкая';return 'Обычная';}
function serializeStatement(s:any){return {...s,is_active:Number(s.is_active)};}
function scoreText(text:string,duplicateCount:number){const clean=text.trim();const words=clean.toLowerCase().split(/\s+/).filter(Boolean);const unique=new Set(words).size;let score=25;score+=Math.min(30,Math.floor(clean.length/8));score+=Math.min(25,unique*2);if(clean.length>=80)score+=8;if(/[.!?]/.test(clean))score+=4;if(/(.)\1{5,}/i.test(clean))score-=35;if(unique<=2)score-=30;if(duplicateCount>0)score-=20;return Math.max(5,Math.min(100,score));}
function periodWhere(period:string){if(period==='day')return "AND rh.created_at >= datetime('now','-1 day')";if(period==='week')return "AND rh.created_at >= datetime('now','-7 days')";if(period==='month')return "AND rh.created_at >= datetime('now','-30 days')";return '';}
function secureFloat(){return crypto.randomInt(0,1_000_000)/1_000_000;}
function pickWeighted<T extends {weight:number}>(arr:T[]){const total=arr.reduce((a,b)=>a+b.weight,0);let roll=secureFloat()*total;for(const item of arr){roll-=item.weight;if(roll<=0)return item;}return arr[arr.length-1];}

app.get('/api/reasons',(_req,res)=>res.json({reasons,locations}));
app.get('/api/statements',(req:Request,res)=>{const rows=db.prepare('SELECT id,category,location,description,score,rarity,value,created_at,is_active FROM statements WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.userId);res.json({statements:rows.map(serializeStatement)});});
app.get('/api/me',(req:Request,res)=>{
  const u=db.prepare('SELECT * FROM users WHERE id=?').get(req.userId) as any;
  const stats=db.prepare(`SELECT COUNT(*) statements,COALESCE(AVG(score),0) avg_score,COALESCE(MAX(score),0) best_score FROM statements WHERE user_id=?`).get(req.userId) as any;
  const up=db.prepare(`SELECT COUNT(*) upgrades,SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) upgrade_wins FROM upgrades WHERE user_id=?`).get(req.userId) as any;
  const spins=(db.prepare('SELECT COUNT(*) c FROM wheel_spins WHERE user_id=?').get(req.userId) as any).c;
  const place=(db.prepare('SELECT COUNT(*)+1 p FROM users WHERE rating>?').get(u.rating) as any).p;
  const last=db.prepare('SELECT created_at FROM wheel_spins WHERE user_id=? AND paid=0 ORDER BY id DESC LIMIT 1').get(req.userId) as any;
  const nextFreeAt=last?new Date(new Date(last.created_at+'Z').getTime()+12*3600e3):null; const freeAvailable=!nextFreeAt||nextFreeAt.getTime()<=Date.now();
  res.json({user:{id:u.id,telegram_id:u.telegram_id,username:u.username,first_name:u.first_name,avatar_url:u.avatar_url,balance:u.balance,rating:u.rating,...getRank(u.rating)},stats:{...stats,upgrades:up.upgrades||0,upgrade_wins:up.upgrade_wins||0,spins,place},wheel:{freeAvailable,nextFreeAt:freeAvailable?null:nextFreeAt?.toISOString(),paidCost:250}});
});

app.post('/api/statements',(req:Request,res)=>{
  const {category,location,description}=req.body||{}; if(!reasons.includes(category)||!locations.includes(location))return res.status(400).json({error:'Выбери причину и место из списка'}); if(typeof description!=='string'||description.trim().length<20||description.length>500)return res.status(400).json({error:'Описание должно быть от 20 до 500 символов'});
  const dup=(db.prepare('SELECT COUNT(*) c FROM statements WHERE user_id=? AND lower(description)=lower(?)').get(req.userId,description.trim()) as any).c;
  const score=scoreText(description,dup), r=rarity(score), value=score*50, reward=Math.max(50,score*5), ratingGain=score;
  const tx=db.transaction(()=>{const info=db.prepare('INSERT INTO statements(user_id,category,location,description,score,rarity,value) VALUES(?,?,?,?,?,?,?)').run(req.userId,category,location,description.trim(),score,r,value);db.prepare('UPDATE users SET balance=balance+?, rating=rating+? WHERE id=?').run(reward,ratingGain,req.userId);db.prepare('INSERT INTO rating_history(user_id,amount,reason) VALUES(?,?,?)').run(req.userId,ratingGain,'statement');return Number(info.lastInsertRowid);});
  const id=tx(); const s=db.prepare('SELECT id,category,location,description,score,rarity,value,created_at,is_active FROM statements WHERE id=?').get(id);res.json({statement:serializeStatement(s),reward:{rating:ratingGain,balance:reward},phrase:phrases[crypto.randomInt(phrases.length)]});
});

app.post('/api/upgrades/preview',(req:Request,res)=>{const sourceId=Number(req.body?.sourceId),multiplier=Number(req.body?.multiplier);if(![1.5,2,3,5].includes(multiplier))return res.status(400).json({error:'Неверный множитель'});const s=db.prepare('SELECT id,category,location,description,score,rarity,value,created_at,is_active FROM statements WHERE id=? AND user_id=? AND is_active=1').get(sourceId,req.userId) as any;if(!s)return res.status(404).json({error:'Заява не найдена'});const targetValue=Math.round(s.value*multiplier/50)*50,chance=Math.max(5,Math.min(90,(s.value/targetValue)*95));res.json({source:serializeStatement(s),targetValue,chance});});
app.post('/api/upgrades',(req:Request,res)=>{const sourceId=Number(req.body?.sourceId),multiplier=Number(req.body?.multiplier);if(![1.5,2,3,5].includes(multiplier))return res.status(400).json({error:'Неверный множитель'});const s=db.prepare('SELECT * FROM statements WHERE id=? AND user_id=? AND is_active=1').get(sourceId,req.userId) as any;if(!s)return res.status(404).json({error:'Заява уже использована или не существует'});const targetValue=Math.round(s.value*multiplier/50)*50,chance=Math.max(5,Math.min(90,(s.value/targetValue)*95)),success=secureFloat()*100<chance;let newId:number|undefined;
  const tx=db.transaction(()=>{const changed=db.prepare('UPDATE statements SET is_active=0 WHERE id=? AND user_id=? AND is_active=1').run(sourceId,req.userId);if(changed.changes!==1)throw new Error('already-used');db.prepare('INSERT INTO upgrades(user_id,source_statement_id,target_value,chance,result) VALUES(?,?,?,?,?)').run(req.userId,sourceId,targetValue,chance,success?'win':'lose');if(success){const score=Math.min(100,Math.max(s.score+1,Math.round(targetValue/50)));const info=db.prepare('INSERT INTO statements(user_id,category,location,description,score,rarity,value) VALUES(?,?,?,?,?,?,?)').run(req.userId,`Пересмотр: ${s.category}`,s.location,'Заява повышена после игрового пересмотра.',score,rarity(score),targetValue);newId=Number(info.lastInsertRowid);}});
  try{tx();}catch{return res.status(409).json({error:'Эта заява уже использована'});} const finalAngle=success?Math.max(2,secureFloat()*Math.max(2,chance-4)):chance+2+secureFloat()*Math.max(2,96-chance);const statement=newId?serializeStatement(db.prepare('SELECT id,category,location,description,score,rarity,value,created_at,is_active FROM statements WHERE id=?').get(newId)):undefined;res.json({success,chance,targetValue,finalAngle,statement});
});

const wheelRewards=[
  {label:'50 З',type:'balance',value:50,weight:23,segmentIndex:0},{label:'100 З',type:'balance',value:100,weight:20,segmentIndex:1},{label:'250 З',type:'balance',value:250,weight:14,segmentIndex:2},{label:'500 З',type:'balance',value:500,weight:8,segmentIndex:3},
  {label:'25 RP',type:'rating',value:25,weight:12,segmentIndex:4},{label:'50 RP',type:'rating',value:50,weight:8,segmentIndex:5},{label:'Редкая заява',type:'statement',value:2500,weight:7,segmentIndex:6},{label:'Эпическая заява',type:'statement',value:3500,weight:4,segmentIndex:7},{label:'x2 баланс',type:'double',value:0,weight:3.5,segmentIndex:8},{label:'ДЖЕКПОТ',type:'statement',value:50000,weight:.5,segmentIndex:9}
];
app.post('/api/wheel/spin',(req:Request,res)=>{const user=db.prepare('SELECT * FROM users WHERE id=?').get(req.userId) as any;const last=db.prepare('SELECT created_at FROM wheel_spins WHERE user_id=? AND paid=0 ORDER BY id DESC LIMIT 1').get(req.userId) as any;const nextFree=last?new Date(new Date(last.created_at+'Z').getTime()+12*3600e3):null;const free=!nextFree||nextFree.getTime()<=Date.now();const cost=250;if(!free&&user.balance<cost)return res.status(400).json({error:`Нужно ${cost} З для дополнительного вращения`});const reward={...pickWeighted(wheelRewards)};const tx=db.transaction(()=>{if(!free){const c=db.prepare('UPDATE users SET balance=balance-? WHERE id=? AND balance>=?').run(cost,req.userId,cost);if(c.changes!==1)throw new Error('balance');}if(reward.type==='balance')db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(reward.value,req.userId);else if(reward.type==='rating'){db.prepare('UPDATE users SET rating=rating+? WHERE id=?').run(reward.value,req.userId);db.prepare('INSERT INTO rating_history(user_id,amount,reason) VALUES(?,?,?)').run(req.userId,reward.value,'wheel');}else if(reward.type==='double'){const bonus=Math.min(5000,Math.max(0,user.balance-(free?0:cost)));db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(bonus,req.userId);reward.label=`x2: +${bonus} З`;}else if(reward.type==='statement'){const score=reward.value>=50000?100:reward.value>=3500?70:50;db.prepare('INSERT INTO statements(user_id,category,location,description,score,rarity,value) VALUES(?,?,?,?,?,?,?)').run(req.userId,reward.value>=50000?'Золотая заява на Лимузинова':'Награда колеса','в игровом отделе','Получено из Колеса участкового.',score,rarity(score),reward.value);}db.prepare('INSERT INTO wheel_spins(user_id,reward_type,reward_value,paid) VALUES(?,?,?,?)').run(req.userId,reward.type,reward.value,free?0:1);});try{tx();}catch{return res.status(409).json({error:'Не удалось провести вращение'});}res.json({reward:{label:reward.label,type:reward.type,value:reward.value},segmentIndex:reward.segmentIndex,paid:!free});});

app.get('/api/leaderboard',(req:Request,res)=>{const period=String(req.query.period||'all');const where=periodWhere(period);let rows:any[];let myRating:number;if(period==='all'){rows=db.prepare('SELECT id,username,first_name,rating FROM users ORDER BY rating DESC,id ASC LIMIT 50').all() as any[];myRating=(db.prepare('SELECT rating FROM users WHERE id=?').get(req.userId) as any).rating;}else{rows=db.prepare(`SELECT u.id,u.username,u.first_name,COALESCE(SUM(rh.amount),0) rating FROM users u LEFT JOIN rating_history rh ON rh.user_id=u.id ${where} GROUP BY u.id HAVING rating>0 ORDER BY rating DESC,u.id ASC LIMIT 50`).all() as any[];myRating=(db.prepare(`SELECT COALESCE(SUM(rh.amount),0) rating FROM rating_history rh WHERE rh.user_id=? ${where}`).get(req.userId) as any).rating;}const allScores=period==='all'?db.prepare('SELECT id,rating FROM users ORDER BY rating DESC,id ASC').all() as any[]:db.prepare(`SELECT u.id,COALESCE(SUM(rh.amount),0) rating FROM users u LEFT JOIN rating_history rh ON rh.user_id=u.id ${where} GROUP BY u.id ORDER BY rating DESC,u.id ASC`).all() as any[];const myPlace=Math.max(1,allScores.findIndex(x=>x.id===req.userId)+1);res.json({rows:rows.map((r,i)=>({place:i+1,username:r.username,first_name:r.first_name,rating:r.rating,is_me:r.id===req.userId})),myPlace,myRating});});

if(process.env.NODE_ENV==='production'){
  const dist=path.join(root,'dist');
  const indexFile=path.join(dist,'index.html');

  if(fs.existsSync(indexFile)){
    console.log('Serving prebuilt frontend from dist/');
    app.use(express.static(dist));
    app.use((req,res,next)=>{
      if(req.path.startsWith('/api')) return next();
      res.sendFile(indexFile);
    });
  } else {
    console.log('dist/index.html not found — starting Vite middleware fallback');
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root,
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  }
}

app.use((err:any,_req:Request,res:Response,_next:NextFunction)=>{
  console.error(err);
  res.status(500).json({error:'Внутренняя ошибка сервера'});
});
app.listen(port,()=>console.log(`Zayava app server: http://localhost:${port}`));
