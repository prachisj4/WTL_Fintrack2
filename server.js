'use strict';
const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'fintrack.db');
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

// Migration checks for existing databases
(function migrateSchema() {
  const columns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!columns.includes('login_id')) {
    db.exec("ALTER TABLE users ADD COLUMN login_id TEXT UNIQUE COLLATE NOCASE");
  }
  if (!columns.includes('persona')) {
    db.exec("ALTER TABLE users ADD COLUMN persona TEXT NOT NULL DEFAULT 'student'");
  }
  if (!columns.includes('created_by_user_id')) {
    db.exec("ALTER TABLE users ADD COLUMN created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL");
  }
})();

app.disable('x-powered-by');
app.use(express.json({limit:'24kb'}));

// Basic same-origin check for cookie-authenticated write requests.
app.use((req,res,next)=>{
  if(['POST','PATCH','PUT','DELETE'].includes(req.method) && req.headers.origin){
    try {
      if(new URL(req.headers.origin).host!==req.headers.host) return res.status(403).json({error:'Cross-origin write blocked.'});
    } catch {
      return res.status(403).json({error:'Invalid origin.'});
    }
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const httpError = (status, message) => Object.assign(new Error(message), {status});
const safe = (fn) => (req,res,next) => { try { fn(req,res,next); } catch(e) { next(e); } };
const emailOK = e => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 160;
const loginIdOK = l => typeof l === 'string' && /^[a-zA-Z0-9_]{3,30}$/.test(l);
const validPersona = p => ['student', 'professional', 'senior', 'family'].includes(p) ? p : 'student';
const clean = (v,max=120) => typeof v === 'string' ? v.trim().slice(0,max) : '';
const amount = value => {
  const n = Number(value);
  if(!Number.isFinite(n) || n<=0 || n>100000000 || Math.round(n*100)!==n*100) throw httpError(400,'Enter a valid positive amount (up to two decimals).');
  return Math.round(n*100);
};
const nonnegativeAmount = value => {
  if(value===0 || value==='0' || value==='' || value==null) return 0;
  return amount(value);
};
const validDate = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;

function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')) {
  return salt+':'+crypto.scryptSync(password,salt,64).toString('hex');
}
function verifyPassword(password,stored) {
  try {
    const [salt,hash]=stored.split(':');
    return crypto.timingSafeEqual(Buffer.from(hash,'hex'), crypto.scryptSync(password,salt,64));
  } catch { return false; }
}
function cookie(req) {
  const m = (req.headers.cookie||'').match(/(?:^|;\s*)fintrack_session=([a-f0-9]{64})(?:;|$)/);
  return m && m[1];
}
function setSession(res,userId){
  const token=crypto.randomBytes(32).toString('hex');
  const digest=crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(digest,userId,Date.now()+7*86400000);
  res.setHeader('Set-Cookie',`fintrack_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${process.env.COOKIE_SECURE==='true'?'; Secure':''}`);
}
function currentUser(req){
  const token=cookie(req);
  if(!token)return null;
  return db.prepare('SELECT u.id,u.name,u.email,u.login_id,u.persona,u.created_by_user_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(crypto.createHash('sha256').update(token).digest('hex'),Date.now())||null;
}
function auth(req,res,next){
  req.user=currentUser(req);
  if(!req.user) return next(httpError(401,'Please log in.'));
  next();
}
function familyOf(userId, familyId) {
  return db.prepare('SELECT f.*,fm.role FROM families f JOIN family_members fm ON fm.family_id=f.id WHERE fm.user_id=? AND f.id=?').get(userId,familyId);
}
function validFamily(req, familyId){
  const f=familyOf(req.user.id,Number(familyId));
  if(!f) throw httpError(403,'You are not a member of this family.');
  return f;
}
function getGoal(req,goalId){
  const goal=db.prepare('SELECT * FROM goals WHERE id=?').get(goalId);
  if(!goal || (goal.user_id!==null && goal.user_id!==req.user.id) || (goal.family_id!==null && !familyOf(req.user.id,goal.family_id))) throw httpError(404,'Goal not found.');
  return goal;
}

// --- AUTH API ---
app.post('/api/register',safe((req,res)=>{
  const name=clean(req.body.name,60);
  const email=clean(req.body.email,160).toLowerCase();
  const pass=req.body.password;
  const persona=validPersona(req.body.persona);

  if(name.length<2 || !emailOK(email) || typeof pass!=='string' || pass.length<6 || pass.length>128) {
    throw httpError(400,'Name, valid email, and password of at least 6 characters required.');
  }
  if(db.prepare('SELECT id FROM users WHERE email=?').get(email)) {
    throw httpError(409,'An account with this email already exists.');
  }

  const result=db.prepare('INSERT INTO users(name,email,password_hash,persona) VALUES(?,?,?,?)').run(name,email,hashPassword(pass),persona);
  setSession(res,result.lastInsertRowid);
  res.status(201).json({user:{id:result.lastInsertRowid,name,email,login_id:null,persona}});
}));

app.post('/api/login',safe((req,res)=>{
  const input=clean(req.body.email_or_login || req.body.email,160).toLowerCase();
  const pass=req.body.password;
  if(!input || typeof pass!=='string') throw httpError(400,'Email/Login ID and password are required.');

  const row=db.prepare('SELECT * FROM users WHERE (email IS NOT NULL AND LOWER(email)=?) OR (login_id IS NOT NULL AND LOWER(login_id)=?)').get(input,input);
  if(!row || !verifyPassword(pass,row.password_hash)) throw httpError(401,'Incorrect email/login ID or password.');

  setSession(res,row.id);
  res.json({user:{id:row.id,name:row.name,email:row.email,login_id:row.login_id,persona:row.persona}});
}));

app.post('/api/logout',safe((req,res)=>{
  const token=cookie(req);
  if(token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(crypto.createHash('sha256').update(token).digest('hex'));
  res.setHeader('Set-Cookie','fintrack_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ok:true});
}));

app.get('/api/me',auth,(req,res)=>res.json({user:req.user}));

// --- FAMILY API ---
app.get('/api/families',auth,safe((req,res)=>{
  res.json({families:db.prepare('SELECT f.id,f.name,f.invite_code,f.monthly_budget,f.created_by,fm.role FROM families f JOIN family_members fm ON f.id=fm.family_id WHERE fm.user_id=? ORDER BY f.id DESC').all(req.user.id)});
}));

app.post('/api/families',auth,safe((req,res)=>{
  const name=clean(req.body.name,80);
  if(name.length<2)throw httpError(400,'Family name must have at least 2 characters.');
  const budget=nonnegativeAmount(req.body.monthly_budget);
  const create=db.transaction(()=>{
    let invite,exists;
    do {
      invite=crypto.randomBytes(5).toString('hex').toUpperCase();
      exists=db.prepare('SELECT id FROM families WHERE invite_code=?').get(invite);
    } while(exists);
    const id=db.prepare('INSERT INTO families(name,invite_code,monthly_budget,created_by) VALUES(?,?,?,?)').run(name,invite,budget,req.user.id).lastInsertRowid;
    db.prepare("INSERT INTO family_members(family_id,user_id,role) VALUES(?,?,'owner')").run(id,req.user.id);
    
    // Also save family budget into budgets table
    db.prepare("INSERT INTO budgets(family_id,category,monthly_limit) VALUES(?,NULL,?)").run(id,budget);
    return id;
  });
  res.status(201).json({id:create()});
}));

app.post('/api/families/join',auth,safe((req,res)=>{
  const code=clean(req.body.code,32).toUpperCase();
  const f=db.prepare('SELECT * FROM families WHERE invite_code=?').get(code);
  if(!f)throw httpError(404,'Invite code not found.');
  db.prepare("INSERT OR IGNORE INTO family_members(family_id,user_id,role) VALUES(?,?,'member')").run(f.id,req.user.id);
  res.json({id:f.id,name:f.name});
}));

app.patch('/api/families/:id/budget',auth,safe((req,res)=>{
  const f=validFamily(req,req.params.id);
  if(f.role!=='owner')throw httpError(403,'Only the family owner can edit its budget.');
  const b=nonnegativeAmount(req.body.monthly_budget);
  db.prepare('UPDATE families SET monthly_budget=? WHERE id=?').run(b,f.id);
  
  // Update in budgets table as well
  const existing = db.prepare('SELECT id FROM budgets WHERE family_id=? AND category IS NULL').get(f.id);
  if(existing) {
    db.prepare('UPDATE budgets SET monthly_limit=? WHERE id=?').run(b, existing.id);
  } else {
    db.prepare('INSERT INTO budgets(family_id,category,monthly_limit) VALUES(?,NULL,?)').run(f.id, b);
  }
  res.json({ok:true});
}));

app.get('/api/families/:id/members',auth,safe((req,res)=>{
  const f=validFamily(req,req.params.id);
  res.json({
    members: db.prepare('SELECT u.id, u.name, u.email, u.login_id, u.persona, fm.role, fm.joined_at FROM family_members fm JOIN users u ON u.id=fm.user_id WHERE fm.family_id=? ORDER BY fm.joined_at').all(f.id)
  });
}));

// Owner creates a family member login account directly
app.post('/api/families/:id/members',auth,safe((req,res)=>{
  const f=validFamily(req,req.params.id);
  if(f.role!=='owner') throw httpError(403,'Only the family owner can add new family member accounts.');

  const name=clean(req.body.name,60);
  const login_id=clean(req.body.login_id,30).toLowerCase();
  const pass=req.body.password;
  const persona=validPersona(req.body.persona);

  if(name.length<2) throw httpError(400,'Member name must be at least 2 characters.');
  if(!loginIdOK(login_id)) throw httpError(400,'Login ID must be 3–30 alphanumeric characters or underscores.');
  if(typeof pass!=='string' || pass.length<6) throw httpError(400,'Password must be at least 6 characters.');

  // Check login_id uniqueness across users
  if(db.prepare('SELECT id FROM users WHERE LOWER(login_id)=?').get(login_id)) {
    throw httpError(409,'Login ID already taken. Please choose another.');
  }

  const newMemberTx = db.transaction(()=>{
    const userId = db.prepare('INSERT INTO users(name,email,login_id,password_hash,persona,created_by_user_id) VALUES(?,NULL,?,?,?,?)')
      .run(name, login_id, hashPassword(pass), persona, req.user.id).lastInsertRowid;
    db.prepare("INSERT INTO family_members(family_id,user_id,role) VALUES(?,?,'member')").run(f.id, userId);
    return userId;
  });

  const memberId = newMemberTx();
  res.status(201).json({
    member: { id: memberId, name, login_id, persona, role: 'member' }
  });
}));

app.delete('/api/families/:id/members/:memberId',auth,safe((req,res)=>{
  const f=validFamily(req,req.params.id);
  if(f.role!=='owner') throw httpError(403,'Only the family owner can remove members.');
  const memberId = Number(req.params.memberId);
  if(memberId === req.user.id) throw httpError(400,'Family owner cannot remove themselves from family.');
  
  db.prepare('DELETE FROM family_members WHERE family_id=? AND user_id=?').run(f.id, memberId);
  res.json({ok:true});
}));

// --- BUDGETS API ---
app.get('/api/budgets',auth,safe((req,res)=>{
  const familyId=req.query.family_id ? Number(req.query.family_id) : null;
  let rows;
  if(familyId) {
    validFamily(req, familyId);
    rows = db.prepare('SELECT * FROM budgets WHERE family_id=?').all(familyId);
  } else {
    rows = db.prepare('SELECT * FROM budgets WHERE user_id=? AND family_id IS NULL').all(req.user.id);
  }
  res.json({budgets: rows});
}));

app.post('/api/budgets',auth,safe((req,res)=>{
  const familyId=req.body.family_id ? Number(req.body.family_id) : null;
  const category=clean(req.body.category,40) || null;
  const limit=nonnegativeAmount(req.body.monthly_limit);

  if(familyId) {
    const f=validFamily(req, familyId);
    if(f.role!=='owner') throw httpError(403,'Only family owner can set family budgets.');
    const existing = db.prepare('SELECT id FROM budgets WHERE family_id=? AND (category IS ? OR category=?)').get(familyId, category, category);
    if(existing) {
      db.prepare('UPDATE budgets SET monthly_limit=? WHERE id=?').run(limit, existing.id);
    } else {
      db.prepare('INSERT INTO budgets(family_id,category,monthly_limit) VALUES(?,?,?)').run(familyId, category, limit);
    }
  } else {
    const existing = db.prepare('SELECT id FROM budgets WHERE user_id=? AND family_id IS NULL AND (category IS ? OR category=?)').get(req.user.id, category, category);
    if(existing) {
      db.prepare('UPDATE budgets SET monthly_limit=? WHERE id=?').run(limit, existing.id);
    } else {
      db.prepare('INSERT INTO budgets(user_id,family_id,category,monthly_limit) VALUES(?,NULL,?,?)').run(req.user.id, category, limit);
    }
  }
  res.json({ok:true});
}));

// --- TRANSACTIONS API ---
app.get('/api/transactions',auth,safe((req,res)=>{
  const scope=req.query.scope==='family'?'family':'personal';
  let rows;
  if(scope==='family') {
    const f=validFamily(req,req.query.family_id);
    rows=db.prepare('SELECT t.id,t.type,t.category,t.amount,t.note,t.occurred_on,t.goal_id,u.name as added_by FROM transactions t JOIN users u ON t.user_id=u.id WHERE t.family_id=? ORDER BY t.occurred_on DESC,t.id DESC LIMIT 250').all(f.id);
  } else {
    rows=db.prepare('SELECT id,type,category,amount,note,occurred_on,goal_id FROM transactions WHERE user_id=? AND family_id IS NULL ORDER BY occurred_on DESC,id DESC LIMIT 250').all(req.user.id);
  }
  res.json({transactions:rows});
}));

app.post('/api/transactions',auth,safe((req,res)=>{
  const type=clean(req.body.type,20);
  const category=clean(req.body.category,40);
  const note=clean(req.body.note,240);
  if(!['income','expense','savings'].includes(type)) throw httpError(400,'Select income, expense, or savings.');
  if(!category) throw httpError(400,'Category is required.');
  const paise=amount(req.body.amount);
  const date=req.body.occurred_on;
  if(!validDate(date)) throw httpError(400,'Enter a real date in YYYY-MM-DD format.');

  const familyId=req.body.family_id ? Number(req.body.family_id) : null;
  if(familyId) validFamily(req,familyId);

  const goalId=req.body.goal_id ? Number(req.body.goal_id) : null;
  if(goalId){
    const goal=getGoal(req,goalId);
    if(type!=='savings' || goal.family_id!==familyId || (goal.user_id!==null && goal.user_id!==req.user.id)) throw httpError(400,'Goal and transaction scope must match.');
  }

  const id=db.prepare('INSERT INTO transactions(user_id,family_id,goal_id,type,category,amount,note,occurred_on) VALUES(?,?,?,?,?,?,?,?)')
    .run(req.user.id,familyId,goalId,type,category,paise,note,date).lastInsertRowid;
  res.status(201).json({id});
}));

app.delete('/api/transactions/:id',auth,safe((req,res)=>{
  const row=db.prepare('SELECT * FROM transactions WHERE id=?').get(req.params.id);
  if(!row || row.user_id!==req.user.id) throw httpError(404,'Transaction not found or not created by you.');
  db.prepare('DELETE FROM transactions WHERE id=?').run(row.id);
  res.json({ok:true});
}));

// --- GOALS API ---
app.get('/api/goals',auth,safe((req,res)=>{
  const familyId=req.query.family_id?Number(req.query.family_id):null;
  let goals;
  if(familyId){
    validFamily(req,familyId);
    goals=db.prepare('SELECT g.id,g.title,g.target_amount,COALESCE(SUM(t.amount),0) AS saved_amount FROM goals g LEFT JOIN transactions t ON t.goal_id=g.id AND t.type=\'savings\' WHERE g.family_id=? GROUP BY g.id ORDER BY g.id DESC').all(familyId);
  } else {
    goals=db.prepare('SELECT g.id,g.title,g.target_amount,COALESCE(SUM(t.amount),0) AS saved_amount FROM goals g LEFT JOIN transactions t ON t.goal_id=g.id AND t.type=\'savings\' WHERE g.user_id=? GROUP BY g.id ORDER BY g.id DESC').all(req.user.id);
  }
  res.json({goals});
}));

app.post('/api/goals',auth,safe((req,res)=>{
  const title=clean(req.body.title,90);
  if(title.length<2) throw httpError(400,'Enter a goal title.');
  const target=amount(req.body.target_amount);
  const fId=req.body.family_id?Number(req.body.family_id):null;
  if(fId) validFamily(req,fId);
  const id=db.prepare('INSERT INTO goals(user_id,family_id,title,target_amount) VALUES(?,?,?,?)').run(fId?null:req.user.id,fId,title,target).lastInsertRowid;
  res.status(201).json({id});
}));

app.delete('/api/goals/:id',auth,safe((req,res)=>{
  const g=getGoal(req,req.params.id);
  if(g.family_id){
    const f=validFamily(req,g.family_id);
    if(f.role!=='owner') throw httpError(403,'Only the family owner can delete shared goals.');
  }
  db.prepare('DELETE FROM goals WHERE id=?').run(g.id);
  res.json({ok:true});
}));

// --- DASHBOARD DATA API ---
app.get('/api/dashboard',auth,safe((req,res)=>{
  const familyId=req.query.family_id ? Number(req.query.family_id) : null;
  if(familyId) validFamily(req,familyId);

  const clause = familyId ? 'family_id=?' : 'user_id=? AND family_id IS NULL';
  const key = familyId || req.user.id;
  const currentMonthStr = new Date().toISOString().slice(0,7);

  // Totals
  const totals = db.prepare(`SELECT type, COALESCE(SUM(amount),0) AS amount FROM transactions WHERE ${clause} GROUP BY type`).all(key);
  
  // Category breakdown for current month expenses
  const categories = db.prepare(`SELECT category, SUM(amount) AS amount FROM transactions WHERE ${clause} AND type='expense' AND occurred_on LIKE ? GROUP BY category ORDER BY amount DESC`).all(key, `${currentMonthStr}%`);
  
  // Monthly Income vs Expense graph data (grouped by YYYY-MM)
  const monthlyTrend = db.prepare(`SELECT substr(occurred_on, 1, 7) AS month, type, SUM(amount) AS amount FROM transactions WHERE ${clause} AND type IN ('income','expense') GROUP BY month, type ORDER BY month ASC`).all(key);

  // This month's overall expense sum
  const thisMonthExpenseRow = db.prepare(`SELECT COALESCE(SUM(amount),0) AS amount FROM transactions WHERE ${clause} AND type='expense' AND occurred_on LIKE ?`).get(key, `${currentMonthStr}%`);
  const thisMonthExpense = thisMonthExpenseRow ? thisMonthExpenseRow.amount : 0;

  // Budgets
  const budgets = familyId ? db.prepare('SELECT * FROM budgets WHERE family_id=?').all(familyId) : db.prepare('SELECT * FROM budgets WHERE user_id=? AND family_id IS NULL').all(req.user.id);

  res.json({
    totals: Object.fromEntries(totals.map(r=>[r.type,r.amount])),
    categories,
    monthlyTrend,
    thisMonthExpense,
    budgets,
    month: currentMonthStr
  });
}));

// --- ONLINE DATABASE INSPECTION API ---
app.get('/api/db-view', auth, safe((req, res) => {
  db.pragma('wal_checkpoint(FULL)');
  const tables = ['users', 'families', 'family_members', 'budgets', 'transactions', 'goals'];
  const dbData = {};
  for (const t of tables) {
    if (t === 'users') {
      dbData[t] = db.prepare('SELECT id, name, email, login_id, persona, created_by_user_id, created_at FROM users').all();
    } else {
      dbData[t] = db.prepare(`SELECT * FROM ${t}`).all();
    }
  }
  res.json({ ok: true, database: dbData });
}));

app.use((err,req,res,next)=>{
  if(res.headersSent) return next(err);
  if(!err.status) console.error(err);
  res.status(err.status||500).json({error:err.status?err.message:'Unexpected server error.'});
});

app.listen(PORT,()=>console.log(`FinTrack running: http://localhost:${PORT}`));

