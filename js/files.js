async function init() {
  const user = await requireAuth();
  if (!user) return;
  await renderNav('files.html');
  await loadFiles();
}

async function loadFiles() {
  const { data, error } = await db.from('uploaded_files')
    .select('*')
    .order('uploaded_at', { ascending: false });

  const container = document.getElementById('filesList');

  if (error || !data?.length) {
    container.innerHTML = `
      <div class="empty">
        <div class="icon">📁</div>
        <p>No files uploaded yet.<br><a href="upload.html" style="color:var(--teal)">Upload your first statement →</a></p>
      </div>`;
    return;
  }

  const bankLabels = {
    cba_credit: 'CBA Credit Card',
    cba_bank:   'CBA Bank Account',
    amex:       'American Express',
    hsbc:       'HSBC',
    citibank:   'Citibank',
    excel:      'Manual / Excel',
    pdf_other:  'PDF Statement'
  };

  const fileIcons = { csv: '📊', pdf: '📄', xlsx: '📋', xls: '📋' };

  container.innerHTML = data.map(f => `
    <div class="file-item">
      <div class="file-icon">${fileIcons[f.file_type] || '📁'}</div>
      <div class="file-info">
        <div class="name">${f.filename}</div>
        <div class="meta">
          ${bankLabels[f.bank] || f.bank || 'Unknown'} ·
          ${f.row_count != null ? f.row_count + ' rows · ' : ''}
          ${new Date(f.uploaded_at).toLocaleDateString('en-AU', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0">
        <button onclick="downloadFile('${f.storage_path}', '${f.filename}')" class="btn btn-secondary btn-sm">⬇ Download</button>
        <button onclick="deleteFile('${f.id}', '${f.storage_path}')" class="btn btn-sm" style="background:none;border:1px solid var(--border);color:var(--muted)">🗑</button>
      </div>
    </div>
  `).join('');

  document.getElementById('fileCount').textContent = `${data.length} file${data.length!==1?'s':''}`;
}

async function downloadFile(storagePath, filename) {
  const { data, error } = await db.storage.from('statements').createSignedUrl(storagePath, 60);
  if (error) { showToast('Could not generate download link'); return; }
  const a = document.createElement('a');
  a.href = data.signedUrl;
  a.download = filename;
  a.click();
}

async function deleteFile(id, storagePath) {
  if (!confirm('Delete this file? This will not delete the imported transactions.')) return;

  const { error: storErr } = await db.storage.from('statements').remove([storagePath]);
  const { error: dbErr }   = await db.from('uploaded_files').delete().eq('id', id);

  if (storErr || dbErr) { showToast('Failed to delete file'); return; }
  showToast('File deleted');
  loadFiles();
}

init();
