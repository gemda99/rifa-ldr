'use strict';
/* =====================================================================
   PANEL DE CONTROL · RIFA PRO-FONDOS · LIGA DEL ROCK ACADEMY
   - Funciona solo en este navegador (modo local) o conectado a tu
     planilla de Google mediante Apps Script (tiempo real).
   - Los datos nunca se insertan como HTML: todo se muestra con textContent.
   ===================================================================== */

const TOTAL = 101;                                   // números del 00 al 100
const DEFAULTS = { precio: 3000, refrescoSeg: 10, url: '', token: '' };
const ESTADOS = ['Disponible', 'Reservado / Pendiente', 'Pagado'];
const METODOS = ['Transferencia', 'Efectivo', 'MercadoPago/Webpay'];
const CLAVE_ESTADO = 'rifa_control_estado_v1';
const CLAVE_AJUSTES = 'rifa_control_ajustes_v1';
const CLASE = { 'Pagado': 'pagado', 'Reservado / Pendiente': 'reservado', 'Disponible': 'disponible' };

/*PURE-START*/
function ticketVacio(n) {
  return { n: n, nombre: '', telefono: '', instagram: '', estado: 'Disponible', metodo: '', comprobante: '', vendedor: '', fecha: '', obs: '' };
}
function estadoInicial() {
  const tickets = [];
  for (let i = 0; i < TOTAL; i++) tickets.push(ticketVacio(String(i).padStart(2, '0')));
  return { tickets: tickets, gastos: [] };
}
function texto(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max || 200);
}
function normalizarFecha(f) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f || ''));
  return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
}
function normalizarTicket(t, n) {
  const e = t && ESTADOS.indexOf(t.estado) >= 0 ? t.estado : 'Disponible';
  if (e === 'Disponible') return ticketVacio(n);
  return {
    n: n, nombre: texto(t.nombre, 120), telefono: texto(t.telefono, 30),
    instagram: texto(t.instagram, 60).replace(/^0$/, ''), estado: e,
    metodo: METODOS.indexOf(t.metodo) >= 0 ? t.metodo : '', comprobante: texto(t.comprobante, 120),
    vendedor: texto(t.vendedor, 60), fecha: normalizarFecha(t.fecha), obs: texto(t.obs, 300)
  };
}
function normalizarGasto(g, i) {
  return {
    id: 'g' + i + '_' + Math.random().toString(36).slice(2, 7), fecha: normalizarFecha(g && g.fecha),
    concepto: texto(g && g.concepto, 120), monto: Math.max(0, Math.round(Number(g && g.monto) || 0)),
    comprobante: texto(g && g.comprobante, 120), aprobado: texto(g && g.aprobado, 60)
  };
}
// Acepta datos externos (nube o respaldo) y devuelve un estado válido con exactamente 101 números
function normalizarEstado(d) {
  const base = estadoInicial();
  const src = {};
  ((d && d.tickets) || []).forEach(function (t) {
    const n = texto(t && t.n, 3).padStart(2, '0');
    src[n] = t;
  });
  base.tickets = base.tickets.map(function (v) { return src[v.n] ? normalizarTicket(src[v.n], v.n) : v; });
  base.gastos = ((d && d.gastos) || []).slice(0, 100).map(normalizarGasto).filter(function (g) { return g.concepto || g.monto; });
  return base;
}
function calcular(est, precio) {
  const c = { pag: 0, res: 0, disp: 0 };
  est.tickets.forEach(function (t) {
    if (t.estado === 'Pagado') c.pag++; else if (t.estado === 'Reservado / Pendiente') c.res++; else c.disp++;
  });
  const gastos = est.gastos.reduce(function (a, g) { return a + (Number(g.monto) || 0); }, 0);
  const recaudado = c.pag * precio, pendiente = c.res * precio, meta = est.tickets.length * precio;
  return { pag: c.pag, res: c.res, disp: c.disp, vendidos: c.pag + c.res, recaudado: recaudado, pendiente: pendiente,
           gastos: gastos, neto: recaudado - gastos, meta: meta, avance: meta ? recaudado / meta : 0 };
}
function resumenPorMetodo(est, precio) {
  const filas = METODOS.map(function (m) { return { metodo: m, n: 0 }; });
  const sin = { metodo: 'Sin método registrado', n: 0 };
  est.tickets.forEach(function (t) {
    if (t.estado !== 'Pagado') return;
    const f = filas.filter(function (x) { return x.metodo === t.metodo; })[0];
    if (f) f.n++; else sin.n++;
  });
  return filas.concat([sin]).map(function (f) { return { metodo: f.metodo, n: f.n, monto: f.n * precio }; });
}
function resumenPorVendedor(est, precio) {
  const mapa = {};
  est.tickets.forEach(function (t) {
    if (t.estado === 'Disponible') return;
    const k = t.vendedor || '(sin vendedor)';
    mapa[k] = mapa[k] || { vendedor: k, pag: 0, res: 0 };
    if (t.estado === 'Pagado') mapa[k].pag++; else mapa[k].res++;
  });
  return Object.keys(mapa).map(function (k) { return { vendedor: k, pag: mapa[k].pag, res: mapa[k].res, monto: mapa[k].pag * precio }; })
    .sort(function (a, b) { return b.pag - a.pag || b.res - a.res || a.vendedor.localeCompare(b.vendedor); });
}
// Número de WhatsApp en formato internacional (Chile por defecto)
function telefonoWA(tel) {
  const d = String(tel || '').replace(/\D/g, '');
  if (d.length < 8) return '';
  if (d.indexOf('56') === 0 && d.length >= 11) return d;
  if (d.length === 9 && d[0] === '9') return '56' + d;
  if (d.length === 8) return '569' + d;
  return d;
}
function fechaCorta(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
}
function hoyISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function csvCelda(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;                 // evita que Excel/Sheets lo interprete como fórmula
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function ticketsACSV(est) {
  const filas = [['N° Ticket', 'Comprador / Nombre', 'Contacto / Teléfono (WhatsApp)', 'Instagram / Red Social', 'Estado del Pago',
    'Método de Pago', 'Comprobante / N° Transacción', 'Vendedor / Referido', 'Fecha de Compra', 'Observaciones']];
  est.tickets.forEach(function (t) {
    filas.push([t.n, t.nombre, t.telefono, t.instagram, t.estado, t.metodo, t.comprobante, t.vendedor, fechaCorta(t.fecha), t.obs]);
  });
  return filas.map(function (f) { return f.map(csvCelda).join(','); }).join('\r\n');
}
function gastosACSV(est) {
  const filas = [['Fecha', 'Concepto / Detalle', 'Monto ($)', 'Comprobante / Foto', 'Aprobado por']];
  est.gastos.forEach(function (g) { filas.push([fechaCorta(g.fecha), g.concepto, g.monto, g.comprobante, g.aprobado]); });
  return filas.map(function (f) { return f.map(csvCelda).join(','); }).join('\r\n');
}
/*PURE-END*/

/* ================= Estado de la aplicación ================= */
let ajustes = cargarAjustes();
let estado = cargarEstado();
let ui = { vista: 'tablero', filtro: 'todos', q: '' };
const sync = { pendientes: 0, cola: Promise.resolve(), ultimo: null, error: '', fallida: null, cargando: false, firma: '' };
let timer = null;

const $ = function (s, r) { return (r || document).querySelector(s); };
const $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
const clp = function (n) { return (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('es-CL'); };

function el(tag, attrs) {
  const e = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach(function (k) {
    const v = attrs[k];
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v);
  });
  for (let i = 2; i < arguments.length; i++) {
    const c = arguments[i];
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

function cargarAjustes() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(CLAVE_AJUSTES) || '{}')); }
  catch (e) { return Object.assign({}, DEFAULTS); }
}
function guardarAjustes() {
  try { localStorage.setItem(CLAVE_AJUSTES, JSON.stringify(ajustes)); } catch (e) { toast('No se pudieron guardar los ajustes en este navegador', true); }
}
function cargarEstado() {
  try {
    const raw = localStorage.getItem(CLAVE_ESTADO);
    return raw ? normalizarEstado(JSON.parse(raw)) : estadoInicial();
  } catch (e) { return estadoInicial(); }
}
function persistir() {
  try { localStorage.setItem(CLAVE_ESTADO, JSON.stringify(estado)); }
  catch (e) { toast('No se pudo guardar en este navegador (almacenamiento lleno o bloqueado)', true); }
}
const nubeActiva = function () { return !!(ajustes.url && ajustes.token); };

/* ================= Avisos ================= */
let toastTimer = null;
function toast(msg, esError) {
  const t = $('#toast');
  t.textContent = msg; t.classList.toggle('err', !!esError); t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.hidden = true; }, esError ? 6000 : 2200);
}

/* ================= Sincronización con Google Sheets ================= */
function jsonp(url, ms) {
  return new Promise(function (resolve, reject) {
    const cb = '__rifa_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const sc = document.createElement('script');
    const fin = function () { clearTimeout(t); delete window[cb]; sc.remove(); };
    const t = setTimeout(function () { fin(); reject(new Error('La planilla no respondió a tiempo. Revisa la URL y que la aplicación web esté publicada para "Cualquier persona".')); }, ms || 20000);
    window[cb] = function (data) { fin(); resolve(data); };
    sc.onerror = function () { fin(); reject(new Error('No se pudo conectar con la planilla. Revisa la URL de Ajustes.')); };
    sc.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'callback=' + cb;
    document.head.appendChild(sc);
  });
}
async function leerRemoto() {
  const u = ajustes.url + (ajustes.url.indexOf('?') >= 0 ? '&' : '?') + 'action=leer&token=' + encodeURIComponent(ajustes.token);
  const r = await jsonp(u);
  if (!r || r.ok !== true) {
    const motivo = r && r.error;
    throw new Error(motivo === 'token' ? 'Clave incorrecta: debe ser la misma del script de Google.' : (motivo || 'La planilla devolvió una respuesta inválida (¿la URL es de la aplicación web y termina en /exec?).'));
  }
  return normalizarEstado(r);
}
async function postRemoto(obj) {
  obj.token = ajustes.token;
  // text/plain evita la comprobación previa (preflight) de CORS; la respuesta es opaca, por eso luego se confirma leyendo.
  await fetch(ajustes.url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(obj) });
}
const esperar = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
async function confirmar(pred) {
  for (let i = 1; i <= 4; i++) {
    await esperar(700 * i);
    const r = await leerRemoto();
    if (pred(r)) { aplicarRemoto(r); return; }
  }
  throw new Error('La planilla no confirmó el cambio. Revisa la clave, la URL y que el script esté actualizado; luego pulsa Reintentar.');
}
function encolar(fn) {
  sync.pendientes++; renderSync();
  sync.cola = sync.cola.then(fn).then(function () {
    sync.error = ''; sync.fallida = null; sync.ultimo = Date.now();
  }).catch(function (e) {
    sync.error = (e && e.message) || String(e); sync.fallida = fn;
  }).then(function () { sync.pendientes--; renderSync(); });
}
function aplicarRemoto(nuevo) {
  const firma = JSON.stringify([nuevo.tickets, nuevo.gastos.map(function (g) { return [g.fecha, g.concepto, g.monto, g.comprobante, g.aprobado]; })]);
  if (firma === sync.firma) return;
  sync.firma = firma;
  estado = nuevo; persistir(); renderTodo();
}
function firmaLocal() { return sync.firma; }
async function refrescar(manual) {
  if (!nubeActiva() || sync.pendientes > 0 || (document.hidden && !manual)) return;
  sync.cargando = true; renderSync();
  try {
    aplicarRemoto(await leerRemoto());
    sync.ultimo = Date.now(); sync.error = ''; sync.fallida = null;
  } catch (e) { sync.error = e.message; sync.fallida = null; }
  sync.cargando = false; renderSync();
}
function reiniciarSync() {
  clearInterval(timer); sync.error = ''; sync.firma = '';
  renderSync();
  if (nubeActiva()) {
    refrescar(true);
    timer = setInterval(refrescar, Math.max(5, Number(ajustes.refrescoSeg) || 10) * 1000);
  }
}

// Operaciones que se envían a la planilla
function enviarTicket(t) {
  if (!nubeActiva()) return;
  encolar(async function () {
    await postRemoto({ action: 'guardarTicket', ticket: t });
    await confirmar(function (r) {
      const x = r.tickets.filter(function (v) { return v.n === t.n; })[0];
      return !!x && x.estado === t.estado && x.nombre === t.nombre && x.telefono === t.telefono && x.metodo === t.metodo && x.vendedor === t.vendedor;
    });
  });
}
function enviarGastos() {
  if (!nubeActiva()) return;
  const lista = estado.gastos.map(function (g) { return { fecha: g.fecha, concepto: g.concepto, monto: g.monto, comprobante: g.comprobante, aprobado: g.aprobado }; });
  const suma = lista.reduce(function (a, g) { return a + g.monto; }, 0);
  encolar(async function () {
    await postRemoto({ action: 'reemplazarGastos', gastos: lista });
    await confirmar(function (r) {
      return r.gastos.length === lista.length && r.gastos.reduce(function (a, g) { return a + g.monto; }, 0) === suma;
    });
  });
}
function enviarTodo() {
  if (!nubeActiva()) { toast('Primero conecta la planilla en Ajustes', true); return; }
  const snap = JSON.parse(JSON.stringify(estado));
  encolar(async function () {
    await postRemoto({ action: 'guardarTodo', tickets: snap.tickets, gastos: snap.gastos });
    await confirmar(function (r) {
      return r.tickets.every(function (x, i) { return x.estado === snap.tickets[i].estado && x.nombre === snap.tickets[i].nombre; }) && r.gastos.length === snap.gastos.length;
    });
    toast('Datos enviados a la planilla ✔');
  });
}

/* ================= Renderizado ================= */
function renderSync() {
  const p = $('#estadoSync');
  let clase = 'local', txt = 'Modo local · solo este navegador';
  if (nubeActiva()) {
    if (sync.error) { clase = 'err'; txt = 'Error de sincronización'; }
    else if (sync.pendientes > 0 || sync.cargando) { clase = 'sync'; txt = 'Sincronizando…'; }
    else if (sync.ultimo) {
      const s = Math.max(0, Math.round((Date.now() - sync.ultimo) / 1000));
      clase = 'ok'; txt = 'En vivo · actualizado hace ' + (s < 60 ? s + ' s' : Math.floor(s / 60) + ' min');
    } else { clase = 'sync'; txt = 'Conectando…'; }
  }
  p.className = 'pill ' + clase; p.textContent = txt;

  const av = $('#aviso');
  const mostrar = nubeActiva() && !!sync.error;
  av.hidden = !mostrar;
  if (mostrar) {
    $('#avisoTexto').textContent = sync.error;
    $('#btnReintentar').hidden = !sync.fallida;
  }
}

function renderKPIs() {
  const k = calcular(estado, Number(ajustes.precio) || DEFAULTS.precio);
  $('#kVend').textContent = k.vendidos;
  $('#kVendS').textContent = k.pag + ' pagados · ' + k.res + ' reservados';
  $('#kDisp').textContent = k.disp;
  $('#kDispS').textContent = 'de ' + estado.tickets.length + ' números';
  $('#kRec').textContent = clp(k.recaudado);
  $('#kPend').textContent = clp(k.pendiente);
  $('#kGas').textContent = clp(k.gastos);
  $('#kNeto').textContent = clp(k.neto);
  const pct = Math.min(100, Math.round(k.avance * 1000) / 10);
  $('#pAvance').textContent = String(pct).replace('.', ',') + '%';
  $('#barFill').style.width = pct + '%';
  $('#bar').setAttribute('aria-valuenow', String(pct));
  $('#pMeta').textContent = clp(k.recaudado) + ' recaudados de una meta de ' + clp(k.meta) + ' (' + estado.tickets.length + ' números a ' + clp(Number(ajustes.precio) || DEFAULTS.precio) + ').';
}

function ticketsFiltrados() {
  const q = ui.q.trim().toLowerCase();
  return estado.tickets.filter(function (t) {
    if (ui.filtro !== 'todos' && t.estado !== ui.filtro) return false;
    if (!q) return true;
    return t.n.indexOf(q) >= 0 || t.nombre.toLowerCase().indexOf(q) >= 0 || t.vendedor.toLowerCase().indexOf(q) >= 0;
  });
}

function renderTablero() {
  const g = $('#grid'); g.textContent = '';
  const lista = ticketsFiltrados();
  if (!lista.length) { g.append(el('p', { class: 'empty', text: 'No hay números que coincidan.' })); return; }
  lista.forEach(function (t) {
    const b = el('button', { type: 'button', class: 'tile ' + CLASE[t.estado], title: 'N° ' + t.n + ' · ' + t.estado + (t.nombre ? ' · ' + t.nombre : ''),
      onclick: function () { abrirTicket(t.n); } },
      el('span', { class: 'n', text: t.n }),
      t.estado !== 'Disponible' && t.nombre ? el('span', { class: 'who', text: t.nombre }) : null);
    g.append(b);
  });
}

function renderTabla() {
  const tb = $('#tbodyTickets'); tb.textContent = '';
  const lista = ticketsFiltrados();
  if (!lista.length) { tb.append(el('tr', null, el('td', { colspan: 11, text: 'No hay números que coincidan.' }))); return; }
  lista.forEach(function (t) {
    tb.append(el('tr', null,
      el('td', { class: 'n', text: t.n }), el('td', { text: t.nombre }), el('td', { text: t.telefono }), el('td', { text: t.instagram }),
      el('td', null, el('span', { class: 'badge ' + CLASE[t.estado], text: t.estado })),
      el('td', { text: t.metodo }), el('td', { text: t.comprobante }), el('td', { text: t.vendedor }),
      el('td', { text: fechaCorta(t.fecha) }), el('td', { text: t.obs }),
      el('td', null, el('button', { class: 'link-btn', type: 'button', text: 'Editar', onclick: function () { abrirTicket(t.n); } }))));
  });
}

function renderGastos() {
  const tb = $('#tbodyGastos'); tb.textContent = '';
  if (!estado.gastos.length) tb.append(el('tr', null, el('td', { colspan: 6, text: 'Aún no hay gastos registrados.' })));
  estado.gastos.forEach(function (g) {
    tb.append(el('tr', null,
      el('td', { text: fechaCorta(g.fecha) }), el('td', { text: g.concepto }), el('td', { class: 'm', text: clp(g.monto) }),
      el('td', { text: g.comprobante }), el('td', { text: g.aprobado }),
      el('td', null, el('button', { class: 'link-btn del', type: 'button', text: 'Eliminar', onclick: function () { eliminarGasto(g.id); } }))));
  });
  $('#gTotal').textContent = clp(estado.gastos.reduce(function (a, g) { return a + g.monto; }, 0));
}

function renderResumen() {
  const precio = Number(ajustes.precio) || DEFAULTS.precio;
  const tm = $('#tbodyMetodo'); tm.textContent = '';
  const pm = resumenPorMetodo(estado, precio);
  pm.forEach(function (f) {
    tm.append(el('tr', null, el('td', { text: f.metodo }), el('td', { class: 'm', text: f.n }), el('td', { class: 'm', text: clp(f.monto) })));
  });
  const sin = pm[pm.length - 1];
  const a = $('#alertaCuadre');
  a.hidden = sin.n === 0;
  if (sin.n > 0) a.textContent = '⚠ Hay ' + sin.n + ' número(s) pagado(s) sin método de pago registrado. Complétalos en el Tablero para que la contabilidad cuadre.';

  const tv = $('#tbodyVend'); tv.textContent = '';
  const pv = resumenPorVendedor(estado, precio);
  if (!pv.length) tv.append(el('tr', null, el('td', { colspan: 4, text: 'Aún no hay ventas registradas.' })));
  pv.forEach(function (f) {
    tv.append(el('tr', null, el('td', { text: f.vendedor }), el('td', { class: 'm', text: f.pag }), el('td', { class: 'm', text: f.res }), el('td', { class: 'm', text: clp(f.monto) })));
  });
}

function renderVista() {
  $$('.tab').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.vista === ui.vista)); });
  $$('[data-panel]').forEach(function (s) { s.hidden = s.dataset.panel !== ui.vista; });
  $('#controles').hidden = ui.vista !== 'tablero' && ui.vista !== 'tabla';
}

function renderTodo() {
  renderKPIs(); renderVista(); renderTablero(); renderTabla(); renderGastos(); renderResumen();
  const dl = $('#listaVend'); dl.textContent = '';
  const nombres = {};
  estado.tickets.forEach(function (t) { if (t.vendedor) nombres[t.vendedor] = 1; });
  Object.keys(nombres).sort().forEach(function (n) { dl.append(el('option', { value: n })); });
}

/* ================= Ficha de un número ================= */
let ticketActual = null;
function camposTicket(on) { $('#camposVenta').disabled = !on; }

function abrirTicket(n) {
  const t = estado.tickets.filter(function (x) { return x.n === n; })[0];
  if (!t) return;
  ticketActual = t;
  $('#dlgTitulo').textContent = 'Número ' + t.n;
  $('#fEstado').value = t.estado;
  $('#fNombre').value = t.nombre; $('#fTel').value = t.telefono; $('#fIG').value = t.instagram;
  $('#fMetodo').value = t.metodo; $('#fComp').value = t.comprobante; $('#fVend').value = t.vendedor;
  $('#fFecha').value = t.fecha; $('#fObs').value = t.obs;
  camposTicket(t.estado !== 'Disponible');
  $('#btnLiberar').hidden = t.estado === 'Disponible';
  $('#fError').hidden = true;
  actualizarWA();
  $('#dlgTicket').showModal();
  if (t.estado === 'Disponible') $('#fEstado').focus(); else $('#fNombre').focus();
}

function actualizarWA() {
  const num = telefonoWA($('#fTel').value);
  const a = $('#lnkWA');
  a.hidden = !num;
  if (num) {
    const nombre = $('#fNombre').value.trim().split(/\s+/)[0] || '';
    const msg = 'Hola' + (nombre ? ' ' + nombre : '') + '! Te escribo por tu número ' + (ticketActual ? ticketActual.n : '') + ' de la rifa pro-fondos de Liga del Rock Academy.';
    a.href = 'https://wa.me/' + num + '?text=' + encodeURIComponent(msg);
  }
}

function error(msg) { const e = $('#fError'); e.textContent = msg; e.hidden = false; }

function guardarTicket(ev) {
  ev.preventDefault();
  const n = ticketActual.n;
  const est = $('#fEstado').value;
  let nuevo;
  if (est === 'Disponible') {
    const habiaDatos = ticketActual.estado !== 'Disponible';
    if (habiaDatos && !confirm('¿Liberar el número ' + n + '? Se borrarán los datos del comprador.')) return;
    nuevo = ticketVacio(n);
  } else {
    const nombre = texto($('#fNombre').value, 120);
    const tel = texto($('#fTel').value, 30);
    if (!nombre) return error('Escribe el nombre del comprador.');
    if (tel && telefonoWA(tel) === '') return error('El teléfono parece incompleto (mínimo 8 dígitos).');
    if (est === 'Pagado' && !$('#fMetodo').value) return error('Para marcar como Pagado, elige el método de pago.');
    nuevo = normalizarTicket({
      nombre: nombre, telefono: tel, instagram: $('#fIG').value, estado: est, metodo: $('#fMetodo').value,
      comprobante: $('#fComp').value, vendedor: $('#fVend').value, fecha: $('#fFecha').value || hoyISO(), obs: $('#fObs').value
    }, n);
  }
  estado.tickets = estado.tickets.map(function (x) { return x.n === n ? nuevo : x; });
  persistir(); renderTodo(); enviarTicket(nuevo);
  $('#dlgTicket').close();
  toast('Número ' + n + ' guardado ✔');
}

function liberarTicket() {
  $('#fEstado').value = 'Disponible';
  guardarTicket(new Event('submit', { cancelable: true }));
}

/* ================= Gastos ================= */
function agregarGasto(ev) {
  ev.preventDefault();
  const concepto = texto($('#gConcepto').value, 120);
  const monto = Math.round(Number($('#gMonto').value));
  if (!concepto || !(monto > 0)) { toast('Completa concepto y monto', true); return; }
  if (estado.gastos.length >= 100) { toast('Máximo 100 gastos', true); return; }
  estado.gastos.push(normalizarGasto({ fecha: $('#gFecha').value || hoyISO(), concepto: concepto, monto: monto, comprobante: $('#gComp').value, aprobado: $('#gAprob').value }, estado.gastos.length));
  persistir(); renderTodo(); enviarGastos();
  $('#formGasto').reset(); $('#gFecha').value = hoyISO();
  toast('Gasto agregado ✔');
}
function eliminarGasto(id) {
  const g = estado.gastos.filter(function (x) { return x.id === id; })[0];
  if (!g || !confirm('¿Eliminar el gasto "' + g.concepto + '" por ' + clp(g.monto) + '?')) return;
  estado.gastos = estado.gastos.filter(function (x) { return x.id !== id; });
  persistir(); renderTodo(); enviarGastos();
  toast('Gasto eliminado');
}

/* ================= Respaldo ================= */
function descargar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = el('a', { href: url, download: nombre });
  document.body.append(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}
function importarJSON(ev) {
  const f = ev.target.files[0]; ev.target.value = '';
  if (!f) return;
  const r = new FileReader();
  r.onload = function () {
    try {
      const d = JSON.parse(String(r.result));
      if (!d || !Array.isArray(d.tickets)) throw new Error('formato');
      if (!confirm('¿Restaurar este respaldo? Reemplazará los datos actuales de este navegador.')) return;
      estado = normalizarEstado(d); persistir(); renderTodo();
      toast('Respaldo restaurado ✔');
      if (nubeActiva() && confirm('¿Enviar también estos datos a la planilla de Google? (reemplaza lo que haya en ella)')) enviarTodo();
    } catch (e) { toast('El archivo no es un respaldo válido', true); }
  };
  r.readAsText(f);
}

/* ================= Ajustes ================= */
function abrirAjustes() {
  $('#aUrl').value = ajustes.url; $('#aToken').value = ajustes.token;
  $('#aPrecio').value = ajustes.precio; $('#aRefresco').value = ajustes.refrescoSeg;
  $('#aResultado').textContent = '';
  $('#dlgAjustes').showModal();
}
async function probarConexion() {
  const prev = { url: ajustes.url, token: ajustes.token };
  const out = $('#aResultado');
  const url = $('#aUrl').value.trim(), token = $('#aToken').value;
  if (!url || !token) { out.textContent = 'Escribe la URL y la clave para probar.'; return; }
  out.textContent = 'Probando…';
  ajustes.url = url; ajustes.token = token;
  try {
    const r = await leerRemoto();
    const c = calcular(r, Number($('#aPrecio').value) || DEFAULTS.precio);
    out.textContent = '✔ Conexión correcta. La planilla tiene ' + c.pag + ' pagados, ' + c.res + ' reservados y ' + r.gastos.length + ' gastos.';
  } catch (e) { out.textContent = '✖ ' + e.message; }
  ajustes.url = prev.url; ajustes.token = prev.token;
}
function guardarAjustesForm(ev) {
  ev.preventDefault();
  const url = $('#aUrl').value.trim();
  if (url && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
    $('#aResultado').textContent = '✖ La URL debe ser la de la aplicación web: https://script.google.com/macros/s/…/exec';
    return;
  }
  ajustes.url = url; ajustes.token = $('#aToken').value;
  ajustes.precio = Math.max(1, Math.round(Number($('#aPrecio').value)) || DEFAULTS.precio);
  ajustes.refrescoSeg = Math.min(300, Math.max(5, Math.round(Number($('#aRefresco').value)) || DEFAULTS.refrescoSeg));
  guardarAjustes();
  $('#dlgAjustes').close();
  renderTodo(); reiniciarSync();
  toast(nubeActiva() ? 'Conectando con la planilla…' : 'Ajustes guardados (modo local)');
}

/* ================= Arranque ================= */
function iniciar() {
  $$('.tab').forEach(function (b) { b.addEventListener('click', function () { ui.vista = b.dataset.vista; renderVista(); }); });
  $$('.chip[data-f]').forEach(function (c) {
    c.addEventListener('click', function () {
      ui.filtro = c.dataset.f;
      $$('.chip[data-f]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === c)); });
      renderTablero(); renderTabla();
    });
  });
  $('#q').addEventListener('input', function (e) { ui.q = e.target.value; renderTablero(); renderTabla(); });

  $('#fEstado').addEventListener('change', function () {
    const activo = $('#fEstado').value !== 'Disponible';
    camposTicket(activo);
    if (activo && !$('#fFecha').value) $('#fFecha').value = hoyISO();
  });
  $('#fTel').addEventListener('input', actualizarWA);
  $('#fNombre').addEventListener('input', actualizarWA);
  $('#formTicket').addEventListener('submit', guardarTicket);
  $('#btnLiberar').addEventListener('click', liberarTicket);
  $('#btnCancelar').addEventListener('click', function () { $('#dlgTicket').close(); });
  $('#btnCerrarTicket').addEventListener('click', function () { $('#dlgTicket').close(); });

  $('#formGasto').addEventListener('submit', agregarGasto);
  $('#gFecha').value = hoyISO();

  $('#btnExpJSON').addEventListener('click', function () { descargar('rifa_respaldo_' + hoyISO() + '.json', JSON.stringify(estado, null, 2), 'application/json'); });
  $('#btnExpCSV').addEventListener('click', function () { descargar('rifa_numeros_' + hoyISO() + '.csv', '﻿' + ticketsACSV(estado), 'text/csv;charset=utf-8'); });
  $('#btnExpGastos').addEventListener('click', function () { descargar('rifa_gastos_' + hoyISO() + '.csv', '﻿' + gastosACSV(estado), 'text/csv;charset=utf-8'); });
  $('#fileImport').addEventListener('change', importarJSON);
  $('#btnSubir').addEventListener('click', function () {
    if (confirm('¿Enviar todos los datos de este navegador a la planilla? Reemplazará lo que haya en ella.')) enviarTodo();
  });
  $('#btnReset').addEventListener('click', function () {
    if (prompt('Esto vacía los datos de ESTE navegador. Escribe BORRAR para confirmar.') === 'BORRAR') {
      estado = estadoInicial(); sync.firma = ''; persistir(); renderTodo(); toast('Datos locales vaciados');
      if (nubeActiva()) refrescar(true);
    }
  });

  $('#btnAjustes').addEventListener('click', abrirAjustes);
  $('#btnCerrarAj').addEventListener('click', function () { $('#dlgAjustes').close(); });
  $('#btnCancelarAj').addEventListener('click', function () { $('#dlgAjustes').close(); });
  $('#btnProbar').addEventListener('click', probarConexion);
  $('#formAjustes').addEventListener('submit', guardarAjustesForm);

  $('#btnReintentar').addEventListener('click', function () {
    if (sync.fallida) { const f = sync.fallida; sync.error = ''; sync.fallida = null; encolar(f); }
  });
  $('#btnRecargar').addEventListener('click', function () { sync.error = ''; sync.fallida = null; refrescar(true); });

  // Varias pestañas del mismo navegador se mantienen al día al instante
  window.addEventListener('storage', function (ev) {
    if (ev.key === CLAVE_ESTADO) { estado = cargarEstado(); renderTodo(); }
    if (ev.key === CLAVE_AJUSTES) { ajustes = cargarAjustes(); renderTodo(); reiniciarSync(); }
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refrescar(); });
  setInterval(renderSync, 1000);

  renderTodo();
  reiniciarSync();
}

if (typeof document !== 'undefined') iniciar();
