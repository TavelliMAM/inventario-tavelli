/* Inventario Diario Tavelli — lógica compartida entre index.html (conteo) y reporte.html (supervisor).
   No depende de Claude: guarda y lee los datos desde el backend de Google Apps Script
   configurado en config.js (window.TAVELLI_CONFIG.APPS_SCRIPT_URL). */

const AREAS = ['Cocina','Cafeteria','Pasteleria','Gelateria','Garzones'];
const AREA_LABELS = {Cocina:'Cocina', Cafeteria:'Cafetería', Pasteleria:'Pastelería', Gelateria:'Gelatería', Garzones:'Garzones'};
const AREA_ICONS = {
  Cocina: '<path d="M4 3v6a2 2 0 0 0 2 2h1v10M9 3v8M6 3v6M14 3c-2 3-2 6 0 9v9" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  Cafeteria: '<path d="M4 8h13a3 3 0 0 1 0 6h-1M4 8v7a4 4 0 0 0 4 4h5a4 4 0 0 0 4-4v-1M4 8l1-4h6l1 4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  Pasteleria: '<path d="M4 11a8 8 0 0 1 16 0M3 11h18M5 11v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  Gelateria: '<path d="M12 2l5 6H7z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M8 8l3 13a1 1 0 0 0 2 0l3-13" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  Garzones: '<circle cx="12" cy="7" r="3" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M6 21v-3a6 6 0 0 1 12 0v3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
};

const API_URL = (window.TAVELLI_CONFIG && window.TAVELLI_CONFIG.APPS_SCRIPT_URL) || '';

let PRODUCTS = [];
let PRODUCTS_BY_AREA = {};

function todayStr(offsetDays){
  const d = new Date();
  d.setDate(d.getDate() + (offsetDays||0));
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}
function shiftDate(dateStr, offset){
  const [y,m,d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  dt.setDate(dt.getDate()+offset);
  const yy=dt.getFullYear(), mm=String(dt.getMonth()+1).padStart(2,'0'), dd=String(dt.getDate()).padStart(2,'0');
  return `${yy}-${mm}-${dd}`;
}
function humanDate(str){
  const [y,m,d] = str.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  return dt.toLocaleDateString('es-CL', {weekday:'short', day:'numeric', month:'short'});
}
function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtNum(n){ return Number(n).toLocaleString('es-CL', {maximumFractionDigits:2}); }

async function loadProducts(){
  if(PRODUCTS.length) return PRODUCTS;
  PRODUCTS = await fetch('products.json').then(r=>r.json());
  PRODUCTS_BY_AREA = {};
  for(const area of AREAS) PRODUCTS_BY_AREA[area] = PRODUCTS.filter(p => area in (p.areas||{}));
  return PRODUCTS;
}

function apiConfigured(){ return !!API_URL && API_URL.indexOf('http') === 0; }

async function apiGetDay(date){
  if(!apiConfigured()) return {areas:{}};
  const res = await fetch(`${API_URL}?action=getDay&date=${encodeURIComponent(date)}`);
  return res.json();
}
async function apiGetReference(date){
  if(!apiConfigured()) return {values:null};
  const res = await fetch(`${API_URL}?action=getReference&date=${encodeURIComponent(date)}`);
  return res.json();
}
async function apiSaveCount(payload){
  if(!apiConfigured()) throw new Error('sin backend');
  const res = await fetch(API_URL, {
    method:'POST',
    headers:{'Content-Type':'text/plain;charset=utf-8'},
    body: JSON.stringify({action:'saveCount', ...payload})
  });
  return res.json();
}
async function apiSaveReference(payload){
  if(!apiConfigured()) throw new Error('sin backend');
  const res = await fetch(API_URL, {
    method:'POST',
    headers:{'Content-Type':'text/plain;charset=utf-8'},
    body: JSON.stringify({action:'saveReference', ...payload})
  });
  return res.json();
}

// aggregate quantity for a product across the areas that own it, from a day's {area: doc|null} map
function aggregate(dayData, product){
  const own = Object.keys(product.areas||{});
  let total = 0, anyEntry = false, obsList = [];
  let notSubmittedCount = 0, skippedNaCount = 0, skippedCount = 0;
  for(const area of own){
    const doc = dayData ? dayData[area] : null;
    const na = !!product.areas[area];
    if(!doc){ notSubmittedCount++; continue; }
    const entry = doc.items && doc.items[product.codigo];
    if(entry && entry.cantidad !== '' && entry.cantidad !== undefined && entry.cantidad !== null){
      anyEntry = true;
      total += Number(entry.cantidad) || 0;
      if(entry.obs) obsList.push(entry.obs);
    } else if(na){
      skippedNaCount++;
    } else {
      skippedCount++;
    }
  }
  const hasDoc = notSubmittedCount < own.length;
  let status = 'pending';
  if(!anyEntry){
    if(notSubmittedCount === own.length) status = 'pending';
    else if(skippedNaCount > 0 && skippedCount === 0 && notSubmittedCount === 0) status = 'na';
    else if(notSubmittedCount === 0) status = 'missing';
    else status = 'pending';
  }
  return {total, anyEntry, obs: obsList.join(' / '), hasDoc, status};
}

function toast(msg, isErr){
  let root = document.getElementById('toast-root');
  if(!root){ root = document.createElement('div'); root.id='toast-root'; document.body.appendChild(root); }
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(()=>{ el.style.transition='opacity .3s'; el.style.opacity='0'; setTimeout(()=>el.remove(),300); }, 2600);
}

function showConfirm(message, okLabel, cancelLabel){
  return new Promise(resolve=>{
    let root = document.getElementById('modal-root');
    if(!root){ root = document.createElement('div'); root.id='modal-root'; document.body.appendChild(root); }
    root.innerHTML = `
      <div class="modal-back">
        <div class="modal-box">
          <p>${esc(message)}</p>
          <div class="modal-actions">
            <button class="ghost-btn" id="modal-cancel">${esc(cancelLabel||'Cancelar')}</button>
            <button class="primary-btn" id="modal-ok">${esc(okLabel||'Confirmar')}</button>
          </div>
        </div>
      </div>`;
    root.querySelector('#modal-cancel').onclick = ()=>{ root.innerHTML=''; resolve(false); };
    root.querySelector('#modal-ok').onclick = ()=>{ root.innerHTML=''; resolve(true); };
  });
}

function downloadBlob(filename, blob){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}

if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}
