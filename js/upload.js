let categories = [];
let pendingRows = [];   // parsed but not yet confirmed

async function init() {
  const user = await requireAuth();
  if (!user) return;
  await renderNav('upload.html');
  const { data } = await db.from('categories').select('name').order('name');
  categories = (data || []).map(c => c.name);
  setupDropZone();
}

function setupDropZone() {
  const zone  = document.getElementById('dropZone');
  const input = document.getElementById('fileInput');

  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', e => handleFile(e.target.files[0]));
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    handleFile(e.dataTransfer.files[0]);
  });
}

async function handleFile(file) {
  if (!file) return;

  const bank = document.getElementById('bankSelect').value;
  if (!bank) { showToast('Please select your bank first'); return; }

  showStep('parsing');
  document.getElementById('parseStatus').textContent = `Reading ${file.name}…`;

  try {
    // Upload to Supabase Storage first
    const user = await getUser();
    const storagePath = `${user.id}/${Date.now()}_${file.name}`;
    const { error: upErr } = await db.storage.from('statements').upload(storagePath, file);
    if (upErr) throw new Error(upErr.message);

    // Record the file in uploaded_files table
    const { data: fileRow, error: dbErr } = await db.from('uploaded_files').insert({
      user_id: user.id,
      filename: file.name,
      file_type: file.name.split('.').pop().toLowerCase(),
      bank,
      storage_path: storagePath
    }).select().single();
    if (dbErr) throw new Error(dbErr.message);

    document.getElementById('parseStatus').textContent = 'Analysing with AI…';

    // Call Edge Function to parse + categorise
    const { data: { session } } = await db.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/parse-statement`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ storage_path: storagePath, bank, file_id: fileRow.id })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Parsing failed');
    }

    const result = await res.json();
    pendingRows = result.transactions || [];

    // Update file row count
    await db.from('uploaded_files').update({ row_count: pendingRows.length }).eq('id', fileRow.id);

    showStep('review');
    renderReview(pendingRows);
    document.getElementById('reviewCount').textContent = pendingRows.length;

  } catch (err) {
    showStep('upload');
    showToast('Error: ' + err.message);
    console.error(err);
  }
}

function showStep(step) {
  document.getElementById('stepUpload').style.display  = step === 'upload'  ? 'block' : 'none';
  document.getElementById('stepParsing').style.display = step === 'parsing' ? 'block' : 'none';
  document.getElementById('stepReview').style.display  = step === 'review'  ? 'block' : 'none';
  document.getElementById('stepDone').style.display    = step === 'done'    ? 'block' : 'none';
}

function renderReview(rows) {
  const container = document.getElementById('reviewRows');
  const uncertain = rows.filter(r => (r.confidence || 0) < 0.85).length;
  document.getElementById('uncertainCount').textContent =
    uncertain > 0 ? `${uncertain} item${uncertain!==1?'s':''} need your attention` : 'All items categorised with high confidence';

  container.innerHTML = rows.map((row, idx) => {
    const conf    = row.confidence || 0;
    const isHigh  = conf >= 0.85;
    const icon    = isHigh ? '✅' : '⚠️';
    const pct     = Math.round(conf * 100);
    const catOpts = ['', ...categories].map(c =>
      `<option value="${c}"${row.category === c ? ' selected' : ''}>${c || 'Select category…'}</option>`
    ).join('');

    return `
      <div class="review-row ${isHigh ? 'confirmed' : ''}" id="reviewRow${idx}">
        <span class="conf-icon">${icon}</span>
        <div class="desc">
          <div style="font-weight:500">${row.description}</div>
          <div style="font-size:12px;color:var(--muted)">${row.date}</div>
        </div>
        <span class="amount">${formatCurrency(row.amount)}</span>
        <select class="form-control cat-select" onchange="updatePending(${idx}, 'category', this.value); markEdited(${idx})">
          ${catOpts}
        </select>
        <span class="conf-pct">${pct}%</span>
        <button onclick="removePending(${idx})" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:16px" title="Remove">✕</button>
      </div>
    `;
  }).join('');
}

function updatePending(idx, key, value) {
  if (pendingRows[idx]) pendingRows[idx][key] = value;
}

function markEdited(idx) {
  const row = document.getElementById(`reviewRow${idx}`);
  if (row) { row.classList.remove('confirmed'); }
  if (pendingRows[idx]) pendingRows[idx].confidence = 1.0;
}

function removePending(idx) {
  pendingRows.splice(idx, 1);
  renderReview(pendingRows);
  document.getElementById('reviewCount').textContent = pendingRows.length;
}

async function confirmAll() {
  const btn = document.getElementById('confirmBtn');
  btn.textContent = 'Saving…';
  btn.disabled = true;

  try {
    const user = await getUser();
    const rows = pendingRows.filter(r => r.date && r.amount != null).map(r => ({
      user_id:      user.id,
      date:         r.date,
      description:  r.description,
      amount:       parseFloat(r.amount),
      category:     r.category || null,
      source_bank:  r.source_bank || document.getElementById('bankSelect').value,
      file_id:      r.file_id
    }));

    // Batch insert in chunks of 100
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await db.from('transactions').insert(rows.slice(i, i + 100));
      if (error) throw new Error(error.message);
    }

    // Update merchant patterns for all confirmed rows
    const patternUpserts = rows
      .filter(r => r.category)
      .map(r => ({
        keyword:           r.description.toLowerCase().split(/\s+/).slice(0,3).join(' '),
        category:          r.category,
        confirmation_count: 1,
        last_seen:         new Date().toISOString()
      }));

    if (patternUpserts.length) {
      await db.from('merchant_patterns').upsert(patternUpserts, { onConflict: 'keyword', ignoreDuplicates: false });
    }

    document.getElementById('savedCount').textContent = rows.length;
    showStep('done');

  } catch (err) {
    showToast('Save failed: ' + err.message);
    btn.textContent = 'Confirm & Save All';
    btn.disabled = false;
  }
}

function resetUpload() {
  pendingRows = [];
  document.getElementById('fileInput').value = '';
  document.getElementById('bankSelect').value = '';
  showStep('upload');
}

init();
