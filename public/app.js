'use strict';
const $=s=>document.querySelector(s);
const state={
  user:null,
  families:[],
  familyId:null,
  authMode:'login',
  page:'dashboard',
  txScope:'personal',
  goals:[],
  transactions:[],
  budgets:[]
};

let expenseChartInstance = null;
let incomeExpenseChartInstance = null;
let familyCategoryChartInstance = null;

const PERSONA_NAMES = {
  student: 'Student',
  professional: 'Working Professional',
  senior: 'Senior Citizen',
  family: 'Family'
};

const EXPENSE_CATEGORIES = {
  student: ['Food', 'Transport', 'Education', 'Shopping', 'Entertainment', 'Mobile/Internet', 'Rent/Hostel', 'Health', 'Other'],
  professional: ['Food', 'Transport', 'Rent/Home', 'Bills', 'Shopping', 'Entertainment', 'EMI', 'Insurance', 'Investment', 'Health', 'Travel', 'Other'],
  senior: ['Groceries', 'Medicines', 'Healthcare', 'Bills', 'Transport', 'Household', 'Insurance', 'Entertainment', 'Family', 'Other'],
  family: ['Groceries', 'Rent/Home', 'Bills', 'Education', 'Healthcare', 'Transport', 'Shopping', 'Entertainment', 'EMI', 'Insurance', 'Travel', 'Other']
};

const INCOME_CATEGORIES = ['Salary', 'Allowance', 'Pension', 'Freelance', 'Business', 'Investment', 'Gift', 'Other Income'];

const fmt=p=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format((p||0)/100);
const rupees=p=>(p/100).toFixed(2);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const todayLocal=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const currentMonth=()=>todayLocal().slice(0,7);

async function api(url,opts={}){
  const res=await fetch('/api'+url,{...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});
  const data=await res.json();
  if(!res.ok) throw new Error(data.error||'Something went wrong.');
  return data;
}

function toast(msg){
  const t=$('#toast');
  t.textContent=msg;
  t.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer=setTimeout(()=>t.classList.remove('show'),4000);
}

async function run(task){
  try{ await task(); } catch(e){ toast(e.message); console.error(e); }
}

function setAuthMode(mode){
  state.authMode=mode;
  $('#loginTab').classList.toggle('active',mode==='login');
  $('#registerTab').classList.toggle('active',mode==='register');
  
  $('#nameGroup').classList.toggle('hidden',mode==='login');
  $('#personaGroup').classList.toggle('hidden',mode==='login');
  $('#confirmPasswordGroup').classList.toggle('hidden',mode==='login');
  
  $('#authName').required=mode==='register';
  $('#authPersona').required=mode==='register';
  $('#authConfirmPassword').required=mode==='register';

  $('#authTitle').textContent=mode==='login'?'Welcome back':'Create your account';
  $('#authSub').textContent=mode==='login'?'Sign in with your Email address or Login ID to access your dashboard.':'Start managing your money with persona-customized tracking.';
  $('#loginInputTitle').textContent=mode==='login'?'Email address or Login ID':'Email address';
  $('#authEmail').placeholder=mode==='login'?'you@example.com or username':'you@example.com';
  $('#authSubmit').textContent=mode==='login'?'Log in →':'Create account →';
  $('#authPassword').autocomplete=mode==='login'?'current-password':'new-password';
}

$('#loginTab').onclick=()=>setAuthMode('login');
$('#registerTab').onclick=()=>setAuthMode('register');

$('#authForm').onsubmit=e=>{
  e.preventDefault();
  run(async()=>{
    if(state.authMode==='register') {
      const p1=$('#authPassword').value;
      const p2=$('#authConfirmPassword').value;
      if(p1!==p2) throw new Error('Passwords do not match.');
      
      const b={
        name:$('#authName').value,
        email:$('#authEmail').value,
        password:p1,
        persona:$('#authPersona').value
      };
      const r=await api('/register',{method:'POST',body:JSON.stringify(b)});
      await boot(r.user);
      toast('Account created! Welcome to FinTrack.');
    } else {
      const b={
        email_or_login:$('#authEmail').value,
        password:$('#authPassword').value
      };
      const r=await api('/login',{method:'POST',body:JSON.stringify(b)});
      await boot(r.user);
      toast('Welcome back to FinTrack!');
    }
  });
};

$('#logoutBtn').onclick=()=>run(async()=>{
  await api('/logout',{method:'POST'});
  state.user=null;
  $('#app').classList.add('hidden');
  $('#auth').classList.remove('hidden');
  $('#authPassword').value='';
  if($('#authConfirmPassword')) $('#authConfirmPassword').value='';
});

async function boot(user){
  state.user=user;
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  
  $('#userName').textContent=user.name;
  $('#userEmail').textContent=user.email || user.login_id || 'Family member';
  $('#avatar').textContent=user.name.charAt(0).toUpperCase();
  $('#greetingName').textContent=user.name.split(' ')[0];
  
  const personaText = PERSONA_NAMES[user.persona] || 'Student';
  $('#personaBadge').textContent=`● ${personaText} Persona`;
  $('#topPersonaTag').textContent=`Persona: ${personaText}`;
  $('#sidePersonaBadge').textContent=personaText;
  $('#today').textContent=new Date().toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'});
  
  await loadFamilies();
  await go('dashboard');
}

function optionsOfFamilies(){
  return state.families.map(f=>`<option value="${f.id}">${esc(f.name)}</option>`).join('');
}

async function loadFamilies(){
  const {families}=await api('/families');
  state.families=families;
  if(!families.some(f=>f.id===state.familyId)) state.familyId=families[0]?.id||null;
  
  $('#familySelect').innerHTML=optionsOfFamilies();
  if(state.familyId) $('#familySelect').value=state.familyId;
  
  const choices='<option value="personal">Personal transactions</option>'+families.map(f=>`<option value="${f.id}">${esc(f.name)}</option>`).join('');
  $('#txScope').innerHTML=choices;
  $('#txScope').value=state.txScope==='personal'?'personal':String(state.txScope);
  if($('#txScope').selectedIndex<0){ state.txScope='personal'; $('#txScope').value='personal'; }
  
  $('#goalScope').innerHTML='<option value="personal">My goals</option>'+families.map(f=>`<option value="${f.id}">${esc(f.name)} shared goals</option>`).join('');
}

async function go(page){
  state.page=page;
  document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  document.querySelectorAll('.content').forEach(el=>el.classList.toggle('hidden',el.id!==`page-${page}`));
  
  $('#crumb').textContent={dashboard:'Overview',transactions:'Transactions',savings:'Savings goals',family:'Family circle'}[page];
  
  if(page==='dashboard') await loadDashboard();
  if(page==='transactions') await loadTransactions();
  if(page==='savings') await loadGoals();
  if(page==='family') await loadFamily();
  
  window.scrollTo(0,0);
}

document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>run(()=>go(b.dataset.page)));
document.querySelectorAll('[data-jump]').forEach(b=>b.onclick=()=>run(()=>go(b.dataset.jump)));

const symbols={income:'↗',expense:'↘',savings:'◎'};
function txRow(t,deleteButton=false){
  const sign=t.type==='income'?'+':'−';
  return `<div class="recent-row">
    <span class="tx-icon ${t.type}">${symbols[t.type]}</span>
    <div class="recent-details">
      <strong>${esc(t.category)}${t.note?' · '+esc(t.note):''}</strong>
      <small>${esc(t.occurred_on)}${t.added_by?' · '+esc(t.added_by):''}</small>
    </div>
    <span class="recent-amount ${t.type}">${sign}${fmt(t.amount)}</span>
    ${deleteButton?`<button class="delete-btn" data-delete-tx="${t.id}" title="Delete transaction">✕</button>`:''}
  </div>`;
}

// --- DASHBOARD LOAD & GRAPHS & ALERTS ---
async function loadDashboard(){
  const [d,t]=await Promise.all([api('/dashboard'),api('/transactions')]);
  const totals=d.totals;
  
  const inc = totals.income || 0;
  const exp = totals.expense || 0;
  const bal = inc - exp;
  const thisMonthExp = d.thisMonthExpense || 0;
  
  $('#metricIncome').textContent=fmt(inc);
  $('#metricExpense').textContent=fmt(exp);
  $('#metricBalance').textContent=fmt(bal);
  $('#metricThisMonth').textContent=fmt(thisMonthExp);
  
  $('#chartMonth').textContent=new Date().toLocaleString('en-IN',{month:'long',year:'numeric'});
  
  // Render Spending Alerts
  renderSpendingAlerts(thisMonthExp, d.categories, d.budgets);
  
  // Render Category Doughnut Chart (Chart.js)
  renderCategoryChart(d.categories);
  
  // Render Monthly Income vs Expense Chart (Chart.js)
  renderMonthlyIncomeExpenseChart(d.monthlyTrend);
  
  // Render Recent Transactions
  $('#recentTransactions').innerHTML=t.transactions.length?t.transactions.slice(0,6).map(x=>txRow(x)).join(''):'<p class="empty">No transactions recorded yet. Add your first entry!</p>';
}

function renderSpendingAlerts(thisMonthExpense, categories, budgets){
  const container = $('#alertsContainer');
  const alerts = [];
  
  // Overall Monthly Budget check
  const overallBudgetObj = budgets.find(b => b.category === null);
  const overallLimit = overallBudgetObj ? overallBudgetObj.monthly_limit : 0;
  
  if (overallLimit > 0) {
    const pct = Math.round((thisMonthExpense / overallLimit) * 100);
    if (thisMonthExpense > overallLimit) {
      alerts.push({
        severity: 'danger',
        icon: '🚨',
        msg: `Budget exceeded! You have spent ${fmt(thisMonthExpense)} against your ${fmt(overallLimit)} overall monthly budget.`
      });
    } else if (pct >= 90) {
      alerts.push({
        severity: 'danger',
        icon: '⚠️',
        msg: `Careful! You have almost reached your monthly budget (${pct}% used: ${fmt(thisMonthExpense)} of ${fmt(overallLimit)}).`
      });
    } else if (pct >= 75) {
      alerts.push({
        severity: 'warning',
        icon: '⚡',
        msg: `Warning: You have used ${pct}% of your overall monthly budget (${fmt(thisMonthExpense)} of ${fmt(overallLimit)}).`
      });
    } else {
      alerts.push({
        severity: 'safe',
        icon: '✅',
        msg: `Safe: You have spent ${fmt(thisMonthExpense)} of your ${fmt(overallLimit)} monthly budget (${pct}% used).`
      });
    }
  }

  // Category specific budgets check
  const catMap = Object.fromEntries(categories.map(c => [c.category, c.amount]));
  budgets.filter(b => b.category !== null && b.monthly_limit > 0).forEach(b => {
    const spent = catMap[b.category] || 0;
    const pct = Math.round((spent / b.monthly_limit) * 100);
    
    if (spent > b.monthly_limit) {
      alerts.push({
        severity: 'danger',
        icon: '🚨',
        msg: `Budget exceeded! You have spent ${fmt(spent)} against your ${fmt(b.monthly_limit)} ${b.category} budget.`
      });
    } else if (pct >= 90) {
      alerts.push({
        severity: 'danger',
        icon: '⚠️',
        msg: `Careful! You have almost reached your ${b.category} budget (${pct}% used).`
      });
    } else if (pct >= 75) {
      alerts.push({
        severity: 'warning',
        icon: '⚡',
        msg: `Warning: You have used ${pct}% of your ${b.category} budget.`
      });
    }
  });

  if (alerts.length === 0) {
    if (overallLimit === 0) {
      container.innerHTML = `<div class="alert-card safe"><span class="alert-icon">ℹ️</span><span>No budgets configured. Click <strong>⚙ Manage Budgets</strong> to set a monthly limit and receive alerts.</span></div>`;
    } else {
      container.innerHTML = `<div class="alert-card safe"><span class="alert-icon">✅</span><span>Spending is well within budget limits. Keep it up!</span></div>`;
    }
    return;
  }

  container.innerHTML = alerts.map(a => `<div class="alert-card ${a.severity}"><span class="alert-icon">${a.icon}</span><span>${esc(a.msg)}</span></div>`).join('');
}

function renderCategoryChart(categories) {
  const canvas = $('#expenseCategoryChartCanvas');
  const fallback = $('#categoryChartList');
  
  if (!categories || categories.length === 0) {
    if (expenseChartInstance) { expenseChartInstance.destroy(); expenseChartInstance = null; }
    canvas.style.display = 'none';
    fallback.innerHTML = `<p class="empty">No expenses recorded for this month yet. Add an expense to see your category graph!</p>`;
    return;
  }
  
  canvas.style.display = 'block';
  fallback.innerHTML = '';

  const labels = categories.map(c => c.category);
  const data = categories.map(c => c.amount / 100); // in Rupees for display
  const colors = ['#6366f1', '#14a57f', '#f59e0b', '#ed776a', '#8b5cf6', '#06b6d4', '#ec4899', '#10b981', '#64748b'];

  if (expenseChartInstance) expenseChartInstance.destroy();

  expenseChartInstance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: colors.slice(0, labels.length),
        borderWidth: 2,
        borderColor: '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              return ` ${ctx.label}: ₹${ctx.raw.toLocaleString('en-IN')}`;
            }
          }
        }
      }
    }
  });
}

function renderMonthlyIncomeExpenseChart(monthlyTrend) {
  const canvas = $('#incomeVsExpenseChartCanvas');
  if (!canvas) return;

  if (!monthlyTrend || monthlyTrend.length === 0) {
    if (incomeExpenseChartInstance) { incomeExpenseChartInstance.destroy(); incomeExpenseChartInstance = null; }
    canvas.style.display = 'none';
    return;
  }

  canvas.style.display = 'block';

  // Process trend data into months
  const months = [...new Set(monthlyTrend.map(r => r.month))].sort();
  const incomeData = months.map(m => {
    const row = monthlyTrend.find(r => r.month === m && r.type === 'income');
    return row ? (row.amount / 100) : 0;
  });
  const expenseData = months.map(m => {
    const row = monthlyTrend.find(r => r.month === m && r.type === 'expense');
    return row ? (row.amount / 100) : 0;
  });

  const monthLabels = months.map(m => {
    const [y, mo] = m.split('-');
    const d = new Date(Number(y), Number(mo) - 1, 1);
    return d.toLocaleString('en-IN', { month: 'short', year: '2-digit' });
  });

  if (incomeExpenseChartInstance) incomeExpenseChartInstance.destroy();

  incomeExpenseChartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: monthLabels,
      datasets: [
        {
          label: 'Income (₹)',
          data: incomeData,
          backgroundColor: '#14a57f',
          borderRadius: 6
        },
        {
          label: 'Expenses (₹)',
          data: expenseData,
          backgroundColor: '#ed776a',
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              return ` ${ctx.dataset.label}: ₹${ctx.raw.toLocaleString('en-IN')}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(val) { return '₹' + val.toLocaleString('en-IN'); }
          }
        }
      }
    }
  });
}

// --- TRANSACTIONS PAGE & ACTIONS ---
$('#txScope').onchange=e=>{ state.txScope=e.target.value; run(loadTransactions); };
$('#txFilter').onchange=renderTransactions;

async function loadTransactions(){
  const family=state.txScope!=='personal';
  const q=family?`?scope=family&family_id=${state.txScope}`:'';
  state.transactions=(await api('/transactions'+q)).transactions;
  renderTransactions();
}

function renderTransactions(){
  const f=$('#txFilter').value;
  const list=state.transactions.filter(x=>f==='all'||x.type===f);
  $('#txEmpty').classList.toggle('hidden',list.length>0);
  $('#txBody').innerHTML=list.map(t=>`<tr>
    <td>${esc(t.category)}<small>${esc(t.note||t.added_by||'No description')}</small></td>
    <td>${esc(t.occurred_on)}</td>
    <td><span class="type-tag ${t.type}">${esc(t.type)}</span></td>
    <td><strong class="recent-amount ${t.type}">${t.type==='income'?'+':'−'}${fmt(t.amount)}</strong></td>
    <td>${state.txScope==='personal'||!t.added_by||t.added_by===state.user.name?`<button class="delete-btn" data-delete-tx="${t.id}">Delete</button>`:''}</td>
  </tr>`).join('');
}

// --- SAVINGS GOALS PAGE ---
async function loadGoals(){
  const value=$('#goalScope').value;
  const family=value!=='personal';
  state.goals=(await api('/goals'+(family?`?family_id=${value}`:''))).goals;
  renderGoals();
}

function goalCards(list){
  return list.length?list.map(g=>{
    const pct=Math.min(100,Math.floor(g.saved_amount/g.target_amount*100));
    return `<div class="goal-card">
      <div class="goal-top"><span class="goal-symbol">◎</span><button class="delete-btn" data-delete-goal="${g.id}">Delete</button></div>
      <h3>${esc(g.title)}</h3>
      <p class="muted">Tracked saving allocation.</p>
      <div class="goal-numbers"><strong>${fmt(g.saved_amount)}</strong><span>of ${fmt(g.target_amount)}</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="goal-foot"><span>${pct}% complete</span><button class="text-btn" data-contribute="${g.id}">＋ Contribute</button></div>
    </div>`;
  }).join(''):'<p class="empty">No goals yet. Create a target worth saving for.</p>';
}

function renderGoals(){ $('#goalGrid').innerHTML=goalCards(state.goals); }
$('#goalScope').onchange=()=>run(loadGoals);

// --- FAMILY CIRCLE PAGE ---
$('#createFamilyForm').onsubmit=e=>{
  e.preventDefault();
  run(async()=>{
    const x=await api('/families',{method:'POST',body:JSON.stringify({name:$('#familyName').value,monthly_budget:$('#familyBudget').value})});
    state.familyId=x.id;
    await loadFamilies();
    await loadFamily();
    toast('Family circle created successfully!');
  });
};

$('#joinFamilyForm').onsubmit=e=>{
  e.preventDefault();
  run(async()=>{
    const x=await api('/families/join',{method:'POST',body:JSON.stringify({code:$('#joinCode').value})});
    state.familyId=x.id;
    await loadFamilies();
    await loadFamily();
    toast('Joined '+x.name);
  });
};

$('#familySelect').onchange=e=>{ state.familyId=Number(e.target.value); run(loadFamily); };
$('#toggleFamilySetup').onclick=()=>$('#familySetup').classList.toggle('hidden');

$('#editFamilyBudget').onsubmit=e=>{
  e.preventDefault();
  run(async()=>{
    await api(`/families/${state.familyId}/budget`,{method:'PATCH',body:JSON.stringify({monthly_budget:$('#newFamilyBudget').value})});
    await loadFamilies();
    await loadFamily();
    toast('Family budget updated.');
  });
};

async function loadFamily(){
  const f=state.families.find(x=>x.id===state.familyId);
  $('#familyDetails').classList.toggle('hidden',!f);
  $('#familySetup').classList.toggle('hidden',!!f);
  if(!f) return;

  $('#familySelect').value=f.id;
  
  const [dash,tx,member]=await Promise.all([
    api(`/dashboard?family_id=${f.id}`),
    api(`/transactions?scope=family&family_id=${f.id}`),
    api(`/families/${f.id}/members`)
  ]);

  const monthlySpent=tx.transactions.filter(t=>t.type==='expense'&&t.occurred_on.startsWith(currentMonth())).reduce((s,t)=>s+t.amount,0);
  const remaining = Math.max(0, f.monthly_budget - monthlySpent);
  const pct=f.monthly_budget?monthlySpent/f.monthly_budget*100:0;

  $('#famBudgetValue').textContent=fmt(f.monthly_budget);
  $('#famSpend').textContent=fmt(monthlySpent);
  $('#famRemaining').textContent=fmt(remaining);
  $('#famMemberCountNum').textContent=member.members.length;

  $('#famBudgetPct').textContent=f.monthly_budget?Math.round(pct)+'%':'Not set';
  $('#familyProgress').style.width=Math.min(100,pct)+'%';
  $('#familyProgress').style.background=pct>100?'#ed776a':'#686be9';
  $('#famBudgetHelp').textContent=f.monthly_budget?`${fmt(remaining)} remaining this month${pct>100?' (budget exceeded)':''}`:'Set a monthly budget to see your progress.';

  $('#editFamilyBudget').classList.toggle('hidden',f.role!=='owner');
  $('#memberCount').textContent=member.members.length+' member'+(member.members.length!==1?'s':'');

  // ONLY FAMILY OWNER CAN ADD MEMBERS
  const isOwner = f.role === 'owner';
  $('#openAddMemberBtn').classList.toggle('hidden', !isOwner);

  // Render Family Members
  $('#memberList').innerHTML=member.members.map(m=>`<div class="member">
    <span class="member-avatar">${esc(m.name[0].toUpperCase())}</span>
    <div style="flex:1">
      <strong>${esc(m.name)}</strong>
      ${m.login_id?`<small class="member-sub">Login ID: ${esc(m.login_id)}</small>`:''}
      <small class="member-sub">Persona: ${PERSONA_NAMES[m.persona]||'Student'}</small>
    </div>
    <span class="member-role">${esc(m.role)}</span>
    ${isOwner && m.id !== state.user.id ? `<button class="delete-btn" data-remove-member="${m.id}" title="Remove member">✕</button>` : ''}
  </div>`).join('');

  // Family Category Doughnut Graph
  renderFamilyCategoryChart(dash.categories);

  // Family Spending Alerts
  renderFamilySpendingAlerts(monthlySpent, f.monthly_budget);

  // Family Recent Activity
  $('#familyActivity').innerHTML=tx.transactions.length?tx.transactions.slice(0,8).map(t=>txRow(t)).join(''):'<p class="empty">Family activity appears here when members add transactions.</p>';
}

function renderFamilySpendingAlerts(monthlySpent, monthlyBudget) {
  const container = $('#familyAlertsContainer');
  if (!monthlyBudget || monthlyBudget === 0) {
    container.innerHTML = `<div class="alert-card safe"><span class="alert-icon">ℹ️</span><span>No family budget set yet.</span></div>`;
    return;
  }

  const pct = Math.round((monthlySpent / monthlyBudget) * 100);
  let alertObj;

  if (monthlySpent > monthlyBudget) {
    const diff = monthlySpent - monthlyBudget;
    alertObj = {
      severity: 'danger',
      icon: '🚨',
      msg: `Family budget exceeded by ${fmt(diff)}! (Total family expense: ${fmt(monthlySpent)} against ${fmt(monthlyBudget)} budget).`
    };
  } else if (pct >= 90) {
    alertObj = {
      severity: 'danger',
      icon: '⚠️',
      msg: `Careful! Your family has almost reached this month's budget (${pct}% used).`
    };
  } else if (pct >= 75) {
    alertObj = {
      severity: 'warning',
      icon: '⚡',
      msg: `Your family has used ${pct}% of this month's budget.`
    };
  } else {
    alertObj = {
      severity: 'safe',
      icon: '✅',
      msg: `Safe: Family spending is at ${pct}% of monthly budget (${fmt(monthlySpent)} of ${fmt(monthlyBudget)}).`
    };
  }

  container.innerHTML = `<div class="alert-card ${alertObj.severity}"><span class="alert-icon">${alertObj.icon}</span><span>${esc(alertObj.msg)}</span></div>`;
}

function renderFamilyCategoryChart(categories) {
  const canvas = $('#familyCategoryChartCanvas');
  if (!canvas) return;

  if (!categories || categories.length === 0) {
    if (familyCategoryChartInstance) { familyCategoryChartInstance.destroy(); familyCategoryChartInstance = null; }
    canvas.style.display = 'none';
    return;
  }

  canvas.style.display = 'block';

  const labels = categories.map(c => c.category);
  const data = categories.map(c => c.amount / 100);
  const colors = ['#6366f1', '#14a57f', '#f59e0b', '#ed776a', '#8b5cf6', '#06b6d4', '#ec4899', '#10b981', '#64748b'];

  if (familyCategoryChartInstance) familyCategoryChartInstance.destroy();

  familyCategoryChartInstance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: colors.slice(0, labels.length),
        borderWidth: 2,
        borderColor: '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              return ` ${ctx.label}: ₹${ctx.raw.toLocaleString('en-IN')}`;
            }
          }
        }
      }
    }
  });
}

// Owner opens "Add Family Member Account" Modal
$('#openAddMemberBtn').onclick=()=>{
  showModal(
    '+ Add Family Member Account',
    'Create a login account for a family member. They will be able to log in using their Login ID.',
    `<form id="addMemberForm">
      <label>Member Name
        <input name="name" required placeholder="e.g. Mom / Dad / Sister"/>
      </label>
      <label>Login ID (Username)
        <input name="login_id" required pattern="[a-zA-Z0-9_]{3,30}" title="3-30 letters, numbers, or underscores" placeholder="e.g. mom_jadhav"/>
      </label>
      <label>Persona / Member Type
        <select name="persona">
          <option value="family">Family Member</option>
          <option value="student">Student</option>
          <option value="professional">Working Professional</option>
          <option value="senior">Senior Citizen</option>
        </select>
      </label>
      <label>Password
        <input name="password" type="password" minlength="6" required placeholder="Set member password"/>
      </label>
      <label>Confirm Password
        <input name="confirm_password" type="password" minlength="6" required placeholder="Re-enter member password"/>
      </label>
      <button class="btn primary full">Create Family Member Account</button>
    </form>`
  );

  $('#addMemberForm').onsubmit=e=>{
    e.preventDefault();
    run(async()=>{
      const f=new FormData(e.target);
      const b=Object.fromEntries(f.entries());
      if(b.password !== b.confirm_password) throw new Error('Passwords do not match.');

      const res = await api(`/families/${state.familyId}/members`, {
        method: 'POST',
        body: JSON.stringify({
          name: b.name,
          login_id: b.login_id,
          password: b.password,
          persona: b.persona
        })
      });

      closeModal();
      await loadFamily();
      alert(`Family member created successfully!\n\nName: ${res.member.name}\nLogin ID: ${res.member.login_id}\n\nShare these credentials with your family member to log in.`);
      toast(`Created family account for ${res.member.name}`);
    });
  };
};

$('#addFamilyTx').onclick=()=>openTx(state.familyId);
$('#famAddAnother').onclick=()=>openTx(state.familyId);

// --- MODAL SYSTEM ---
function showModal(title,subtitle,html){
  $('#modalTitle').textContent=title;
  $('#modalSubtitle').textContent=subtitle;
  $('#modalContent').innerHTML=html;
  $('#modalBackdrop').classList.remove('hidden');
}

function closeModal(){
  $('#modalBackdrop').classList.add('hidden');
  $('#modalContent').innerHTML='';
}

$('#closeModal').onclick=closeModal;
$('#modalBackdrop').onclick=e=>{ if(e.target===$('#modalBackdrop')) closeModal(); };
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeModal(); });

function scopeOptions(selected){
  return `<option value="">Personal</option>`+state.families.map(f=>`<option value="${f.id}" ${Number(selected)===f.id?'selected':''}>${esc(f.name)} (shared)</option>`).join('');
}

// --- ADD TRANSACTION MODAL ---
function openTx(familyId=null,forcedGoal=null){
  showModal(
    'New Transaction',
    'Log income or expense categorized by your persona.',
    `<form id="txForm">
      <label>Record in
        <select name="family_id" id="txFamily">${scopeOptions(familyId)}</select>
      </label>
      <label>Transaction Type
        <select name="type" id="txType">
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
      </label>
      <label>Category
        <select name="category" id="txCategory"></select>
      </label>
      <label>Amount (₹)
        <input name="amount" type="number" step="0.01" min="0.01" max="100000000" required placeholder="e.g. 500.00"/>
      </label>
      <label>Date
        <input name="occurred_on" type="date" max="2999-12-31" value="${todayLocal()}" required/>
      </label>
      <label>Note (optional)
        <input name="note" maxlength="240" placeholder="e.g. Dinner with friends"/>
      </label>
      <button class="btn primary full">Save Transaction</button>
    </form>`
  );

  $('#txType').onchange=()=>updateTxCategories();
  updateTxCategories();

  $('#txForm').onsubmit=e=>{
    e.preventDefault();
    run(async()=>{
      const f=new FormData(e.target);
      const b=Object.fromEntries(f.entries());
      b.family_id=b.family_id ? Number(b.family_id) : null;
      
      await api('/transactions',{method:'POST',body:JSON.stringify(b)});
      closeModal();
      await go(state.page);
      toast('Transaction saved successfully.');
    });
  };
}

function updateTxCategories(){
  const type = $('#txType').value;
  const persona = (state.user && state.user.persona) ? state.user.persona : 'student';
  let cats = [];
  
  if (type === 'income') {
    cats = INCOME_CATEGORIES;
  } else {
    cats = EXPENSE_CATEGORIES[persona] || EXPENSE_CATEGORIES.student;
  }

  $('#txCategory').innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');
}

// --- MANAGE BUDGETS MODAL ---
function openBudgetModal(){
  showModal(
    'Manage Monthly Budgets',
    'Set your overall monthly budget limit or category-specific limits.',
    `<form id="budgetForm">
      <label>Budget Category
        <select name="category" id="budgetCategory">
          <option value="">Overall Monthly Budget</option>
        </select>
      </label>
      <label>Monthly Limit (₹)
        <input name="monthly_limit" type="number" step="0.01" min="0" required placeholder="e.g. 15000"/>
      </label>
      <button class="btn primary full">Save Budget</button>
    </form>`
  );

  const persona = (state.user && state.user.persona) ? state.user.persona : 'student';
  const expCats = EXPENSE_CATEGORIES[persona] || EXPENSE_CATEGORIES.student;
  $('#budgetCategory').innerHTML = `<option value="">Overall Monthly Budget</option>` + expCats.map(c => `<option value="${c}">${c} Budget</option>`).join('');

  $('#budgetForm').onsubmit=e=>{
    e.preventDefault();
    run(async()=>{
      const f=new FormData(e.target);
      const b=Object.fromEntries(f.entries());
      await api('/budgets', {
        method: 'POST',
        body: JSON.stringify({
          category: b.category || null,
          monthly_limit: b.monthly_limit
        })
      });
      closeModal();
      await loadDashboard();
      toast('Budget saved successfully.');
    });
  };
}

$('#openBudgetBtn').onclick = openBudgetModal;
$('#manageBudgetBtn').onclick = openBudgetModal;
$('#quickAdd').onclick = () => openTx();

document.querySelectorAll('[data-modal]').forEach(x => {
  x.onclick = () => {
    if (x.dataset.modal === 'goal') openGoal();
    else openTx();
  };
});

// Event Delegation for Deleting & Removing
document.addEventListener('click', e => {
  const delTx = e.target.closest('[data-delete-tx]');
  const remMem = e.target.closest('[data-remove-member]');
  
  if (delTx) {
    run(async()=>{
      if(!confirm('Delete this transaction?')) return;
      await api('/transactions/'+delTx.dataset.deleteTx, {method:'DELETE'});
      await go(state.page);
      toast('Transaction deleted.');
    });
  }

  if (remMem) {
    run(async()=>{
      if(!confirm('Remove this family member from family circle?')) return;
      await api(`/families/${state.familyId}/members/${remMem.dataset.removeMember}`, {method:'DELETE'});
      await loadFamily();
      toast('Member removed.');
    });
  }
});

function openGoal(familyId=null){
  showModal(
    'Create a Savings Goal',
    'Set a target and add contributions over time.',
    `<form id="goalForm">
      <label>Goal Space
        <select name="family_id">${scopeOptions(familyId)}</select>
      </label>
      <label>What are you saving for?
        <input name="title" maxlength="90" minlength="2" required placeholder="e.g. Emergency Fund"/>
      </label>
      <label>Target (₹)
        <input name="target_amount" type="number" min="0.01" max="100000000" step="0.01" required placeholder="e.g. 25000"/>
      </label>
      <button class="btn primary full">Create Savings Goal</button>
    </form>`
  );

  $('#goalForm').onsubmit=e=>{
    e.preventDefault();
    run(async()=>{
      const f=Object.fromEntries(new FormData(e.target));
      await api('/goals',{method:'POST',body:JSON.stringify({...f,family_id:f.family_id||null})});
      closeModal();
      await go(state.page);
      toast('Goal created.');
    });
  };
}

// Initial Bootup Check
run(async()=>{
  try{
    const r=await api('/me');
    await boot(r.user);
  }catch(e){
    $('#auth').classList.remove('hidden');
    setAuthMode('login');
  }
});
