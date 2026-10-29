/* Tutu Tumble Community Ledger: local-only encrypted evidence workspace.
   No third-party scripts, trackers, visitor fingerprinting, or identity guessing. */
(() => {
  'use strict';
  const root = document.getElementById('app');
  const modalRoot = document.getElementById('modal-root');
  const toastNode = document.getElementById('toast');
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const DB_NAME = 'tutu-community-ledger-v1';
  const DB_STORE = 'vault';
  const VAULT_KEY = 'primary';
  const NAV = [
    { id: 'overview', icon: '◈', label: 'Overview' },
    { id: 'evidence', icon: '▤', label: 'Evidence log' },
    { id: 'sources', icon: '◎', label: 'Sources' },
    { id: 'reports', icon: '↗', label: 'Reports & backup' },
    { id: 'import', icon: '⟳', label: 'Apify & imports' },
  ];
  let state = null;
  let cryptKey = null;
  let vaultSalt = null;
  let activeTab = 'overview';
  let filterText = '';
  let filterPlatform = 'all';
  let filterStatus = 'all';
  let editId = null;
  let pendingShots = [];
  let importedPreview = [];
  let queuedSave = Promise.resolve();
  let toastTimer;
  let savedAt = null;

  function escapeHTML(value = '') {
    return String(value ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  }
  function safeURL(raw) {
    try { const url = new URL(String(raw)); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; }
    catch { return ''; }
  }
  const shortText = (x,n=190) => String(x || '').length > n ? String(x).slice(0,n).trim() + '…' : String(x || '');
  const id = () => 'ev_' + crypto.randomUUID();
  const base64 = bytes => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
  const fromBase64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));
  const getLocalDateTime = (date = new Date()) => new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
  const dateDisplay = value => value ? new Date(value).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : 'Date not supplied';
  const dateOnly = value => value ? new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : 'Not supplied';
  const asDate = value => { if (!value) return ''; const d = new Date(value); return isNaN(d.getTime()) ? '' : d.toISOString(); };
  const bytesToHex = bytes => Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2,'0')).join('');
  const platformName = x => ({instagram:'Instagram',facebook:'Facebook',other:'Other'}[x] || 'Other');
  const kindName = x => ({public_post:'Public post',public_comment:'Public comment',private_group:'Private group (shared screenshot)',direct:'Direct message received',other:'Other'}[x] || 'Other');
  const roleName = x => ({unknown:'Unverified role',personal:'Personal account',business:'Public business page',official:'Official organization account'}[x] || 'Unverified role');
  const statusName = x => ({unverified:'Unverified',captured:'Captured',verified:'Source checked'}[x] || 'Unverified');
  const visName = x => x === 'public' ? 'Publicly visible' : 'Private / permissioned';
  const getItems = () => state?.items || [];
  function showToast(message) { clearTimeout(toastTimer); toastNode.textContent = message; toastNode.classList.add('show'); toastTimer = setTimeout(()=>toastNode.classList.remove('show'),4700); }
  function downloadBlob(blob, name) { const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),30000); }
  function prettyDay() {return new Date().toISOString().slice(0,10);}

  function openDB() {
    return new Promise((resolve,reject) => {
      const req = indexedDB.open(DB_NAME,1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE); };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
  }
  async function dbRead() {
    const db = await openDB();
    return new Promise((resolve,reject) => { const tx=db.transaction(DB_STORE,'readonly'); const r=tx.objectStore(DB_STORE).get(VAULT_KEY);r.onsuccess=()=>resolve(r.result || null); r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});
  }
  async function dbWrite(record) {
    const db = await openDB();
    return new Promise((resolve,reject) => {const tx=db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).put(record, VAULT_KEY); tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});
  }
  async function derive(passphrase,salt) {
    const raw=await crypto.subtle.importKey('raw',enc.encode(passphrase),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt:fromBase64(salt),iterations:260000,hash:'SHA-256'},raw,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async function encryptVault(data) {
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},cryptKey,enc.encode(data));
    return {format:'tutu-vault-v1',salt:vaultSalt,iv:base64(iv),data:base64(new Uint8Array(cipher)),updatedAt:new Date().toISOString()};
  }
  async function decryptVault(rec,key) {
    const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(rec.iv)},key,fromBase64(rec.data));
    const result=JSON.parse(dec.decode(bytes));
    if (!result || !Array.isArray(result.items)) throw new Error('The backup has an invalid data structure.');
    return result;
  }
  async function persist() {
    const snapshot=JSON.stringify(state);
    queuedSave=queuedSave.catch(()=>{}).then(async()=>{ const record=await encryptVault(snapshot); await dbWrite(record); savedAt=new Date().toISOString(); });
    return queuedSave;
  }
  async function mutate(fn,notification) {
    fn(state);state.updatedAt=new Date().toISOString();
    try { await persist(); render(); if(notification)showToast(notification); }
    catch(e) { showToast('Unable to save: '+e.message+'. Export a backup as soon as possible.'); console.error(e); }
  }
  async function initialize() {
    try {
      if (!window.isSecureContext || !crypto?.subtle || !window.indexedDB) throw new Error('Use an HTTPS website in a modern browser to protect and store your evidence.');
      const existing=await dbRead(); renderLock(!!existing);
    } catch (e) { root.innerHTML=`<div class="lock-bg"><div class="hero-lock"><h2>Secure storage unavailable</h2><p>${escapeHTML(e.message)}</p><p>Try the deployed HTTPS site in Chrome or Safari, not an insecure local preview.</p></div></div>`; }
  }
  function renderLock(existing) {
    root.innerHTML=`<main class="lock-bg"><div class="lock-brand"><span class="brand-mark">♡</span><div><strong style="font-family:Georgia,serif;font-size:21px;font-weight:500">Tutu Tumble</strong><div class="eyebrow" style="letter-spacing:.11em">Community Ledger</div></div></div><div class="hero-lock">
      <div class="eyebrow">${existing ? 'Private workspace' : 'Create a private workspace'}</div>
      <h1>${existing?'Welcome back.':'Document the facts.'}</h1>
      <p>${existing?'Unlock your encrypted records, screenshots, and community timeline.':'A calm, organized place to preserve what was publicly said, when it happened, and the supporting evidence—without guessing who is behind an account.'}</p>
      <form id="vault-form">
        <div class="field"><label for="pass">${existing?'Workspace passphrase':'Create passphrase (10+ characters)'}</label><input class="input" id="pass" type="password" minlength="${existing?1:10}" autocomplete="${existing?'current-password':'new-password'}" required placeholder="Enter passphrase"></div>
        ${existing?'':`<div class="field"><label for="confirm">Confirm passphrase</label><input class="input" id="confirm" type="password" minlength="10" autocomplete="new-password" required placeholder="Re-enter passphrase"></div>`}
        <button class="btn btn-primary btn-wide" type="submit">${existing?'Unlock workspace →':'Create encrypted workspace →'}</button>
      </form>
      <div class="lock-note">🔒 Records are encrypted in this browser. There is no shared database, visitor tracking, or automatic upload. <strong>Save your passphrase and export backups.</strong> If you lose the passphrase or clear browser data without a backup, your evidence cannot be recovered.</div>
    </div><p class="small muted" style="text-align:center">For factual documentation, not private-group scraping or identity attribution.</p></main>`;
  }
  async function handleVaultSubmit(form) {
    const pass=form.querySelector('#pass').value;
    const existing=await dbRead();
    const btn=form.querySelector('button'); btn.disabled=true;btn.textContent=existing?'Unlocking…':'Encrypting…';
    try {
      if (existing) {
        if (existing.format !== 'tutu-vault-v1') throw new Error('Unrecognized vault format');
        const attempt=await derive(pass,existing.salt);
        const opened=await decryptVault(existing,attempt);
        cryptKey=attempt;vaultSalt=existing.salt;state=opened;
      } else {
        if (pass.length<10) throw new Error('Use at least 10 characters.');
        if (pass!==form.querySelector('#confirm').value) throw new Error('Passphrases do not match.');
        vaultSalt=base64(crypto.getRandomValues(new Uint8Array(16)));
        cryptKey=await derive(pass,vaultSalt);
        state={version:1,items:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
        await persist();
      }
      activeTab='overview';render();showToast(existing?'Workspace unlocked':'Your encrypted workspace is ready');
    } catch(err) {showToast('Could not open workspace: '+(err.name==='OperationError'?'incorrect passphrase or corrupted data':err.message)); btn.disabled=false; btn.textContent=existing?'Unlock workspace →':'Create encrypted workspace →';}
  }

  function statCounts() {
    const entries=getItems();
    return {total:entries.length,captured:entries.filter(e=>e.status==='captured'||e.status==='verified').length,public:entries.filter(e=>e.visibility==='public').length,official:new Set(entries.filter(e=>e.role==='official').map(e=>e.platform+'|'+(e.author||'').toLowerCase())).size};
  }
  function render() {
    if (!state) return;
    const nav = NAV.map(n=>`<button class="nav-btn ${activeTab===n.id?'active':''}" data-action="tab" data-tab="${n.id}"><span class="nav-ico" aria-hidden="true">${n.icon}</span><span>${n.label}</span></button>`).join('');
    root.innerHTML=`<div class="app-layout"><aside class="sidebar"><div class="brand"><div class="brand-mark" aria-hidden="true">♡</div><div><strong>Tutu Tumble</strong><small>Community Ledger</small></div></div><nav class="side-nav" aria-label="Main navigation">${nav}</nav><div class="sidebar-foot"><strong style="font-size:12px">◌ Private, encrypted</strong><p>Records stay on this device. Save encrypted backups to transfer or preserve them.</p><button class="lock-btn" data-action="lock">⌁ Lock workspace</button></div></aside><main class="main"><div class="mobile-nav" aria-label="Main navigation">${nav}</div><div class="topbar"><div class="trail">Tutu Tumble <span style="padding:0 7px;color:#b6aab0">/</span> <b>${NAV.find(n=>n.id===activeTab)?.label||'Overview'}</b></div><div class="topbar-right"><span class="private-pill">● Private on this device</span><button class="btn btn-plain btn-sm" data-action="lock" title="Lock workspace">Lock</button></div></div><div class="content" id="view">${renderTab()}</div></main></div>`;
  }
  function renderTab() {
    return ({overview:renderOverview,evidence:renderEvidence,sources:renderSources,reports:renderReports,import:renderImport}[activeTab]||renderOverview)();
  }
  function header(title,description,action=true) {
    return `<div class="page-lead"><div><div class="eyebrow" style="margin-bottom:11px">Tutu Tumble · Napa, California</div><h1>${escapeHTML(title)}</h1><p class="muted">${escapeHTML(description)}</p></div>${action?'<button class="btn btn-primary" data-action="add">＋ Add evidence</button>':''}</div>`;
  }
  function renderOverview() {
    const c=statCounts();
    const metrics=[['Total records',c.total,'Manually reviewed or imported'],['Documented',c.captured,'Captured or source checked'],['Public records',c.public,'Visible without group access'],['Official sources',c.official,'Unique account labels, manually assigned']];
    return header('A clear record. A calm response.','Track observable posts, keep original screenshots, and make decisions from documented facts—not speculation.')+
      `<div class="grid stats">${metrics.map(m=>`<div class="stat-card"><div class="stat-label">${m[0]}</div><div class="stat-number">${m[1]}</div><div class="stat-sub">${m[2]}</div></div>`).join('')}</div>
      <div class="grid two-col" style="margin-bottom:18px"><section class="panel"><div class="panel-header"><div><h2>Activity timeline</h2><p class="muted">Records by day · past 10 days</p></div><span class="pill-muted">Local time</span></div>${renderChart()}</section>
      <section class="panel"><div class="panel-header"><div><h2>Evidence standards</h2><p class="muted">Keep the record credible</p></div></div><div class="checklist">${['Save a post link and its actual timestamp','Attach the original screenshot where available','Record exact words separately from interpretation','Do not equate personal accounts with official group views','Do not infer identities or coordination from timing'].map(i=>`<div class="checkrow"><span class="checkdot">✓</span><span>${i}</span></div>`).join('')}</div></section></div>
      <div class="grid two-col"><section class="panel"><div class="panel-header"><div><h2>Recent observations</h2><p class="muted">Newest records in your private ledger</p></div><button class="text-btn" data-action="tab" data-tab="evidence">View all →</button></div>${getItems().length?`<div class="activity">${sortItems(getItems()).slice(0,5).map(e=>`<div class="activity-item"><div class="activity-dot"></div><div style="min-width:0;flex:1"><strong>${escapeHTML(e.author||'Unknown account')} · ${platformName(e.platform)}</strong><p>${escapeHTML(shortText(e.text||'(Screenshot saved)',145))}</p><span class="small muted">${dateDisplay(e.occurredAt)} · ${statusName(e.status)}</span></div><button class="text-btn" data-action="detail" data-id="${escapeHTML(e.id)}">Open</button></div>`).join('')}</div>`:`<div class="empty"><div class="empty-icon">❀</div><h3>No records yet</h3><p>Add the publicly visible posts and screenshots you already have. No one is labeled or accused automatically.</p><button class="btn btn-primary" data-action="add">＋ Add your first record</button></div>`}</section>
      <section class="panel"><div class="panel-header"><h2>Working principles</h2></div><div class="callout"><strong>Evidence, not attribution</strong>A public post may document what an account said. It does not prove who's operating that account, who visited a website, or whether different people coordinated privately.</div><div class="subtle-divider"></div><p class="small muted" style="line-height:1.7">You can compile publicly visible material and screenshots you legitimately received. Private Facebook-group material is never scraped by this app. Keep any submitted report factual and limited to relevant evidence.</p><button class="btn btn-plain btn-sm" style="margin-top:15px" data-action="tab" data-tab="reports">Prepare a factual report →</button></section></div>`;
  }
  function renderChart() {
    const now=new Date();const days=Array.from({length:10},(_,i)=>{const d=new Date(now); d.setDate(now.getDate()-9+i); const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;return{key,label:d.toLocaleDateString(undefined,{month:'short',day:'numeric'})};});
    const counts=days.map(d=>getItems().filter(i=>i.occurredAt && localDay(new Date(i.occurredAt))===d.key).length);
    const max=Math.max(...counts,1);
    return `<div class="chart" role="img" aria-label="Evidence records across the last ten days: ${counts.join(', ')}"><span class="sr">Last ten days</span>${days.map((d,i)=>`<div class="bar-col" title="${d.label}: ${counts[i]}"><div class="bar" style="height:${Math.max(3,counts[i]/max*125)}px"></div><span class="bar-label">${i===0||i===3||i===6||i===9?d.label:''}</span></div>`).join('')}</div><p class="small muted" style="margin-top:15px">Activity volume shows when records were posted, not who was responsible.</p>`;
  }
  function localDay(d) {return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  function sortItems(arr) {return [...arr].sort((a,b)=>String(b.occurredAt||b.capturedAt).localeCompare(String(a.occurredAt||a.capturedAt)));}
  function renderEvidence() {
    const term=filterText.toLowerCase().trim();
    const items=sortItems(getItems()).filter(e=>(filterPlatform==='all'||e.platform===filterPlatform)&&(filterStatus==='all'||e.status===filterStatus)&&(!term||[e.text,e.author,e.notes,e.url,e.platform].join(' ').toLowerCase().includes(term)));
    return header('Evidence log','Maintain a dated, reviewable record of what was posted, where it appeared, and which screenshots support it.')+
      `<div class="filterbar"><input id="filter-search" class="input search" type="search" placeholder="Search authors, posts, notes…" value="${escapeHTML(filterText)}" aria-label="Search evidence"><select class="select" id="filter-platform" aria-label="Filter platform"><option value="all">All platforms</option>${['instagram','facebook','other'].map(p=>`<option value="${p}" ${filterPlatform===p?'selected':''}>${platformName(p)}</option>`).join('')}</select><select class="select" id="filter-status" aria-label="Filter status"><option value="all">All statuses</option>${['unverified','captured','verified'].map(p=>`<option value="${p}" ${filterStatus===p?'selected':''}>${statusName(p)}</option>`).join('')}</select><span class="small muted">${items.length} shown</span></div>`+
      (items.length?`<div class="entry-grid">${items.map(e=>`<article class="entry-card"><div class="entry-top"><div class="entry-source"><span class="tag pink">${platformName(e.platform)}</span><strong>${escapeHTML(e.author||'Unknown account')}</strong><span class="tag">${roleName(e.role)}</span></div><span class="tag ${e.status==='verified'?'green':e.status==='captured'?'amber':''}">${statusName(e.status)}</span></div><p class="entry-excerpt">${escapeHTML(shortText(e.text||'(Screenshot-only record)',310))}</p><div class="entry-footer"><div class="entry-meta"><span>◷ ${dateDisplay(e.occurredAt)}</span><span>• ${visName(e.visibility)}</span><span>• ${e.shots?.length||0} screenshot${e.shots?.length===1?'':'s'}</span></div><button class="text-btn" data-action="detail" data-id="${escapeHTML(e.id)}">Review evidence →</button></div></article>`).join('')}</div>`:`<div class="empty"><div class="empty-icon">▤</div><h3>${getItems().length?'Nothing matches those filters':'Start your evidence log'}</h3><p>${getItems().length?'Clear the search or filters to see more records.':'Save public post URLs, direct messages you received, or authorized screenshots of private-group posts.'}</p><button class="btn btn-plain" data-action="${getItems().length?'clearFilters':'add'}">${getItems().length?'Clear filters':'Add evidence'}</button></div>`);
  }
  function renderSources() {
    const map = new Map();getItems().forEach(e=>{const key=(e.platform||'other')+'|'+(e.author||'Unknown account').toLowerCase();if(!map.has(key))map.set(key,{author:e.author||'Unknown account',platform:e.platform,total:0,roles:new Set(),url:''});const row=map.get(key);row.total++;row.roles.add(e.role||'unknown');if(!row.url&&safeURL(e.url))row.url=e.url;});
    const groups=Array.from(map.values()).sort((a,b)=>b.total-a.total);
    return header('Sources & account labels','Separate what a visible account posted from any claims about who operates it. Account roles are manual notes, not identity verification.')+
      `<div class="panel"><div class="panel-header"><div><h2>Observed source accounts</h2><p class="muted">Grouped from records in your ledger</p></div><span class="pill-muted">${groups.length} source${groups.length===1?'':'s'}</span></div>${groups.length?`<div style="overflow-x:auto"><table class="sources-table"><thead><tr><th>Displayed account</th><th>Platform</th><th>Records</th><th>Role labels</th><th>Source</th></tr></thead><tbody>${groups.map(g=>`<tr><td><strong>${escapeHTML(g.author)}</strong></td><td>${platformName(g.platform)}</td><td>${g.total}</td><td>${escapeHTML([...g.roles].map(roleName).join(', '))}</td><td>${safeURL(g.url)?`<a class="link" href="${escapeHTML(safeURL(g.url))}" target="_blank" rel="noopener noreferrer">View ↗</a>`:'—'}</td></tr>`).join('')}</tbody></table></div>`:`<div class="empty"><h3>No accounts recorded</h3><p>Accounts will appear here when you add relevant posts or comments.</p></div>`}</div><div class="notice" style="margin-top:17px"><strong>Official account ≠ board endorsement.</strong> Label an account as an official organization account only when it is clearly the organization's Page or verified official channel. An individual moderator's personal comment is not automatically an organizational statement.</div>`;
  }
  function renderReports() {
    const n=getItems().filter(e=>e.includeReport).length;
    return header('Reports & backups','Export a factual chronology, a spreadsheet summary, or an encrypted backup. Nothing is sent automatically.',false)+
      `<div class="grid reports-grid"><section class="report-option"><div class="report-icon">▧</div><h3>Printable evidence report</h3><p>Neutral timeline with screenshots, links, and review statuses. Includes ${n} manually selected record${n===1?'':'s'}. Save to PDF from the print dialog.</p><button class="btn btn-primary btn-sm" data-action="printReport" ${n?'':'disabled'}>Create report ↗</button></section>
      <section class="report-option"><div class="report-icon">▤</div><h3>Spreadsheet export</h3><p>Download CSV with dates, platforms, account labels, excerpts, URLs and screenshot file hashes. Image bytes are excluded.</p><button class="btn btn-plain btn-sm" data-action="exportCsv" ${getItems().length?'':'disabled'}>Download CSV ↓</button></section>
      <section class="report-option"><div class="report-icon">♧</div><h3>Encrypted backup</h3><p>Export the complete encrypted workspace—including screenshots—so you can restore it later or transfer to another device using the passphrase.</p><button class="btn btn-plain btn-sm" data-action="backup">Download encrypted backup ↓</button></section>
      <section class="report-option"><div class="report-icon">↶</div><h3>Restore a backup</h3><p>Restore your saved archive. This replaces the records on this device after explicit confirmation. You will need the backup's passphrase.</p><button class="btn btn-plain btn-sm" data-action="restore">Choose backup file</button><input id="restore-file" type="file" accept="application/json,.json" class="sr"></section></div>
      <div class="notice" style="margin-top:20px"><strong>Reports are factual documentation, not conclusions.</strong> Captured posts can establish visible words and timestamps, but cannot establish an account operator's identity, motivations, coordination, or a website visitor's identity. Keep reports confidential and share only with the appropriate person or organization.</div>`;
  }
  function renderImport() {
    return header('Public posts & Apify','Import public-account data to your private ledger. No scraping of private groups, membership bypass, or tracking website visitors.',false)+
      `<div class="grid two-col"><section class="panel"><div class="panel-header"><div><h2>Import an Apify export</h2><p class="muted">JSON or CSV exported from a public-post Actor dataset</p></div></div><div class="steps"><div class="step"><span class="step-num">1</span><div><strong>Run a public-only scraper in Apify</strong><p>Use a public Instagram account or Facebook Page. Do not submit a private Facebook group or use someone else's login cookies.</p></div></div><div class="step"><span class="step-num">2</span><div><strong>Export dataset as JSON or CSV</strong><p>The importer recognizes common fields such as URL, caption/text, author, and postedAt.</p></div></div><div class="step"><span class="step-num">3</span><div><strong>Review and add to your encrypted log</strong><p>Imported entries remain unverified until you inspect the original URL or screenshot.</p></div></div></div><div class="subtle-divider"></div><div class="field"><label for="dataset-file">Choose a JSON or CSV file</label><input type="file" accept=".json,.csv,application/json,text/csv" id="dataset-file" class="input" style="padding:9px" /><span class="help">Only public Facebook / Instagram items with an original post link are imported. Private-group URLs are excluded.</span></div><div id="import-preview"></div></section>
      <section class="panel"><div class="panel-header"><div><h2>Optional Netlify + Apify sync</h2><p class="muted">Read the latest successful public Actor task run</p></div></div><p class="small muted" style="line-height:1.7">If this site is Git-deployed to Netlify and configured with an Apify token, task ID, access key, and approved public-account handles, you can import from the last run without uploading a file. The token stays server-side.</p><div class="field" style="margin-top:21px"><label for="sync-secret">Workspace sync key</label><input class="input" type="password" id="sync-secret" autocomplete="off" placeholder="Access key set in Netlify" /><span class="help">Not your Apify API token. Never enter the Apify API token in this browser.</span></div><button class="btn btn-plain" data-action="syncPublic">↻ Fetch latest public dataset</button><div class="subtle-divider"></div><div class="callout"><strong>Scope and limitations</strong>Apify exports show what publicly visible accounts posted. They don't reveal anonymous visitors, hidden group posts, or whether people are coordinating behind the scenes.</div><p class="small muted" style="line-height:1.6;margin-top:16px">The optional server endpoint does not trigger a paid scraper run—it only reads results of the last completed task. Configure scheduling inside your own Apify account if needed.</p></section></div>`;
  }
  function showModal(html) { modalRoot.innerHTML=`<div class="modal-overlay" role="presentation"><section class="modal-box" role="dialog" aria-modal="true" aria-labelledby="modal-title">${html}</section></div>`; document.body.style.overflow='hidden'; const focus=modalRoot.querySelector('input:not([type=file]),textarea,button'); focus?.focus(); }
  function closeModal() { modalRoot.innerHTML='';document.body.style.overflow=''; pendingShots=[];editId=null; }
  function headingModal(title) {return `<div class="modal-head"><h2 id="modal-title">${escapeHTML(title)}</h2><button class="close" data-action="close" type="button" aria-label="Close dialog">×</button></div>`;}
  function openEntryForm(edit=null) {
    editId=edit?.id||null;pendingShots=[...(edit?.shots||[])];
    const e=edit||{platform:'instagram',kind:'public_post',visibility:'public',author:'',role:'unknown',url:'',text:'',notes:'',status:'unverified',occurredAt:new Date().toISOString(),includeReport:false};
    showModal(`${headingModal(edit?'Edit evidence':'Add a record')}<form id="entry-form"><div class="modal-body">
      <div class="two-inputs"><div class="field"><label for="date">Date and time shown on post</label><input class="input" id="date" type="datetime-local" value="${escapeHTML(e.occurredAt?getLocalDateTime(new Date(e.occurredAt)):'')}" /></div><div class="field"><label for="platform">Platform</label><select id="platform" class="select">${['instagram','facebook','other'].map(x=>`<option value="${x}" ${e.platform===x?'selected':''}>${platformName(x)}</option>`).join('')}</select></div></div>
      <div class="two-inputs"><div class="field"><label for="kind">What was shared?</label><select id="kind" class="select">${['public_post','public_comment','private_group','direct','other'].map(x=>`<option value="${x}" ${e.kind===x?'selected':''}>${kindName(x)}</option>`).join('')}</select></div><div class="field"><label for="visibility">Visibility</label><select id="visibility" class="select"><option value="public" ${e.visibility==='public'?'selected':''}>Publicly visible</option><option value="private" ${e.visibility==='private'?'selected':''}>Private / received legitimately</option></select></div></div>
      <div class="two-inputs"><div class="field"><label for="author">Display name or public handle</label><input class="input" id="author" maxlength="200" value="${escapeHTML(e.author)}" placeholder="Exactly as shown on the post" /></div><div class="field"><label for="role">Account type (manually observed)</label><select class="select" id="role">${['unknown','personal','business','official'].map(x=>`<option value="${x}" ${e.role===x?'selected':''}>${roleName(x)}</option>`).join('')}</select><span class="help">Use Official only for the organization's own account—not a member or moderator posting personally.</span></div></div>
      <div class="field"><label for="url">Source URL (if accessible)</label><input class="input" id="url" type="url" maxlength="2000" value="${escapeHTML(e.url)}" placeholder="https://www.instagram.com/p/…" /><span class="help">Do not enter tracking links or private login credentials.</span></div>
      <div class="field"><label for="text">Exact post or comment excerpt</label><textarea class="textarea" id="text" maxlength="10000" placeholder="Paste the visible wording verbatim. Quoting accurately matters.">${escapeHTML(e.text)}</textarea></div>
      <div class="field"><label for="notes">Context / your notes (separate from the quote)</label><textarea class="textarea" id="notes" maxlength="10000" placeholder="Your observations, relevant context, or what still needs verification.">${escapeHTML(e.notes)}</textarea></div>
      <div class="two-inputs"><div class="field"><label for="status">Evidence status</label><select class="select" id="status">${['unverified','captured','verified'].map(x=>`<option value="${x}" ${e.status===x?'selected':''}>${statusName(x)}</option>`).join('')}</select><span class="help">Source checked means you verified the visible post—not the account owner's identity.</span></div><div class="field"><label>Screenshots</label><input class="input" type="file" id="screenshots" accept="image/png,image/jpeg,image/webp" multiple style="padding:9px"/><span class="help">Up to 5 images, 7 MB each. Original file hashes are recorded. Keep identifying details about children out of exported reports.</span></div></div>
      <div id="shot-preview">${renderShotPreview()}</div><div class="subtle-divider"></div><label class="checkbox-line"><input type="checkbox" id="include-report" ${e.includeReport?'checked':''} />Include this record in a confidential exported report</label>
      <p class="small muted" style="line-height:1.6;margin-top:10px">Private-group screenshots should only be shared with appropriate authorized recipients. Entries are not automatically included in reports.</p>
    </div><div class="modal-foot"><button type="button" class="btn btn-plain" data-action="close">Cancel</button><button type="submit" class="btn btn-primary">${edit?'Save changes':'Save evidence'}</button></div></form>`);
  }
  function renderShotPreview() {
    if (!pendingShots.length) return '<p class="small muted" style="margin:0 0 16px">No screenshots attached.</p>';
    return `<div class="preview-images" style="margin-bottom:16px">${pendingShots.map((s,i)=>`<div class="img-item"><img class="thumb" src="${escapeHTML(s.data)}" alt="Evidence screenshot ${i+1}"><small>${escapeHTML(shortText(s.name,23))}</small><button class="text-btn" type="button" data-action="removeShot" data-index="${i}">Remove</button></div>`).join('')}</div>`;
  }
  function updateShotPreview(){const node=document.getElementById('shot-preview');if(node) node.innerHTML=renderShotPreview();}
  async function fileToEvidence(file) {
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Use PNG, JPEG, or WebP screenshots.');
    if(file.size>7*1024*1024) throw new Error('Each screenshot must be 7 MB or less.');
    const arr=await file.arrayBuffer();
    const hash=bytesToHex(await crypto.subtle.digest('SHA-256',arr));
    const data='data:'+file.type+';base64,'+base64(new Uint8Array(arr));
    return {name:file.name,size:file.size,mime:file.type,hash,data,uploadedAt:new Date().toISOString()};
  }
  async function handleShotsUpload(input){
    try{
      const files=Array.from(input.files||[]);
      if(pendingShots.length+files.length>5)throw new Error('Maximum five screenshots per record.');
      for(const f of files)pendingShots.push(await fileToEvidence(f));
      updateShotPreview();showToast(files.length+' screenshot(s) attached and hashed');
    }catch(err){showToast(err.message);}finally{input.value='';}
  }
  async function handleEntrySubmit(form) {
    const v=name=>form.querySelector('#'+name)?.value?.trim()||'';
    const url=v('url');if(url&&!safeURL(url)){showToast('Please enter a valid HTTP(S) source URL.');return;}
    const text=v('text');if(!text&&!url&&!pendingShots.length){showToast('Add a post URL, excerpt, or screenshot before saving.');return;}
    const kind=v('kind');const visibility=(kind==='private_group'||kind==='direct')?'private':v('visibility');
    const occurredAt = v('date') ? asDate(new Date(v('date')).toISOString()) : '';
    const old=editId?getItems().find(x=>x.id===editId):null;
    const entry={
      id:old?.id||id(), platform:v('platform'),kind,visibility,occurredAt,
      author:v('author').slice(0,200),role:v('role'),url:safeURL(url),text,notes:v('notes'),
      status:v('status'),shots:[...pendingShots],includeReport:!!form.querySelector('#include-report').checked,
      capturedAt:old?.capturedAt||new Date().toISOString(),updatedAt:new Date().toISOString(),importedFrom:old?.importedFrom||'manual'
    };
    if(kind==='private_group' && entry.url && /facebook\.com\/groups\//i.test(entry.url)) {entry.visibility='private';}
    closeModal();await mutate(s=>{if(old){const ix=s.items.findIndex(x=>x.id===old.id);s.items[ix]=entry;}else s.items.push(entry);},old?'Record updated':'Evidence saved securely');
  }
  function openDetails(entryId) {
    const e=getItems().find(x=>x.id===entryId);if(!e) return showToast('Record not found.');
    showModal(`${headingModal('Review evidence')}<div class="modal-body">
      <div class="info-row"><span class="tag pink">${platformName(e.platform)}</span><span class="tag ${e.status==='verified'?'green':''}">${statusName(e.status)}</span><span class="tag">${visName(e.visibility)}</span></div>
      <div class="detail-grid"><dt>Display name</dt><dd><strong>${escapeHTML(e.author||'Not recorded')}</strong></dd><dt>Account label</dt><dd>${roleName(e.role)}</dd><dt>Content type</dt><dd>${kindName(e.kind)}</dd><dt>Post date</dt><dd>${dateDisplay(e.occurredAt)}</dd><dt>Saved locally</dt><dd>${dateDisplay(e.capturedAt)}</dd><dt>Source</dt><dd>${safeURL(e.url)?`<a href="${escapeHTML(safeURL(e.url))}" target="_blank" rel="noopener noreferrer" class="link">${escapeHTML(e.url)} ↗</a>`:'No source URL'}</dd><dt>Report inclusion</dt><dd>${e.includeReport?'Selected for confidential report':'Not included'}</dd><dt>Collection</dt><dd>${escapeHTML(e.importedFrom||'manual')}</dd></div>
      <h3 style="margin-bottom:10px">Quoted content</h3><div class="detail-quote">${escapeHTML(e.text||'(No quote; see screenshot or source URL)')}</div>
      <h3 style="margin:22px 0 10px">Separate notes</h3><p style="line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere">${escapeHTML(e.notes||'No notes entered.')}</p>
      <h3 style="margin:24px 0 12px">Original screenshots (${e.shots?.length||0})</h3>
      ${e.shots?.length?`<div class="preview-images">${e.shots.map((s,i)=>`<div class="img-item"><button data-action="downloadShot" data-id="${escapeHTML(e.id)}" data-index="${i}" style="border:0;padding:0;background:transparent;text-align:left"><img class="thumb" src="${escapeHTML(s.data)}" alt="Evidence screenshot ${i+1}"></button><small>${escapeHTML(shortText(s.name,25))}</small><small style="font-size:9px;word-break:break-all" title="SHA-256 ${escapeHTML(s.hash)}">SHA-256: ${escapeHTML(s.hash.slice(0,16))}…</small><button class="text-btn" data-action="downloadShot" data-id="${escapeHTML(e.id)}" data-index="${i}">Download original</button></div>`).join('')}</div>`:'<p class="small muted">No screenshots stored with this record.</p>'}
      <div class="notice" style="margin-top:22px">Evidence status describes how well the visible content was documented. It does not prove an account owner's identity or intent.</div>
    </div><div class="modal-foot" style="justify-content:space-between"><button class="btn btn-danger btn-sm" data-action="delete" data-id="${escapeHTML(e.id)}">Delete record</button><div style="display:flex;gap:8px"><button class="btn btn-plain" data-action="close">Close</button><button class="btn btn-primary" data-action="edit" data-id="${escapeHTML(e.id)}">Edit record</button></div></div>`);
  }
  function downloadShot(entryId,index) {const e=getItems().find(x=>x.id===entryId);const shot=e?.shots?.[index];if(!shot)return;const m=shot.data.match(/^data:([^;]+);base64,(.*)$/);if(!m)return;downloadBlob(new Blob([fromBase64(m[2])],{type:m[1]}),shot.name||'screenshot.png');}
  function csvCell(v) {let text=String(v ?? '').replace(/\r/g,'');if(/^[\s]*[=+\-@]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}
  function exportCsv(){const columns=['Post time','Captured locally','Platform','Type','Visibility','Displayed account','Account label','Status','Source URL','Exact excerpt','Notes','Screenshot count','Screenshot SHA-256','Confidential report'];const rows=[columns,...sortItems(getItems()).map(e=>[e.occurredAt,e.capturedAt,platformName(e.platform),kindName(e.kind),visName(e.visibility),e.author,roleName(e.role),statusName(e.status),e.url,e.text,e.notes,(e.shots||[]).length,(e.shots||[]).map(s=>s.hash).join(' | '),e.includeReport?'Yes':'No'])];downloadBlob(new Blob([rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),`tutu-community-ledger-${prettyDay()}.csv`);showToast('CSV downloaded (no screenshot images included)');}
  async function exportBackup(){try{await queuedSave;const raw=await dbRead();downloadBlob(new Blob([JSON.stringify(raw,null,2)],{type:'application/json'}),`tutu-ledger-encrypted-backup-${prettyDay()}.json`);showToast('Encrypted backup downloaded. Save it somewhere secure.');}catch(e){showToast('Backup failed: '+e.message);}}
  async function restoreBackup(file) {
    if(!file)return;
    try{
      const candidate=JSON.parse(await file.text());
      if(candidate.format!=='tutu-vault-v1'||!candidate.salt||!candidate.iv||!candidate.data)throw new Error('Not a supported encrypted workspace backup.');
      if(!window.confirm('This will REPLACE all records stored on this device. Continue?'))return;
      const pass=window.prompt('Enter the passphrase for the backup you are restoring:');if(pass===null)return;
      const key=await derive(pass,candidate.salt);const loaded=await decryptVault(candidate,key);
      await queuedSave;await dbWrite(candidate);
      cryptKey=key;vaultSalt=candidate.salt;state=loaded;filterText='';activeTab='overview';render();showToast('Encrypted backup restored');
    }catch(e){showToast('Restore failed. Check passphrase and file. '+e.message);}
  }
  function createPrintReport(){
    const items=sortItems(getItems().filter(e=>e.includeReport));if(!items.length)return;
    const css=`@page{size:letter;margin:18mm}body{font:12px Arial,sans-serif;color:#30262e;line-height:1.55}h1,h2{font-family:Georgia,serif;font-weight:500}h1{font-size:27px;margin-bottom:4px}h2{font-size:17px;margin:0 0 9px}p{margin:8px 0}.muted{color:#70656d}.record{page-break-inside:avoid;border-top:1px solid #ddd;padding:17px 0}.meta{font-size:10px;color:#736771;margin-bottom:11px}.quote{background:#f8f1f5;border-left:3px solid #a75576;padding:10px;white-space:pre-wrap;overflow-wrap:anywhere}.shot{max-width:44%;max-height:280px;object-fit:contain;margin:9px 9px 9px 0;border:1px solid #ccc}.url{overflow-wrap:anywhere}.note{background:#fcfafb;border:1px solid #e8e0e5;padding:13px}.small{font-size:10px}.footer{margin-top:25px;font-size:9px;color:#777}`;
    const records=items.map((e,i)=>`<section class="record"><h2>Record ${i+1}: ${escapeHTML(e.author||'Unknown account')} — ${platformName(e.platform)}</h2><div class="meta">Posted: ${dateDisplay(e.occurredAt)} · Captured: ${dateDisplay(e.capturedAt)} · ${kindName(e.kind)} · ${visName(e.visibility)} · ${roleName(e.role)} · ${statusName(e.status)}</div><p><strong>Source:</strong> <span class="url">${escapeHTML(e.url||'Not supplied')}</span></p><div class="quote">${escapeHTML(e.text||'(No quoted text supplied)')}</div>${e.notes?`<p><strong>Context / notes (not a quote):</strong> ${escapeHTML(e.notes)}</p>`:''}${(e.shots||[]).length?`<div>${e.shots.map(s=>`<figure style="display:inline-block;vertical-align:top;margin:6px 3px 8px 0;max-width:45%"><img class="shot" style="max-width:100%" src="${escapeHTML(s.data)}"><figcaption class="small">${escapeHTML(s.name)}<br>SHA-256: ${escapeHTML(s.hash)}</figcaption></figure>`).join('')}</div>`:''}</section>`).join('');
    const w=window.open('','_blank','width=920,height=760');
    if(w) w.opener=null;
    if(!w){showToast('Allow popups for this site to open the printable report.');return;}
    w.document.open();w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Tutu Tumble evidence report</title><style>${css}</style></head><body><div style="font-size:10px;letter-spacing:2px;color:#9e5476">TUTU TUMBLE · INTERNAL DOCUMENTATION</div><h1>Community communications: factual record</h1><p class="muted">Generated ${new Date().toLocaleString()} · ${items.length} selected record(s) · Confidential</p><div class="note"><strong>Scope and limitations:</strong> This report preserves selected account-visible material and manual notes. It does not establish an account operator's real identity, an individual's motive, coordinated activity, or who visited a website. Account labels and verification statuses are manually entered and should be checked against original sources. Private-group material should only be shared with appropriate authorized recipients.</div>${records}<div class="footer">Generated from a private, local-only encrypted evidence log. No external verification or investigation is implied.</div></body></html>`);w.document.close();showToast('Report opened. Use Print → Save as PDF.');
  }
  // CSV parser with quoted cells and embedded commas/newlines (no external libraries).
  function parseCSV(input){
    const text=input.replace(/^\uFEFF/,''); const rows=[];let row=[],cell='',inside=false;
    for(let i=0;i<text.length;i++){
      const c=text[i];if(c==='"'){if(inside && text[i+1]==='"'){cell+='"';i++;}else inside=!inside;}
      else if(c===','&&!inside){row.push(cell);cell='';}
      else if((c==='\n'||c==='\r')&&!inside){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}
      else cell+=c;
    }
    if(inside)throw new Error('CSV has an unclosed quotation mark.');row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
    if(rows.length<2)return[];const headers=rows.shift().map(x=>x.trim());return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]||''])));
  }
  function firstVal(obj,keys){for(const k of keys){let v=k.split('.').reduce((p,s)=>p&&p[s],obj);if(v && typeof v==='object' && !Array.isArray(v))v=v.name||v.username||v.userName||v.fullName||v.id||'';if(v!==null&&v!==undefined&&String(v).trim())return String(v).trim();}return '';}
  function sourceIsPublic(url){
    const link=safeURL(url);if(!link)return false;
    const u=new URL(link);const host=u.hostname.toLowerCase().replace(/^www\./,'');
    if(!['instagram.com','facebook.com','m.facebook.com','web.facebook.com','fb.watch'].includes(host))return false;
    if((host.endsWith('facebook.com'))&&(/^\/groups\//i.test(u.pathname)||/\/private\//i.test(u.pathname)))return false;
    return true;
  }
  function parseImportedItems(raw){
    const arr=Array.isArray(raw)?raw:Array.isArray(raw?.items)?raw.items:Array.isArray(raw?.data)?raw.data:Array.isArray(raw?.data?.items)?raw.data.items:[];
    const output=[];let skipped=0;
    for(const obj of arr){
      if(!obj||typeof obj!=='object'){skipped++;continue;}
      const url=firstVal(obj,['postUrl','postURL','post_url','postLink','url','link','permalink','shortCodeUrl','facebookUrl','instagramUrl','inputUrl']);
      if(!sourceIsPublic(url)){skipped++;continue;}
      const author=firstVal(obj,['author.username','author.userName','author.name','owner.username','owner.name','user.username','username','userName','authorName','profileName','pageName','accountName','author','owner','name']);
      const text=firstVal(obj,['caption','text','message','postText','post_text','content','description','body','commentText','title']);
      const occured=firstVal(obj,['timestamp','createdAt','created_at','postedAt','publishedAt','date','time','takenAt','publishDate']);
      let occurredAt='';
      if(occured){const numeric=Number(occured);if(/^\d{10,13}$/.test(occured))occurredAt=asDate(new Date(numeric*(occured.length===10?1000:1)));else occurredAt=asDate(occured);}
      if(!text&&!author){skipped++;continue;}
      const platform=/instagram\.com/i.test(url)?'instagram':'facebook';
      output.push({id:id(),platform,kind:'public_post',visibility:'public',author:author.slice(0,200),role:'unknown',url:safeURL(url),text:text.slice(0,10000),notes:'Imported from a public Apify dataset. Check the original post URL before marking source checked.',status:'unverified',occurredAt,capturedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),includeReport:false,shots:[],importedFrom:'Apify/public dataset'});
    }
    return {items:output,skipped,total:arr.length};
  }
  function dedupeImported(preview) {
    const seen=new Set(getItems().map(e=>(e.url||'').split(/[?#]/)[0]+'|'+(e.author||'').toLowerCase()+'|'+(e.text||'').slice(0,90)));
    const unique=[];
    for(const e of preview){const key=(e.url||'').split(/[?#]/)[0]+'|'+(e.author||'').toLowerCase()+'|'+(e.text||'').slice(0,90);if(seen.has(key))continue;seen.add(key);unique.push(e);}return unique;
  }
  function showImportPreview(parsed){
    importedPreview=dedupeImported(parsed.items);
    const box=document.getElementById('import-preview');if(!box)return;
    box.innerHTML=`<div class="notice"><strong>${parsed.items.length} eligible public items</strong> · ${importedPreview.length} new after deduplication · ${parsed.skipped} excluded (private group links, missing URL, or unsupported fields).<p style="margin:8px 0 0">All imports start Unverified. <strong>No private-group data is automatically collected.</strong></p></div>${importedPreview.length?`<div style="margin:16px 0;display:grid;gap:10px;max-height:200px;overflow:auto">${importedPreview.slice(0,7).map(e=>`<div class="small" style="border-bottom:1px solid var(--line);padding-bottom:8px"><strong>${escapeHTML(e.author||'Unknown')} · ${platformName(e.platform)}</strong><div class="muted">${escapeHTML(shortText(e.text,125))}</div></div>`).join('')}</div><button class="btn btn-primary" data-action="confirmImport">Import ${importedPreview.length} records securely</button>`:''}`;
  }
  async function handleDatasetFile(file){
    if(!file)return;
    try{
      if(file.size>12*1024*1024)throw new Error('Maximum file size is 12 MB. Export smaller batches from Apify.');
      const str=await file.text();const json=file.name.toLowerCase().endsWith('.json');const parsed=json?JSON.parse(str):parseCSV(str);
      showImportPreview(parseImportedItems(parsed));
    }catch(e){showToast('Could not parse the export: '+e.message);}
  }
  async function syncPublic(){
    const secret=document.getElementById('sync-secret')?.value||'';
    if(!secret)return showToast('Enter the Netlify access key for the optional server endpoint.');
    const btn=document.querySelector('[data-action="syncPublic"]');if(btn){btn.disabled=true;btn.textContent='Fetching…';}
    try{
      const response=await fetch('/.netlify/functions/pull-public',{headers:{'x-monitor-key':secret,'Accept':'application/json'},cache:'no-store'});
      const data=await response.json().catch(()=>({error:'The Netlify function was not found. Deploy this project from Git with functions enabled.'}));
      if(!response.ok)throw new Error(data.error||'Server returned '+response.status);
      const parsed=parseImportedItems(data.items||[]);
      if(!parsed.items.length)return showToast('No eligible public items found in the latest task run.');
      // No API token or sync key is saved in the browser, only imported public entries.
      const unique=dedupeImported(parsed.items);
      await mutate(s=>{s.items.push(...unique);},`${unique.length} new public observations imported (unverified)`);
    }catch(e){showToast('Sync not available: '+e.message);}finally{if(btn){btn.disabled=false;btn.textContent='↻ Fetch latest public dataset';}}
  }
  async function confirmImport(){
    if(!importedPreview.length) return;
    const entries=importedPreview;importedPreview=[];
    await mutate(s=>{s.items.push(...entries);},`${entries.length} public record(s) imported securely`);
    activeTab='evidence';render();
  }
  function lock(){cryptKey=null;state=null;vaultSalt=null;importedPreview=[];pendingShots=[];queuedSave=Promise.resolve();closeModal();initialize();}
  document.addEventListener('submit', async event => {
    if(event.target.id==='vault-form'){event.preventDefault();await handleVaultSubmit(event.target);}
    if(event.target.id==='entry-form'){event.preventDefault();await handleEntrySubmit(event.target);}
  });
  document.addEventListener('change', async event => {
    if(event.target.id==='screenshots')await handleShotsUpload(event.target);
    if(event.target.id==='dataset-file')await handleDatasetFile(event.target.files?.[0]);
    if(event.target.id==='restore-file'){await restoreBackup(event.target.files?.[0]);event.target.value='';}
    if(event.target.id==='filter-platform'){filterPlatform=event.target.value;render();}
    if(event.target.id==='filter-status'){filterStatus=event.target.value;render();}
    if(event.target.id==='kind' && event.target.value==='private_group'){document.getElementById('visibility').value='private';}
  });
  let searchTimer;
  document.addEventListener('input',event=>{
    if(event.target.id==='filter-search'){
      const value=event.target.value;
      clearTimeout(searchTimer);
      searchTimer=setTimeout(()=>{const focused=document.activeElement?.id==='filter-search';const cursor=focused?document.activeElement.selectionStart:0;filterText=value;render();if(focused){const input=document.getElementById('filter-search');input?.focus();input?.setSelectionRange(cursor,cursor);}},220);
    }
  });
  document.addEventListener('click',async event=>{
    if(event.target.classList.contains('modal-overlay')){closeModal();return;}
    const button=event.target.closest('[data-action]');if(!button)return;
    const action=button.dataset.action;const entryId=button.dataset.id;const i=Number(button.dataset.index);
    switch(action){
      case 'tab':activeTab=button.dataset.tab;render();break;
      case 'add':openEntryForm();break;
      case 'close':closeModal();break;
      case 'lock':await queuedSave;lock();break;
      case 'detail':openDetails(entryId);break;
      case 'edit':openEntryForm(getItems().find(e=>e.id===entryId));break;
      case 'removeShot':pendingShots.splice(i,1);updateShotPreview();break;
      case 'delete':if(window.confirm('Permanently remove this record and its screenshots from this device?')){closeModal();await mutate(s=>{s.items=s.items.filter(x=>x.id!==entryId)},'Record deleted');}break;
      case 'clearFilters':filterText='';filterStatus='all';filterPlatform='all';render();break;
      case 'downloadShot':downloadShot(entryId,i);break;
      case 'exportCsv':exportCsv();break;
      case 'backup':await exportBackup();break;
      case 'restore':document.getElementById('restore-file')?.click();break;
      case 'printReport':createPrintReport();break;
      case 'confirmImport':await confirmImport();break;
      case 'syncPublic':await syncPublic();break;
    }
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&modalRoot.innerHTML)closeModal();});
  initialize();
})();
