let categoryChart, momChart;
let allTransactions = [];
let currentMonth, currentYear;

async function init() {
  const user = await requireAuth();
  if (!user) return;
  await renderNav('index.html');

  const now = new Date();
  currentMonth = now.getMonth();
  currentYear  = now.getFullYear();

  renderMonthPicker();
  await loadDashboard();
  renderFAB();
}

function renderMonthPicker() {
  const sel = document.getElementById('monthPicker');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const options = [];
  // last 18 months
  for (let i = 0; i < 18; i++) {
    let m = currentMonth - i;
    let y = currentYear;
    if (m < 0) { m += 12; y--; }
    const val = `${y}-${String(m+1).padStart(2,'0')}`;
    const lbl = `${months[m]} ${y}`;
    options.push(`<option value="${val}"${i===0?' selected':''}>${lbl}</option>`);
  }
  sel.innerHTML = options.join('');
  sel.addEventListener('change', () => {
    const [y, m] = sel.value.split('-').map(Number);
    currentYear = y; currentMonth = m - 1;
    loadDashboard();
  });
}

async function loadDashboard() {
  document.getElementById('loadingMsg').style.display = 'block';

  const monthStr = `${currentYear}-${String(currentMonth+1).padStart(2,'0')}`;
  const startDate = `${monthStr}-01`;
  const endDate   = new Date(currentYear, currentMonth+1, 0).toISOString().split('T')[0];

  // Current month
  const { data: txns } = await db.from('transactions')
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: false });

  // Previous month for MoM
  let pm = currentMonth - 1, py = currentYear;
  if (pm < 0) { pm = 11; py--; }
  const pmStr   = `${py}-${String(pm+1).padStart(2,'0')}`;
  const pmStart = `${pmStr}-01`;
  const pmEnd   = new Date(py, pm+1, 0).toISOString().split('T')[0];

  const { data: prevTxns } = await db.from('transactions')
    .select('*')
    .gte('date', pmStart)
    .lte('date', pmEnd);

  // Year-to-date
  const ytdStart = `${currentYear}-01-01`;
  const { data: ytdTxns } = await db.from('transactions')
    .select('*')
    .gte('date', ytdStart)
    .lte('date', endDate);

  // Recurring
  const { data: recurringTxns } = await db.from('transactions')
    .select('*')
    .eq('is_recurring', true)
    .gte('date', startDate)
    .lte('date', endDate);

  allTransactions = txns || [];
  document.getElementById('loadingMsg').style.display = 'none';

  renderStats(txns || [], prevTxns || []);
  renderCategoryChart(txns || []);
  renderMoMChart(txns || [], prevTxns || []);
  renderFixedCosts(recurringTxns || []);
  renderRecentTransactions(txns || []);
  renderYTDTable(ytdTxns || []);
}

function renderStats(txns, prevTxns) {
  const total     = txns.reduce((s, t) => s + parseFloat(t.amount), 0);
  const prevTotal = prevTxns.reduce((s, t) => s + parseFloat(t.amount), 0);
  const diff      = total - prevTotal;
  const pct       = prevTotal ? ((diff / prevTotal) * 100).toFixed(0) : 0;
  const arrow     = diff > 0 ? '▲' : '▼';
  const diffColor = diff > 0 ? '#E74C3C' : '#27AE60';

  document.getElementById('statTotal').textContent   = formatCurrency(total);
  document.getElementById('statCount').textContent   = txns.length;
  document.getElementById('statAvg').textContent     = txns.length ? formatCurrency(total / txns.length) : '$0';
  document.getElementById('statMoM').innerHTML       = `<span style="color:${diffColor}">${arrow} ${Math.abs(pct)}% vs last month</span>`;
}

function groupByCategory(txns) {
  const map = {};
  for (const t of txns) {
    const cat = t.category || 'Uncategorised';
    map[cat] = (map[cat] || 0) + parseFloat(t.amount);
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

function renderCategoryChart(txns) {
  const grouped = groupByCategory(txns);
  const labels  = grouped.map(([k]) => k);
  const values  = grouped.map(([, v]) => v);
  const colors  = generateColors(labels.length);

  if (categoryChart) categoryChart.destroy();
  const ctx = document.getElementById('categoryChart').getContext('2d');
  categoryChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors, borderRadius: 6, borderSkipped: false }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => ' ' + formatCurrency(ctx.raw) }
        }
      },
      scales: {
        x: { ticks: { callback: v => '$' + (v/1000).toFixed(0) + 'k' }, grid: { color: '#F0F2F5' } },
        y: { grid: { display: false }, ticks: { font: { size: 12 } } }
      }
    }
  });
}

function renderMoMChart(curr, prev) {
  // Daily running total for current vs previous month
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const currLabel = `${months[currentMonth]} ${currentYear}`;
  let pm = currentMonth - 1, py = currentYear;
  if (pm < 0) { pm = 11; py--; }
  const prevLabel = `${months[pm]} ${py}`;

  const daysInMonth = new Date(currentYear, currentMonth+1, 0).getDate();
  const labels = Array.from({length: daysInMonth}, (_, i) => i+1);

  function dailyTotals(txns, year, month) {
    const totals = Array(daysInMonth).fill(0);
    for (const t of txns) {
      const d = new Date(t.date);
      if (d.getFullYear() === year && d.getMonth() === month) {
        totals[d.getDate() - 1] += parseFloat(t.amount);
      }
    }
    // running cumulative
    let running = 0;
    return totals.map(v => { running += v; return running; });
  }

  const currData = dailyTotals(curr, currentYear, currentMonth);
  const prevData = dailyTotals(prev, py, pm);

  if (momChart) momChart.destroy();
  const ctx = document.getElementById('momChart').getContext('2d');
  momChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: currLabel, data: currData, borderColor: '#1ABC9C', backgroundColor: 'rgba(26,188,156,0.1)', fill: true, tension: 0.3, pointRadius: 2 },
        { label: prevLabel, data: prevData, borderColor: '#95A5A6', backgroundColor: 'transparent', borderDash: [5,4], tension: 0.3, pointRadius: 2 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12, font: { size: 12 } } },
        tooltip: { callbacks: { label: ctx => ' ' + formatCurrency(ctx.raw) } }
      },
      scales: {
        x: { grid: { display: false } },
        y: { ticks: { callback: v => '$' + (v/1000).toFixed(0) + 'k' }, grid: { color: '#F0F2F5' } }
      }
    }
  });
}

function renderFixedCosts(recurringTxns) {
  const el = document.getElementById('fixedCostsList');
  if (!recurringTxns.length) {
    el.innerHTML = '<p style="color:var(--muted);font-size:14px;">No recurring items this month. Mark transactions as recurring to see them here.</p>';
    document.getElementById('fixedCostsTotal').textContent = '';
    return;
  }
  const total = recurringTxns.reduce((s, t) => s + parseFloat(t.amount), 0);
  el.innerHTML = `
    <ul class="fixed-costs-list">
      ${recurringTxns.map(t => `
        <li>
          <span>${t.description}</span>
          <span style="font-weight:600">${formatCurrency(t.amount)}</span>
        </li>
      `).join('')}
    </ul>
    <div class="fixed-costs-total">
      <span>Total fixed costs</span>
      <span>${formatCurrency(total)}</span>
    </div>
  `;
}

function renderRecentTransactions(txns) {
  const el   = document.getElementById('recentTxns');
  const show = txns.slice(0, 8);
  if (!show.length) {
    el.innerHTML = '<div class="empty"><div class="icon">💸</div><p>No transactions this month</p></div>';
    return;
  }
  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Date</th><th>Description</th><th>Category</th><th style="text-align:right">Amount</th>
        </tr></thead>
        <tbody>
          ${show.map(t => `
            <tr>
              <td style="color:var(--muted);font-size:13px">${formatDate(t.date)}</td>
              <td>${t.description}</td>
              <td><span class="badge">${t.category || 'Uncategorised'}</span></td>
              <td style="text-align:right;font-weight:600;color:var(--danger)">${formatCurrency(t.amount)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ${txns.length > 8 ? `<div style="padding:12px 0 0;text-align:center"><a href="transactions.html" class="btn btn-secondary btn-sm">View all ${txns.length} transactions</a></div>` : ''}
  `;
}

function renderYTDTable(ytdTxns) {
  const el      = document.getElementById('ytdTable');
  const grouped = groupByCategory(ytdTxns);
  const total   = ytdTxns.reduce((s, t) => s + parseFloat(t.amount), 0);

  if (!grouped.length) { el.innerHTML = '<p style="color:var(--muted);font-size:14px;">No data yet for this year.</p>'; return; }

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Category</th><th style="text-align:right">YTD Total</th><th style="text-align:right">% of spend</th></tr></thead>
        <tbody>
          ${grouped.map(([cat, amt]) => `
            <tr>
              <td><span class="badge">${cat}</span></td>
              <td style="text-align:right;font-weight:600">${formatCurrency(amt)}</td>
              <td style="text-align:right;color:var(--muted)">${((amt/total)*100).toFixed(1)}%</td>
            </tr>
          `).join('')}
          <tr style="font-weight:700;border-top:2px solid var(--border)">
            <td>Total</td>
            <td style="text-align:right">${formatCurrency(total)}</td>
            <td style="text-align:right">100%</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

function generateColors(n) {
  const palette = ['#1ABC9C','#3498DB','#9B59B6','#E67E22','#E74C3C','#27AE60','#F39C12','#2980B9','#8E44AD','#16A085','#D35400','#C0392B','#2ECC71','#1ABC9C'];
  return Array.from({length: n}, (_, i) => palette[i % palette.length]);
}

function renderFAB() {
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.title = 'Add expense';
  fab.innerHTML = '+';
  fab.onclick = () => openQuickAdd();
  document.body.appendChild(fab);
}

// ---- Quick-add modal ----
let categories = [];

async function openQuickAdd() {
  if (!categories.length) {
    const { data } = await db.from('categories').select('name').order('name');
    categories = (data || []).map(c => c.name);
  }

  let modal = document.getElementById('quickAddModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'quickAddModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>Add Expense</h3>
          <button class="modal-close" onclick="closeQuickAdd()">✕</button>
        </div>
        <form id="quickAddForm">
          <div class="form-group">
            <label>Date</label>
            <input id="qaDate" type="date" class="form-control" required value="${new Date().toISOString().split('T')[0]}">
          </div>
          <div class="form-group">
            <label>Description</label>
            <input id="qaDesc" type="text" class="form-control" placeholder="e.g. Woolworths, Childcare..." required autocomplete="off">
          </div>
          <div class="form-group">
            <label>Amount (AUD)</label>
            <input id="qaAmount" type="number" class="form-control" placeholder="0.00" step="0.01" min="0" required>
          </div>
          <div class="form-group">
            <label>Category <span id="catLoading" style="color:var(--teal);font-size:12px;display:none">AI suggesting…</span></label>
            <select id="qaCategory" class="form-control" required>
              <option value="">Select category…</option>
              ${categories.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="display:flex;align-items:center;gap:8px">
            <input id="qaRecurring" type="checkbox" style="width:18px;height:18px;accent-color:var(--teal)">
            <label for="qaRecurring" style="margin:0;font-weight:400">Mark as recurring</label>
          </div>
          <div id="qaError" style="color:var(--danger);font-size:13px;margin-bottom:10px;display:none"></div>
          <button type="submit" class="btn btn-primary btn-block" id="qaSubmit">Save Expense</button>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    // AI categorise on description blur
    let debounceTimer;
    document.getElementById('qaDesc').addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(aiSuggestCategory, 500);
    });

    document.getElementById('quickAddForm').addEventListener('submit', saveQuickAdd);
  }

  modal.classList.add('open');
  setTimeout(() => document.getElementById('qaDesc').focus(), 100);
}

function closeQuickAdd() {
  document.getElementById('quickAddModal')?.classList.remove('open');
}

async function aiSuggestCategory() {
  const desc = document.getElementById('qaDesc').value.trim();
  if (desc.length < 3) return;

  document.getElementById('catLoading').style.display = 'inline';

  try {
    const { data: { session } } = await db.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/categorize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ description: desc })
    });
    const result = await res.json();
    if (result.category) {
      document.getElementById('qaCategory').value = result.category;
    }
  } catch (_) {}

  document.getElementById('catLoading').style.display = 'none';
}

async function saveQuickAdd(e) {
  e.preventDefault();
  const btn = document.getElementById('qaSubmit');
  const errEl = document.getElementById('qaError');
  btn.textContent = 'Saving…';
  btn.disabled = true;
  errEl.style.display = 'none';

  const user = await getUser();
  const row = {
    user_id:      user.id,
    date:         document.getElementById('qaDate').value,
    description:  document.getElementById('qaDesc').value.trim(),
    amount:       parseFloat(document.getElementById('qaAmount').value),
    category:     document.getElementById('qaCategory').value || null,
    is_recurring: document.getElementById('qaRecurring').checked,
    source_bank:  'manual'
  };

  const { error } = await db.from('transactions').insert(row);

  if (error) {
    errEl.textContent = error.message;
    errEl.style.display = 'block';
    btn.textContent = 'Save Expense';
    btn.disabled = false;
  } else {
    closeQuickAdd();
    showToast('Expense saved ✓');
    loadDashboard();
    // Reset form
    document.getElementById('quickAddForm').reset();
    document.getElementById('qaDate').value = new Date().toISOString().split('T')[0];
    btn.textContent = 'Save Expense';
    btn.disabled = false;
  }
}

init();
