/**
 * BACKEND DE LA RIFA · LIGA DEL ROCK ACADEMY
 * ---------------------------------------------------------------
 * Conecta el Panel de control (index.html) con tu planilla, en tiempo real.
 * Reemplaza al archivo endpoint_rifa.gs: si ya pegaste su función doGet,
 * BÓRRALA y pega este código completo en su lugar (solo puede haber una doGet).
 *
 * PASOS
 *  1) Cambia TOKEN_RIFA (abajo) por una clave larga y tuya. Ejemplo: LigaRock-9xK2-pasto-2026
 *  2) Guarda. Implementar > Nueva implementación > tipo "Aplicación web".
 *       Ejecutar como: Yo        Quién tiene acceso: Cualquier persona
 *  3) Autoriza los permisos y copia la URL que termina en /exec.
 *  4) En el panel: Ajustes > pega la URL y la misma clave > Probar conexión.
 *
 * Si cambias este código más adelante: Implementar > Administrar implementaciones >
 * lápiz (Editar) > Versión: "Nueva versión" > Implementar. La URL no cambia.
 *
 * SEGURIDAD
 *  - Sin la clave, solo se entrega la pestaña "Vista Pública" (sin teléfonos).
 *  - Con la clave se pueden leer y escribir los datos completos: no la compartas.
 */
const TOKEN_RIFA = 'CAMBIA-ESTA-CLAVE';

const HOJA_CTRL = 'Control de Números';
const HOJA_GAST = 'Registro de Gastos';
const HOJA_PUB = 'Vista Pública';
const ESTADOS_OK = ['Pagado', 'Reservado / Pendiente', 'Disponible'];
const METODOS_OK = ['Transferencia', 'Efectivo', 'MercadoPago/Webpay'];
const N_TICKETS = 101;   // 00 al 100
const N_GASTOS = 100;

/* ---------------------------- Entradas web ---------------------------- */
function doGet(e) {
  const p = (e && e.parameter) || {};
  let datos;
  try {
    if (p.action === 'leer') {
      if (!claveValida_(p.token)) datos = { ok: false, error: claveError_() };
      else datos = leerTodo_();
    } else {
      datos = leerPublico_();   // lo que usa la página pública (sin datos privados)
    }
  } catch (err) {
    datos = { ok: false, error: String(err) };
  }
  return responder_(datos, p.callback);
}

function doPost(e) {
  let r;
  try {
    const b = JSON.parse(e.postData.contents);
    if (!claveValida_(b.token)) {
      r = { ok: false, error: claveError_() };
    } else {
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try { r = procesar_(b); } finally { lock.releaseLock(); }
    }
  } catch (err) {
    r = { ok: false, error: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(r)).setMimeType(ContentService.MimeType.JSON);
}

function responder_(datos, cb) {
  const json = JSON.stringify(datos);
  if (cb && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(cb)) {
    return ContentService.createTextOutput(cb + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function claveValida_(t) {
  return TOKEN_RIFA !== 'CAMBIA-ESTA-CLAVE' && typeof t === 'string' && t === TOKEN_RIFA;
}
function claveError_() {
  return TOKEN_RIFA === 'CAMBIA-ESTA-CLAVE' ? 'Falta configurar TOKEN_RIFA en el script de Google.' : 'token';
}

/* ------------------------------ Lectura ------------------------------ */
function hoja_(nombre) {
  const h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  if (!h) throw new Error('No existe la pestaña "' + nombre + '".');
  return h;
}

function leerPublico_() {
  return hoja_(HOJA_PUB).getRange(1, 1, 105, 9).getDisplayValues();
}

function txt_(v) {
  if (v === 0 || v === null || v === undefined) return '';   // un 0 suelto en una celda de texto se considera vacío
  return String(v).trim();
}
function fechaISO_(v, tz) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt_(v));
  return m ? m[0].slice(0, 10) : '';
}

function leerTodo_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  const v = hoja_(HOJA_CTRL).getRange(2, 1, N_TICKETS, 10).getValues();
  const tickets = v.map(function (r) {
    const estado = ESTADOS_OK.indexOf(r[4]) >= 0 ? r[4] : 'Disponible';
    return {
      n: txt_(r[0]).padStart(2, '0'), nombre: txt_(r[1]), telefono: txt_(r[2]), instagram: txt_(r[3]),
      estado: estado, metodo: METODOS_OK.indexOf(r[5]) >= 0 ? r[5] : '', comprobante: txt_(r[6]),
      vendedor: txt_(r[7]), fecha: fechaISO_(r[8], tz), obs: txt_(r[9])
    };
  });
  const g = hoja_(HOJA_GAST).getRange(2, 1, N_GASTOS, 5).getValues();
  const gastos = [];
  g.forEach(function (r) {
    if (txt_(r[1]) === '' && !Number(r[2])) return;
    gastos.push({ fecha: fechaISO_(r[0], tz), concepto: txt_(r[1]), monto: Number(r[2]) || 0, comprobante: txt_(r[3]), aprobado: txt_(r[4]) });
  });
  return { ok: true, ts: Date.now(), tickets: tickets, gastos: gastos };
}

/* ------------------------------ Escritura ------------------------------ */
function procesar_(b) {
  switch (b.action) {
    case 'guardarTicket':
      escribirTicket_(b.ticket);
      return { ok: true };
    case 'reemplazarGastos':
      escribirGastos_(b.gastos);
      return { ok: true };
    case 'guardarTodo':
      escribirTodosLosTickets_(b.tickets);
      escribirGastos_(b.gastos);
      return { ok: true };
    default:
      return { ok: false, error: 'acción desconocida' };
  }
}

// Evita que un texto escrito por un usuario se interprete como fórmula en la planilla
function limpio_(v, max) {
  let s = (v === null || v === undefined ? '' : String(v)).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max || 200);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}
function plano_(v, max) {   // para columnas con formato "texto plano" (teléfono, comprobante)
  return (v === null || v === undefined ? '' : String(v)).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max || 200);
}
function fechaCelda_(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : '';
}

// Devuelve las columnas B..J (9 valores) de un número
function filaTicket_(t) {
  const estado = t && ESTADOS_OK.indexOf(t.estado) >= 0 ? t.estado : 'Disponible';
  if (estado === 'Disponible') return ['', '', '', 'Disponible', '', '', '', '', ''];
  return [
    limpio_(t.nombre, 120), plano_(t.telefono, 30), limpio_(t.instagram, 60), estado,
    METODOS_OK.indexOf(t.metodo) >= 0 ? t.metodo : '', plano_(t.comprobante, 120),
    limpio_(t.vendedor, 60), fechaCelda_(t.fecha), limpio_(t.obs, 300)
  ];
}

function numeroTicket_(t) {
  const n = parseInt(String(t && t.n), 10);
  if (!(n >= 0 && n < N_TICKETS)) throw new Error('Número de ticket inválido');
  return n;
}

function escribirTicket_(t) {
  const n = numeroTicket_(t);
  hoja_(HOJA_CTRL).getRange(n + 2, 2, 1, 9).setValues([filaTicket_(t)]);   // el ticket 00 está en la fila 2
}

function escribirTodosLosTickets_(lista) {
  const filas = [];
  for (let i = 0; i < N_TICKETS; i++) filas.push(['', '', '', 'Disponible', '', '', '', '', '']);
  (lista || []).forEach(function (t) { filas[numeroTicket_(t)] = filaTicket_(t); });
  hoja_(HOJA_CTRL).getRange(2, 2, N_TICKETS, 9).setValues(filas);
}

function escribirGastos_(lista) {
  const l = (lista || []).slice(0, N_GASTOS);
  const filas = [];
  for (let i = 0; i < N_GASTOS; i++) {
    const g = l[i];
    filas.push(g
      ? [fechaCelda_(g.fecha), limpio_(g.concepto, 120), Math.max(0, Math.round(Number(g.monto) || 0)), limpio_(g.comprobante, 120), limpio_(g.aprobado, 60)]
      : ['', '', '', '', '']);
  }
  hoja_(HOJA_GAST).getRange(2, 1, N_GASTOS, 5).setValues(filas);
}
