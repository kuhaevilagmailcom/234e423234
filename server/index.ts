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
function rarity(score:number){if(score>=100)return 'Золотая';if(score>=97)return 'Особо важная';if(score>=90)return 'Легендарная';if(score>=75)return 'Эпическая';if(score>=55)return 'Редкая';return 'Обычная';}
function serializeStatement(row:any){
  let score_breakdown:any[]=[];
  try{score_breakdown=row.score_breakdown?JSON.parse(row.score_breakdown):[];}catch{}
  return {...row,score_breakdown,is_active:Number(row.is_active)};
}
function isAdminUser(u:any){
  if(!u) return false;
  const username=String(u.username||'').replace(/^@/,'').toLowerCase();
  return adminTelegramIds.has(Number(u.telegram_id)) || adminUsernames.has(username) || (process.env.NODE_ENV!=='production' && username==='demo_user');
}
function requireAdmin(req:Request,res:Response,next:NextFunction){
  const u=db.prepare('SELECT telegram_id,username FROM users WHERE id=?').get(req.userId) as any;
  if(!isAdminUser(u)) return res.status(403).json({error:'Нет доступа к админке'});
  next();
}
function normalizeWord(word:string){
  return word.toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]/gi,'').replace(/(иями|ями|ами|ого|ему|ыми|ими|ая|яя|ое|ее|ые|ие|ый|ий|ой|ую|юю|ах|ях|ам|ям|ов|ев|ом|ем|ить|ать|ять|ться|ся)$/u,'');
}
const stopWords=new Set(['это','как','что','когда','тогда','потом','было','была','были','очень','просто','меня','тебя','него','нее','ему','она','они','там','тут','для','или','при','над','под','без','про','его','еще','уже','мне','мной','который','которая']);
function tokenize(text:string){return (text.toLowerCase().match(/[a-zа-яё0-9]+/giu)||[]).map(normalizeWord).filter(w=>w.length>=2&&!stopWords.has(w));}
function evaluateStatement(text:string,category:string,location:string,duplicateCount:number){
  const clean=text.trim().replace(/\s+/g,' ');
  const rawWords=clean.toLowerCase().match(/[a-zа-яё0-9]+/giu)||[];
  const words=tokenize(clean);
  const unique=new Set(words);
  const categoryWords=[...new Set(tokenize(category).filter(w=>w.length>=3))];
  const sentences=clean.split(/[.!?]+/).map(v=>v.trim()).filter(Boolean);
  const overlap=categoryWords.filter(c=>[...unique].some(w=>w===c||w.startsWith(c)||c.startsWith(w))).length;
  const relevanceRatio=categoryWords.length?overlap/categoryWords.length:0;
  const locationWords=tokenize(location);
  const locationMention=locationWords.some(l=>[...unique].some(w=>w===l||w.startsWith(l)||l.startsWith(w)));

  const hasTime=/\b(\d{1,2}[:.]\d{2}|утром|днем|днём|вечером|ночью|сегодня|вчера|позавчера|час|минут|секунд)\b/iu.test(clean);
  const hasSequence=/\b(сначала|затем|потом|после|до этого|в этот момент|когда|далее)\b/iu.test(clean);
  const hasEvidence=/\b(скрин|скриншот|сообщен|переписк|фото|видео|чек|свидетел|запис|голосов|кружок)\w*/iu.test(clean);
  const hasCause=/\b(потому|поэтому|из-за|причин|после того|так как)\b/iu.test(clean);
  const hasQuote=/[«»"']/u.test(clean);
  const hasNumber=/\d/u.test(clean);

  const repeatedChars=/(.)\1{4,}/iu.test(clean);
  const capsLetters=clean.match(/[A-ZА-ЯЁ]/g)?.length||0;
  const allLetters=clean.match(/[A-Za-zА-Яа-яЁё]/g)?.length||1;
  const capsRatio=capsLetters/allLetters;
  const counts=new Map<string,number>(); words.forEach(w=>counts.set(w,(counts.get(w)||0)+1));
  const maxWordRepeat=Math.max(0,...counts.values());
  const repeatRatio=words.length?maxWordRepeat/words.length:1;
  const uniqueRatio=words.length?unique.size/words.length:0;

  const relevance=Math.min(25,Math.round(relevanceRatio*20)+(locationMention?5:0));
  const specifics=Math.min(20,(hasTime?4:0)+(hasSequence?4:0)+(hasEvidence?4:0)+(hasCause?3:0)+(hasQuote?2:0)+(hasNumber?3:0));
  const structure=Math.min(15,Math.round(Math.min(sentences.length,4)/4*8)+(clean.includes(',')?3:0)+(clean.length>=140?4:0));
  const detail=Math.min(15,Math.round(Math.min(rawWords.length,45)/45*15));
  const vocabulary=Math.min(10,Math.round(Math.min(uniqueRatio,0.8)/0.8*10));

  let coherence=15;
  const penalties:string[]=[];
  if(repeatedChars){coherence-=6;penalties.push('повторяющиеся символы');}
  if(capsRatio>.6&&allLetters>20){coherence-=4;penalties.push('слишком много CAPS');}
  if(repeatRatio>.24&&words.length>10){coherence-=5;penalties.push('одно и то же слово повторяется слишком часто');}
  if(duplicateCount>0){coherence-=8;penalties.push('такой текст уже подавался');}
  if(rawWords.length<8){coherence-=6;penalties.push('слишком мало слов');}
  coherence=Math.max(0,coherence);

  let score=relevance+specifics+structure+detail+vocabulary+coherence;
  if(rawWords.length<12) score=Math.min(score,52);
  if(rawWords.length<20||relevance<10||specifics<4) score=Math.min(score,69);
  if(rawWords.length<28||relevance<15||specifics<8||sentences.length<2) score=Math.min(score,84);
  if(rawWords.length<38||relevance<18||specifics<12||sentences.length<3||uniqueRatio<0.5) score=Math.min(score,93);
  if(rawWords.length<50||relevance<21||specifics<15||sentences.length<3||uniqueRatio<0.58) score=Math.min(score,97);
  if(duplicateCount>0) score=Math.min(score,64);
  score=Math.max(5,Math.min(100,Math.round(score)));

  const breakdown=[
    {key:'relevance',label:'Соответствие теме',score:relevance,max:25,note:relevance>=18?'Описание хорошо связано с выбранной причиной':'Раскрой выбранную причину прямо в тексте'},
    {key:'specifics',label:'Конкретные детали',score:specifics,max:20,note:specifics>=12?'Есть время, последовательность или подтверждающие детали':'Добавь когда, где, что было до/после и конкретные детали'},
    {key:'structure',label:'Структура',score:structure,max:15,note:structure>=11?'События описаны понятно':'Разбей историю на несколько последовательных предложений'},
    {key:'detail',label:'Подробность',score:detail,max:15,note:rawWords.length>=28?'Объём достаточный':'Сейчас '+rawWords.length+' слов — для высокой оценки нужно заметно больше'},
    {key:'vocabulary',label:'Разнообразие текста',score:vocabulary,max:10,note:vocabulary>=8?'Мало бессмысленных повторов':'Избегай повторения одних и тех же слов'},
    {key:'coherence',label:'Качество текста',score:coherence,max:15,note:penalties.length?'Штраф: '+penalties.join(', '):'Спам и явные повторы не обнаружены'}
  ];
  return {score,breakdown};
}
function periodWhere(period:string){if(period==='day')return "AND rh.created_at >= datetime('now','-1 day')";if(period==='week')return "AND rh.created_at >= datetime('now','-7 days')";if(period==='month')return "AND rh.created_at >= datetime('now','-30 days')";return '';}
function secureFloat(){return crypto.randomInt(0,1_000_000)/1_000_000;}
function pickWeighted<T extends {weight:number}>(arr:T[]){const total=arr.reduce((a,b)=>a+b.weight,0);let roll=secureFloat()*total;for(const item of arr){roll-=item.weight;if(roll<=0)return item;}return arr[arr.length-1];}
app.get('/api/reasons',(_req,res)=>res.json({reasons,locations}));
app.get('/api/statements',(req:Request,res)=>{const rows=db.prepare('SELECT id,category,location,description,target_user_id,target_username,target_name,score,score_breakdown,rarity,value,created_at,is_active FROM statements WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.userId);res.json({statements:rows.map(serializeStatement)});});
app.get('/api/me',(req:Request,res)=>{
  const u=db.prepare('SELECT * FROM users WHERE id=?').get(req.userId) as any;
  const stats=db.prepare(`SELECT COUNT(*) statements,COALESCE(AVG(score),0) avg_score,COALESCE(MAX(score),0) best_score FROM statements WHERE user_id=?`).get(req.userId) as any;
  const up=db.prepare(`SELECT COUNT(*) upgrades,SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) upgrade_wins FROM upgrades WHERE user_id=?`).get(req.userId) as any;
  const spins=(db.prepare('SELECT COUNT(*) c FROM wheel_spins WHERE user_id=?').get(req.userId) as any).c;
  const place=(db.prepare("SELECT COUNT(*)+1 p FROM users WHERE telegram_id>0 AND last_seen >= datetime('now','-30 days') AND rating>?").get(u.rating) as any).p;
  const last=db.prepare('SELECT created_at FROM wheel_spins WHERE user_id=? AND paid=0 ORDER BY id DESC LIMIT 1').get(req.userId) as any;
  const nextFreeAt=last?new Date(new Date(last.created_at+'Z').getTime()+12*3600e3):null; const freeAvailable=!nextFreeAt||nextFreeAt.getTime()<=Date.now();
  res.json({user:{id:u.id,telegram_id:u.telegram_id,username:u.username,first_name:u.first_name,avatar_url:u.avatar_url,balance:u.balance,rating:u.rating,is_admin:isAdminUser(u),...getRank(u.rating)},stats:{...stats,upgrades:up.upgrades||0,upgrade_wins:up.upgrade_wins||0,spins,place},wheel:{freeAvailable,nextFreeAt:freeAvailable?null:nextFreeAt?.toISOString(),paidCost:0}});
});

app.post('/api/statements',(req:Request,res)=>{
  const {category,location,description,targetUserId,targetUsername,targetName}=req.body||{};
  if(!reasons.includes(category)||!locations.includes(location)) return res.status(400).json({error:'Выбери причину и место из списка'});
  if(typeof description!=='string'||description.trim().length<20||description.length>500) return res.status(400).json({error:'Описание должно быть от 20 до 500 символов'});
  if(typeof targetName!=='string'||targetName.trim().length<1||targetName.trim().length>80) return res.status(400).json({error:'Выбери, на кого пишется игровая заява'});
  if(targetUsername!=null && (typeof targetUsername!=='string'||targetUsername.length>40)) return res.status(400).json({error:'Некорректный username'});
  const targetId=targetUserId==null?null:Number(targetUserId);
  if(targetId!=null&&!Number.isSafeInteger(targetId)) return res.status(400).json({error:'Некорректный пользователь'});

  const dup=(db.prepare('SELECT COUNT(*) c FROM statements WHERE user_id=? AND lower(description)=lower(?)').get(req.userId,description.trim()) as any).c;
  const evaluation=evaluateStatement(description,category,location,dup);
  const score=evaluation.score, r=rarity(score), value=score*50;
  const reward=Math.max(25,Math.round(score*4));
  const ratingGain=Math.max(3,Math.round(score*0.65));

  const tx=db.transaction(()=>{
    const info=db.prepare('INSERT INTO statements(user_id,category,location,description,target_user_id,target_username,target_name,score,score_breakdown,rarity,value) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(req.userId,category,location,description.trim(),targetId,String(targetUsername||'').replace(/^@/,''),targetName.trim(),score,JSON.stringify(evaluation.breakdown),r,value);
    db.prepare('UPDATE users SET balance=balance+?, rating=rating+? WHERE id=?').run(reward,ratingGain,req.userId);
    db.prepare('INSERT INTO rating_history(user_id,amount,reason) VALUES(?,?,?)').run(req.userId,ratingGain,'statement');
    return Number(info.lastInsertRowid);
  });
  const id=tx();
  const row=db.prepare('SELECT id,category,location,description,target_user_id,target_username,target_name,score,score_breakdown,rarity,value,created_at,is_active FROM statements WHERE id=?').get(id);
  res.json({statement:serializeStatement(row),reward:{rating:ratingGain,balance:reward},phrase:phrases[crypto.randomInt(phrases.length)]});
});

app.post('/api/upgrades/preview',(req:Request,res)=>{const sourceId=Number(req.body?.sourceId),multiplier=Number(req.body?.multiplier);if(![1.5,2,3,5].includes(multiplier))return res.status(400).json({error:'Неверный множитель'});const s=db.prepare('SELECT id,category,location,description,score,rarity,value,created_at,is_active FROM statements WHERE id=? AND user_id=? AND is_active=1').get(sourceId,req.userId) as any;if(!s)return res.status(404).json({error:'Заява не найдена'});const targetValue=Math.round(s.value*multiplier/50)*50,chance=Math.max(5,Math.min(90,(s.value/targetValue)*95));res.json({source:serializeStatement(s),targetValue,chance});});
app.post('/api/upgrades',(req:Request,res)=>{const sourceId=Number(req.body?.sourceId),multiplier=Number(req.body?.multiplier);if(![1.5,2,3,5].includes(multiplier))return res.status(400).json({error:'Неверный множитель'});const s=db.prepare('SELECT * FROM statements WHERE id=? AND user_id=? AND is_active=1').get(sourceId,req.userId) as any;if(!s)return res.status(404).json({error:'Заява уже использована или не существует'});const targetValue=Math.round(s.value*multiplier/50)*50,chance=Math.max(5,Math.min(90,(s.value/targetValue)*95)),success=secureFloat()*100<chance;let newId:number|undefined;
  const tx=db.transaction(()=>{const changed=db.prepare('UPDATE statements SET is_active=0 WHERE id=? AND user_id=? AND is_active=1').run(sourceId,req.userId);if(changed.changes!==1)throw new Error('already-used');db.prepare('INSERT INTO upgrades(user_id,source_statement_id,target_value,chance,result) VALUES(?,?,?,?,?)').run(req.userId,sourceId,targetValue,chance,success?'win':'lose');if(success){const score=Math.min(100,Math.max(s.score+1,Math.round(targetValue/50)));const info=db.prepare('INSERT INTO statements(user_id,category,location,description,score,rarity,value) VALUES(?,?,?,?,?,?,?)').run(req.userId,`Пересмотр: ${s.category}`,s.location,'Заява повышена после игрового пересмотра.',score,rarity(score),targetValue);newId=Number(info.lastInsertRowid);}});
  try{tx();}catch{return res.status(409).json({error:'Эта заява уже использована'});} const finalAngle=success?Math.max(2,secureFloat()*Math.max(2,chance-4)):chance+2+secureFloat()*Math.max(2,96-chance);const statement=newId?serializeStatement(db.prepare('SELECT id,category,location,description,score,rarity,value,created_at,is_active FROM statements WHERE id=?').get(newId)):undefined;res.json({success,chance,targetValue,finalAngle,statement});
});

const wheelRewards=[
  {label:'25 ₽',type:'balance',value:25,weight:12,segmentIndex:0},
  {label:'50 ₽',type:'balance',value:50,weight:16,segmentIndex:1},
  {label:'75 ₽',type:'balance',value:75,weight:14,segmentIndex:2},
  {label:'100 ₽',type:'balance',value:100,weight:12,segmentIndex:3},
  {label:'125 ₽',type:'balance',value:125,weight:10,segmentIndex:4},
  {label:'150 ₽',type:'balance',value:150,weight:8,segmentIndex:5},
  {label:'10 RP',type:'rating',value:10,weight:10,segmentIndex:6},
  {label:'15 RP',type:'rating',value:15,weight:8,segmentIndex:7},
  {label:'20 RP',type:'rating',value:20,weight:6,segmentIndex:8},
  {label:'25 RP',type:'rating',value:25,weight:4,segmentIndex:9}
];
app.post('/api/wheel/spin',(req:Request,res)=>{
  const last=db.prepare('SELECT created_at FROM wheel_spins WHERE user_id=? AND paid=0 ORDER BY id DESC LIMIT 1').get(req.userId) as any;
  const nextFree=last?new Date(new Date(last.created_at+'Z').getTime()+12*3600e3):null;
  const free=!nextFree||nextFree.getTime()<=Date.now();
  if(!free) return res.status(429).json({error:'Бесплатная прокрутка доступна раз в 12 часов'});
  const reward={...pickWeighted(wheelRewards)};
  const tx=db.transaction(()=>{
    if(reward.type==='balance') db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(reward.value,req.userId);
    else if(reward.type==='rating'){
      db.prepare('UPDATE users SET rating=rating+? WHERE id=?').run(reward.value,req.userId);
      db.prepare('INSERT INTO rating_history(user_id,amount,reason) VALUES(?,?,?)').run(req.userId,reward.value,'wheel');
    }
    db.prepare('INSERT INTO wheel_spins(user_id,reward_type,reward_value,paid) VALUES(?,?,?,0)').run(req.userId,reward.type,reward.value);
  });
  tx();
  res.json({reward:{label:reward.label,type:reward.type,value:reward.value},segmentIndex:reward.segmentIndex,paid:false});
});

app.get('/api/leaderboard',(req:Request,res)=>{
  const period=String(req.query.period||'all');
  const where=periodWhere(period);
  const active="u.telegram_id>0 AND u.last_seen >= datetime('now','-30 days')";
  let rows:any[];
  let allScores:any[];
  let myRating:number;

  if(period==='all'){
    rows=db.prepare('SELECT u.id,u.username,u.first_name,u.rating FROM users u WHERE '+active+' AND u.rating>0 ORDER BY u.rating DESC,u.id ASC LIMIT 50').all() as any[];
    allScores=db.prepare('SELECT u.id,u.rating FROM users u WHERE '+active+' AND u.rating>0 ORDER BY u.rating DESC,u.id ASC').all() as any[];
    myRating=(db.prepare('SELECT rating FROM users WHERE id=?').get(req.userId) as any).rating;
  }else{
    rows=db.prepare('SELECT u.id,u.username,u.first_name,COALESCE(SUM(rh.amount),0) rating FROM users u JOIN rating_history rh ON rh.user_id=u.id WHERE '+active+' '+where+' GROUP BY u.id HAVING rating>0 ORDER BY rating DESC,u.id ASC LIMIT 50').all() as any[];
    allScores=db.prepare('SELECT u.id,COALESCE(SUM(rh.amount),0) rating FROM users u JOIN rating_history rh ON rh.user_id=u.id WHERE '+active+' '+where+' GROUP BY u.id HAVING rating>0 ORDER BY rating DESC,u.id ASC').all() as any[];
    myRating=(db.prepare('SELECT COALESCE(SUM(rh.amount),0) rating FROM rating_history rh WHERE rh.user_id=? '+where).get(req.userId) as any).rating;
  }
  const idx=allScores.findIndex(x=>x.id===req.userId);
  const myPlace=idx>=0?idx+1:0;
  res.json({rows:rows.map((r,i)=>({place:i+1,username:r.username,first_name:r.first_name,rating:r.rating,is_me:r.id===req.userId})),myPlace,myRating});
});

app.get('/api/admin/statements',requireAdmin,(req:Request,res)=>{
  const q=String(req.query.q||'').trim().slice(0,80);
  const like='%'+q+'%';
  const rows=db.prepare("SELECT s.id,s.category,s.location,s.description,s.target_user_id,s.target_username,s.target_name,s.score,s.score_breakdown,s.rarity,s.value,s.created_at,s.is_active,u.username author_username,u.first_name author_name,u.telegram_id author_telegram_id FROM statements s JOIN users u ON u.id=s.user_id WHERE (?='' OR u.username LIKE ? OR u.first_name LIKE ? OR s.target_username LIKE ? OR s.target_name LIKE ? OR s.category LIKE ?) ORDER BY s.id DESC LIMIT 250")
    .all(q,like,like,like,like,like) as any[];
  res.json({statements:rows.map(serializeStatement)});
});

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
