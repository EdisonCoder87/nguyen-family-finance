// Auth helpers — shared across all pages

async function requireAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    window.location.href = '/login.html';
    return null;
  }
  return session.user;
}

async function getUser() {
  const { data: { session } } = await db.auth.getSession();
  return session ? session.user : null;
}

function getUserLabel(user) {
  if (!user) return '';
  const email = user.email || '';
  if (email.toLowerCase().includes('grace')) return 'Grace';
  return 'Edison';
}

async function renderNav(activePage) {
  const user = await getUser();
  if (!user) return;

  const nav = document.getElementById('nav');
  if (!nav) return;

  const label = getUserLabel(user);
  const pages = [
    { href: 'index.html',        label: 'Dashboard'    },
    { href: 'transactions.html', label: 'Transactions' },
    { href: 'upload.html',       label: 'Upload'       },
    { href: 'files.html',        label: 'Files'        },
  ];

  const links = pages.map(p => {
    const active = p.href === activePage ? 'active' : '';
    return `<a href="${p.href}" class="${active}">${p.label}</a>`;
  }).join('');

  nav.innerHTML = `
    <div class="logo">Nguyen <span>Finance</span></div>
    <button class="nav-toggle" onclick="toggleNav()" aria-label="Menu">
      <span></span><span></span><span></span>
    </button>
    <div class="nav-links" id="navLinks">${links}</div>
    <div class="nav-right">
      <span class="user-chip">${label}</span>
      <button class="btn-logout" onclick="logout()">Sign out</button>
    </div>
  `;
}

function toggleNav() {
  document.getElementById('navLinks')?.classList.toggle('open');
}

async function logout() {
  await db.auth.signOut();
  window.location.href = 'login.html';
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(amount);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function showToast(msg, duration = 2500) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}
