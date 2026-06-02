let allTxns = [];
let categories = [];

async function init() {
  const user = await requireAuth();
  if (!user) return;
  await renderNav('transactions.html');
  await loadCategories();
  await loadTransactions();
}

async function loadCategories() {
  const { data } = await db.from('categories').select('name').order('name');
  categories = (data || []).map(c => c.name);
  const sel = document.getElementById('filterCategory');
  sel.innerHTML = '<option value="">All categories</option>' +
    categories.map(c => `<option value="${c}">${c}</option>`).join('');
}

async function loadTransactions() {
  document.getElementById('loading').style.display = 'block';
  document.getElementById('tableWrap').style.display = 'none';

  const { data } = await db.from('transactions')
    .select('*')
    .order('date', { ascending: false });

  allTxns = data || [];
  document.getElementById('loading').style.display = 'none';
  document.getElementById('tableWrap').style.display = 'block';
  applyFilters();
}

function applyFilters() {
  const dateFrom = document.getElementById('filterFrom').value;
  const dateTo   = document.getElementById('filterTo').value;
  const cat      = document.getElementById('filterCategory').value;
  const who      = document.getElementById('filterWho').value;
  const search   = document.getElementById('filterSearch').value.toLowerCase();

  let filtered = allTxns.filter(t => {
    if (dateFrom && t.date < dateFrom) return false;
    if (dateTo   && t.date > dateTo)   return false;
    if (cat      && t.category !== cat) return false;
    if (who === 'edison' && !['manual','cba_credit','cba_bank','amex','hsbc','citibank'].includes(t.source_bank)) return false;
    if (search   && !t.description.toLowerCase().includes(search) && !(t.category||'').toLowerCase().includes(search)) return false;
    return true;
  });

  renderTable(filtered);
  document.getElementById('countLabel').textContent = `${filtered.length} transaction${filtered.length !== 1 ? 's' : ''}`;
  const total = filtered.reduce((s, t) => s + parseFloat(t.amount), 0);
  document.getElementById('totalLabel').textContent = formatCurrency(total);

  // store for CSV export
  window._filteredTxns = filtered;
}

function renderTable(txns) {
  const tbody = document.getElementById('txnBody');
  if (!txns.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--muted)">No transactions match your filters</td></tr>`;
    return;
  }

  tbody.innerHTML = txns.map(t => `
    <tr>
      <td style="color:var(--muted);font-size:13px;white-space:nowrap">${formatDate(t.date)}</td>
      <td>
        ${t.description}
        ${t.is_recurring ? '<span style="font-size:11px;color:var(--teal);margin-left:6px">↻ recurring</span>' : ''}
      </td>
      <td>
        <select class="form-control" style="min-width:140px;padding:5px 8px;font-size:13px"
          onchange="updateCategory('${t.id}', this.value)">
          <option value="">Uncategorised</option>
          ${categories.map(c => `<option value="${c}"${t.category === c ? ' selected' : ''}>${c}</option>`).join('')}
        </select>
      </td>
      <td style="font-size:12px;color:var(--muted)">${t.source_bank || 'manual'}</td>
      <td style="text-align:right;font-weight:600;color:var(--danger);white-space:nowrap">${formatCurrency(t.amount)}</td>
      <td style="text-align:center">
        <button onclick="toggleRecurring('${t.id}', ${t.is_recurring})"
          title="${t.is_recurring ? 'Remove recurring' : 'Mark recurring'}"
          style="background:none;border:none;cursor:pointer;font-size:18px">
          ${t.is_recurring ? '🔄' : '➕'}
        </button>
        <button onclick="deleteTransaction('${t.id}')"
          style="background:none;border:none;cursor:pointer;font-size:16px;color:var(--muted)">🗑</button>
      </td>
    </tr>
  `).join('');
}

async function updateCategory(id, category) {
  const { error } = await db.from('transactions').update({ category }).eq('id', id);
  if (error) { showToast('Failed to update category'); return; }

  // Update merchant pattern
  const txn = allTxns.find(t => t.id === id);
  if (txn && category) {
    const keyword = txn.description.toLowerCase().split(/\s+/).slice(0,3).join(' ');
    await db.from('merchant_patterns').upsert(
      { keyword, category, confirmation_count: 1, last_seen: new Date().toISOString() },
      { onConflict: 'keyword', ignoreDuplicates: false }
    );
    // increment count via rpc if exists
    await db.rpc('increment_pattern_count', { p_keyword: keyword }).catch(() => {});
  }

  const idx = allTxns.findIndex(t => t.id === id);
  if (idx >= 0) allTxns[idx].category = category;
  showToast('Category updated ✓');
}

async function toggleRecurring(id, current) {
  const { error } = await db.from('transactions').update({ is_recurring: !current }).eq('id', id);
  if (error) { showToast('Failed to update'); return; }
  const idx = allTxns.findIndex(t => t.id === id);
  if (idx >= 0) allTxns[idx].is_recurring = !current;
  applyFilters();
  showToast(current ? 'Removed recurring flag' : 'Marked as recurring ✓');
}

async function deleteTransaction(id) {
  if (!confirm('Delete this transaction?')) return;
  const { error } = await db.from('transactions').delete().eq('id', id);
  if (error) { showToast('Failed to delete'); return; }
  allTxns = allTxns.filter(t => t.id !== id);
  applyFilters();
  showToast('Transaction deleted');
}

function downloadCSV() {
  const txns = window._filteredTxns || allTxns;
  const headers = ['Date', 'Description', 'Amount', 'Category', 'Recurring', 'Source', 'Added'];
  const rows = txns.map(t => [
    t.date,
    `"${(t.description || '').replace(/"/g, '""')}"`,
    t.amount,
    `"${(t.category || '').replace(/"/g, '""')}"`,
    t.is_recurring ? 'Yes' : 'No',
    t.source_bank || 'manual',
    t.created_at ? t.created_at.split('T')[0] : ''
  ].join(','));

  const csv  = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `nguyen-transactions-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Filter event listeners (attached after DOM ready)
document.addEventListener('DOMContentLoaded', () => {
  ['filterFrom','filterTo','filterCategory','filterWho','filterSearch'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', applyFilters);
    document.getElementById(id)?.addEventListener('change', applyFilters);
  });
});

init();
