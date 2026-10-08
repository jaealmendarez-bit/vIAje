/* ==========================================================================
   vIAje — Prototipo 1 (Suite para Agentes de Viajes)
   - Diseño de pase de abordar / boleto vintage
   - Motor local de itinerarios + exportación a PDF con jsPDF
   - Itinerarios y consultas con Gemini cuando hay API Key
   - Bitácora de clientes (CRM local en localStorage)
   ========================================================================== */

/* ==========================================================================
   1. CONSTANTES, ESTADO Y CONFIGURACIÓN
   ========================================================================== */
const STORAGE_KEY_CRM = 'viaje_expedientes_crm_v1';
const STORAGE_KEY_KEY = 'viaje_gemini_api_key_v1';
const STORAGE_KEY_MODEL = 'viaje_gemini_model_v1';

// Los modelos de Gemini se retiran con frecuencia. Si Google retira este,
// se puede cambiar desde el modal (⚙️) sin editar el código.
const GEMINI_MODEL_DEFAULT = 'gemini-3.5-flash';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_TIMEOUT_MS = 60000;
const MAX_HISTORIAL = 60;
const STAMP_ICONS = ['✈', '🧭'];

const INSTRUCCIONES_SISTEMA = `
Eres un consultor experto y asesor senior para agentes de viajes llamado vIAje.
Tu cobertura y especialidad se limita EXCLUSIVAMENTE a la República Mexicana y sus 32 estados. Tu objetivo es ayudar al agente a estructurar propuestas e itinerarios completos, sobrios, profesionales y listos para presentar a sus clientes.

REGLAS DE COMPORTAMIENTO:
1. SALUDOS: Saluda SOLO en el primer mensaje de una nueva consulta. NUNCA repitas "Hola", "Bienvenido" ni saludos en respuestas posteriores. Ve directo al grano.
2. TRATO: Trata amablemente al usuario como "viajero" o "colega asesor".
3. DELIMITACIÓN EXCLUSIVA A MÉXICO (32 ESTADOS): Solo puedes cotizar y responder sobre los 32 estados de la República Mexicana. Si el usuario solicita un destino fuera de México, responde que tu servicio se especializa exclusivamente en México y sugiere destinos nacionales equivalentes.
4. DESVIACIÓN DE TEMA: Si el usuario pregunta algo ajeno a viajes, responde ESTRICTAMENTE: "Como asistente de viajes, solo puedo ayudarte a planear tus itinerarios y viajes."
5. ESTRUCTURA SOBRIA SIN SATURACIÓN DE EMOJIS: Organiza el itinerario DÍA POR DÍA (Día 1, Día 2, etc.) detallando claramente Mañana, Tarde y Noche. EVITA emojis innecesarios; prioriza redacción profesional y clara. Incluye siempre: Hospedaje Recomendado, Gastronomía y Restaurantes, Notas Logísticas y Seguridad.
6. BITÁCORA Y MEMORIA DE CLIENTES: Tienes acceso a la bitácora de clientes de la agencia. Si el agente pregunta por un cliente previo, consulta la bitácora, recuérdalo con precisión y brinda el seguimiento correspondiente.
7. EXTRACCIÓN CORRECTA DEL NOMBRE DEL CLIENTE: Cuando el agente diga "tengo un cliente llamado Juan", "mi cliente es María", "el cliente Juan García", el nombre del cliente es ÚNICAMENTE el sustantivo propio que sigue inmediatamente. Palabras como "llamado", "llamada", "cliente", "titular", "mi", "el", "la" NO son parte del nombre. Usa ese nombre de forma consistente durante toda la conversación; nunca inventes apellidos ni lo modifiques.
8. COHERENCIA GEOGRÁFICA OBLIGATORIA: Cada sugerencia de actividades debe ser coherente con la geografía real del destino:
   - Destinos SIN acceso al mar (CDMX, Guanajuato, Querétaro, Puebla, Hidalgo, Tlaxcala, Morelos, Aguascalientes, Zacatecas, San Luis Potosí, Durango, México Estado): NO menciones playas marinas, snorkel en mar, ni actividades costeras. Sugiere en cambio parques, museos, ríos, balnearios, lagos o cuerpos de agua interiores.
   - Destinos CON litoral (Quintana Roo, Oaxaca costa, Guerrero, Jalisco costa, Nayarit, Sinaloa, Sonora, BCS, Veracruz, Tabasco, Campeche, Yucatán, Chiapas costa): puedes incluir actividades de playa y mar.
9. LONGITUD DE RESPUESTA: Sé detallado y específico. Un itinerario debe incluir al menos 3–5 líneas por periodo del día (mañana, tarde, noche), con nombres de lugares reales verificados del destino solicitado. Nunca uses nombres genéricos o inventados.
`;

// Estado de la aplicación
let apiKey = localStorage.getItem(STORAGE_KEY_KEY) || '';
let geminiModel = localStorage.getItem(STORAGE_KEY_MODEL) || GEMINI_MODEL_DEFAULT;
let expedientes = cargarExpedientesStorage();
let expedienteActual = null;
let flujoItinerario = flujoInicial();
let ultimoItinerarioGenerado = null;

function flujoInicial() {
  return { paso: null, dias: 3, estilo: 'mix', presupuesto: 'medio' };
}

// Elementos del DOM
const chatEl = document.getElementById('chat');
const composerEl = document.getElementById('composer');
const inputEl = document.getElementById('input');
const sendBtnEl = document.getElementById('sendBtn');
const chipsEl = document.getElementById('chips');
const ticketIdEl = document.getElementById('ticketId');
const ticketDateEl = document.getElementById('ticketDate');

// Drawer / Expedientes
const drawerEl = document.getElementById('drawer');
const drawerOverlayEl = document.getElementById('drawerOverlay');
const openDrawerBtn = document.getElementById('openDrawerBtn');
const closeDrawerBtn = document.getElementById('closeDrawerBtn');
const drawerNewClientBtn = document.getElementById('drawerNewClientBtn');
const newChatBtn = document.getElementById('newChatBtn');
const dossierListEl = document.getElementById('dossierList');
const dossierCountEl = document.getElementById('dossierCount');
const searchClientInput = document.getElementById('searchClientInput');

// Barra de cliente activo
const activeClientBar = document.getElementById('activeClientBar');
const activeClientNameEl = document.getElementById('activeClientName');
const activeClientDetailEl = document.getElementById('activeClientDetail');
const clearActiveClientBtn = document.getElementById('clearActiveClientBtn');

// Modal de Gemini
const keyModal = document.getElementById('keyModal');
const openKeyModalBtn = document.getElementById('openKeyModalBtn');
const closeKeyModalBtn = document.getElementById('closeKeyModalBtn');
const geminiApiKeyInput = document.getElementById('geminiApiKeyInput');
const geminiModelInput = document.getElementById('geminiModelInput');
const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
const clearApiKeyBtn = document.getElementById('clearApiKeyBtn');
const apiStatusMessage = document.getElementById('apiStatusMessage');

/* ==========================================================================
   2. UTILIDADES
   ========================================================================== */
function normalizar(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Escapa HTML para insertar texto de usuario o de la IA de forma segura
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlATexto(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return (d.textContent || '').replace(/\s+/g, ' ').trim();
}

const esperar = ms => new Promise(r => setTimeout(r, ms));

function presupuestoAClave(p) {
  const t = normalizar(p);
  if (/mochi|econom|barato|bajo/.test(t)) return 'mochi';
  if (/todo|lujo|premium|alto/.test(t)) return 'todo';
  return 'medio';
}

/* ==========================================================================
   3. EXPEDIENTES Y CRM DE CLIENTES (MEMORIA PERSISTENTE)
   ========================================================================== */
function cargarExpedientesStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CRM);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Error al cargar expedientes:', e);
    return [];
  }
}

function esExpedienteVacio(e) {
  return e.cliente === 'Nueva Consulta' && (!e.historial || e.historial.length === 0) && !e.ultimoItinerario;
}

function guardarExpedientesStorage() {
  try {
    localStorage.setItem(STORAGE_KEY_CRM, JSON.stringify(expedientes));
  } catch (e) {
    console.error('Error al guardar expedientes:', e);
  }
  actualizarBadgeExpedientes();
}

function actualizarBadgeExpedientes() {
  if (dossierCountEl) {
    dossierCountEl.textContent = expedientes.filter(e => !esExpedienteVacio(e)).length;
  }
}

function generarId() {
  return 'exp_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
}

function obtenerFechaCorta() {
  return new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
}

function obtenerFechaCompleta() {
  return new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function nuevoExpedienteVacio() {
  return {
    id: generarId(),
    cliente: 'Nueva Consulta',
    destino: 'Por definir',
    pasajeros: 1,
    presupuesto: 'Medio',
    fecha: obtenerFechaCorta(),
    fechaCompleta: obtenerFechaCompleta(),
    historial: [],
    ultimoItinerario: null
  };
}

function obtenerOCrearExpedienteActual() {
  if (!expedienteActual) {
    expedienteActual = nuevoExpedienteVacio();
    expedientes.unshift(expedienteActual);
    guardarExpedientesStorage();
  }
  return expedienteActual;
}

function actualizarBarraClienteActivo() {
  if (!expedienteActual || expedienteActual.cliente === 'Nueva Consulta') {
    activeClientBar.style.display = 'none';
    return;
  }
  activeClientBar.style.display = 'flex';
  activeClientNameEl.textContent = expedienteActual.cliente;
  activeClientDetailEl.textContent = `· ${expedienteActual.pasajeros} viajero(s) · ${expedienteActual.destino}`;
}

/* ---------- Catálogo de destinos (32 estados) ---------- */
// IMPORTANTE: "Baja California Sur" va antes que "Baja California"; si no,
// la regex de "baja california" también coincide con "baja california sur".
const DESTINOS_CATALOGO = [
  { claves: ['cdmx', 'ciudad de mexico', 'distrito federal', 'df'], nombre: 'Ciudad de México (CDMX)' },
  { claves: ['aguascalientes', 'calvillo', 'real de asientos'], nombre: 'Aguascalientes' },
  { claves: ['baja california sur', 'los cabos', 'cabo san lucas', 'san jose del cabo', 'cabos', 'bcs', 'la paz', 'loreto', 'todos santos', 'cabo pulmo'], nombre: 'Baja California Sur (Los Cabos / La Paz)' },
  { claves: ['baja california', 'tijuana', 'ensenada', 'valle de guadalupe', 'mexicali', 'rosarito', 'tecate'], nombre: 'Baja California' },
  { claves: ['campeche', 'calakmul', 'palizada'], nombre: 'Campeche' },
  { claves: ['chiapas', 'san cristobal de las casas', 'san cristobal', 'palenque', 'tuxtla gutierrez', 'comitan', 'canon del sumidero'], nombre: 'Chiapas' },
  { claves: ['chihuahua', 'barrancas del cobre', 'creel', 'ciudad juarez', 'chepe'], nombre: 'Chihuahua' },
  { claves: ['coahuila', 'saltillo', 'cuatro cienegas', 'parras', 'parras de la fuente', 'torreon'], nombre: 'Coahuila' },
  { claves: ['colima', 'manzanillo', 'comala'], nombre: 'Colima' },
  { claves: ['durango', 'nombre de dios'], nombre: 'Durango' },
  { claves: ['estado de mexico', 'edomex', 'valle de bravo', 'malinalco', 'teotihuacan', 'toluca', 'ixtapan de la sal'], nombre: 'Estado de México' },
  { claves: ['guanajuato', 'san miguel de allende', 'san miguel', 'dolores hidalgo', 'mineral de pozos'], nombre: 'Guanajuato' },
  { claves: ['guerrero', 'acapulco', 'ixtapa', 'zihuatanejo', 'taxco'], nombre: 'Guerrero' },
  { claves: ['hidalgo', 'huasca', 'huasca de ocampo', 'real del monte', 'tolantongo', 'grutas de tolantongo', 'pachuca'], nombre: 'Hidalgo' },
  { claves: ['jalisco', 'guadalajara', 'puerto vallarta', 'vallarta', 'tequila', 'tlaquepaque', 'chapala', 'mazamitla', 'tapalpa'], nombre: 'Jalisco (Guadalajara / Puerto Vallarta)' },
  { claves: ['michoacan', 'morelia', 'patzcuaro', 'uruapan', 'quiroga', 'janitzio'], nombre: 'Michoacán' },
  { claves: ['morelos', 'cuernavaca', 'tepoztlan', 'tequesquitengo', 'tlayacapan'], nombre: 'Morelos' },
  { claves: ['nayarit', 'riviera nayarit', 'sayulita', 'punta de mita', 'san blas', 'nuevo vallarta', 'san pancho'], nombre: 'Nayarit (Riviera Nayarit)' },
  { claves: ['nuevo leon', 'monterrey', 'san pedro garza garcia'], nombre: 'Nuevo León' },
  { claves: ['oaxaca', 'huatulco', 'puerto escondido', 'mazunte', 'monte alban', 'hierve el agua', 'zipolite'], nombre: 'Oaxaca' },
  { claves: ['puebla', 'cholula', 'cuetzalan', 'zacatlan', 'chignahuapan', 'atlixco'], nombre: 'Puebla' },
  { claves: ['queretaro', 'tequisquiapan', 'bernal', 'sierra gorda', 'jalpan'], nombre: 'Querétaro' },
  { claves: ['quintana roo', 'cancun', 'riviera maya', 'playa del carmen', 'tulum', 'cozumel', 'bacalar', 'holbox', 'isla mujeres'], nombre: 'Quintana Roo (Cancún / Riviera Maya)' },
  { claves: ['san luis potosi', 'huasteca potosina', 'huasteca', 'xilitla', 'real de catorce', 'aquismon'], nombre: 'San Luis Potosí' },
  { claves: ['sinaloa', 'mazatlan', 'culiacan', 'el fuerte', 'los mochis'], nombre: 'Sinaloa' },
  { claves: ['sonora', 'hermosillo', 'san carlos', 'puerto penasco', 'alamos'], nombre: 'Sonora' },
  { claves: ['tabasco', 'villahermosa', 'comalcalco', 'tapijulapa'], nombre: 'Tabasco' },
  { claves: ['tamaulipas', 'tampico', 'ciudad victoria'], nombre: 'Tamaulipas' },
  { claves: ['tlaxcala', 'huamantla', 'cacaxtla'], nombre: 'Tlaxcala' },
  { claves: ['veracruz', 'boca del rio', 'xalapa', 'orizaba', 'papantla', 'coatepec', 'catemaco'], nombre: 'Veracruz' },
  { claves: ['yucatan', 'merida', 'valladolid', 'chichen itza', 'izamal', 'celestun'], nombre: 'Yucatán' },
  { claves: ['zacatecas', 'jerez', 'sombrerete'], nombre: 'Zacatecas' }
];

// Expresiones regulares precompiladas (claves ya normalizadas, sin acentos)
const CATALOGO_REGEX = DESTINOS_CATALOGO.map(item => ({
  nombre: item.nombre,
  regs: item.claves.map(c => new RegExp('\\b' + normalizar(c) + '\\b'))
}));

const DESTINOS_INTERNACIONALES = [
  'paris', 'francia', 'roma', 'italia', 'madrid', 'barcelona', 'espana',
  'tokio', 'japon', 'new york', 'nueva york', 'orlando', 'disney', 'miami',
  'estados unidos', 'usa', 'londres', 'inglaterra', 'uk', 'europa', 'colombia',
  'bogota', 'medellin', 'cartagena', 'peru', 'lima', 'cusco', 'machu picchu',
  'argentina', 'buenos aires', 'chile', 'santiago', 'brasil', 'rio de janeiro',
  'canada', 'toronto', 'vancouver', 'egipto', 'dubai', 'china', 'alemania', 'berlin'
];

function esDestinoInternacional(texto) {
  // "Roma Norte / Roma Sur" son colonias de CDMX, no Italia
  const norm = normalizar(texto).replace(/\broma\s+(norte|sur)\b/g, ' ');
  return DESTINOS_INTERNACIONALES.some(p => new RegExp('\\b' + p + '\\b').test(norm));
}

/* ---------- Extracción de datos del cliente desde el texto ---------- */
const STOP_WORDS_NAME = new Set([
  'que', 'para', 'con', 'en', 'de', 'del', 'por', 'y', 'e', 'a', 'al',
  'un', 'una', 'unos', 'unas', 'el', 'la', 'los', 'las', 'mi', 'su', 'este', 'esta',
  'cotiza', 'quiere', 'busca', 'desea', 'va', 'viaja', 'necesita', 'solicita', 'pide', 'es',
  'llamado', 'llamada', 'nombrado', 'nombrada', 'denominado', 'apodado', 'conocido',
  'estancia', 'viaje', 'itinerario', 'cotizacion', 'presupuesto', 'dias', 'noches',
  'personas', 'pax', 'guiada', 'tour', 'alojamiento', 'hotel', 'alguien',
  'hola', 'buenas', 'buenos', 'gracias', 'si', 'no', 'ok', 'claro', 'listo', 'perfecto',
  'dame', 'dime', 'quiero', 'necesito'
]);

function extraerNombreCliente(texto) {
  if (/fulanit[oa](\s+de\s+tal)?/i.test(texto)) return 'Fulanito de Tal';

  const LET = 'A-ZÁÉÍÓÚÑa-záéíóúñü';
  const re = new RegExp(
    '(?:tengo\\s+(?:un|una)\\s+)?(?:cliente|clienta)\\s+(?:(?:llamad[oa]|nombrad[oa]|denominad[oa]|apodad[oa]|conocid[oa])\\s+|es\\s+)?([' + LET + '\\s]{2,40})' +
    '|(?:llamad[oa]|nombrad[oa]|denominad[oa]|apodad[oa]|conocid[oa])\\s+([' + LET + '\\s]{2,40})' +
    '|(?:titular|atendiendo\\s+a|tengo\\s+a|para\\s+el\\s+cliente|del\\s+cliente)\\s+([' + LET + '\\s]{2,40})',
    'i'
  );
  const match = texto.match(re);
  if (match && (match[1] || match[2] || match[3])) {
    const rawTokens = (match[1] || match[2] || match[3]).trim().split(/\s+/);
    const validTokens = [];
    for (const tok of rawTokens) {
      const cleanTok = tok.toLowerCase().replace(/[^a-záéíóúñü]/g, '');
      if (STOP_WORDS_NAME.has(normalizar(cleanTok))) break;
      if (cleanTok.length > 0) {
        validTokens.push(cleanTok.charAt(0).toUpperCase() + cleanTok.slice(1));
      }
      if (validTokens.length >= 2) break;
    }
    if (validTokens.length > 0) return validTokens.join(' ');
  }

  // Formato del placeholder: "Carlos, 4 personas, Oaxaca, 3 días"
  const inicio = texto.match(/^\s*([A-ZÁÉÍÓÚÑ][a-záéíóúñü]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñü]+)?)\s*[,;:]/);
  if (inicio) {
    const cand = inicio[1];
    const primera = normalizar(cand).split(/\s+/)[0];
    if (!STOP_WORDS_NAME.has(primera) && !extraerDestino(cand)) return cand;
  }
  return null;
}

function extraerDestino(texto) {
  const norm = normalizar(texto).replace(/["'()]/g, ' ');

  // 1. Catálogo conocido
  for (let i = 0; i < CATALOGO_REGEX.length; i++) {
    if (CATALOGO_REGEX[i].regs.some(r => r.test(norm))) return CATALOGO_REGEX[i].nombre;
  }

  // 2. Patrones explícitos ("destino: X", "estancia en X", "viaje a X")
  const matchDest = texto.match(/(?:destino\s*(?:es|ser[ií]a)?\s*[:=]?\s*["']?|estancia\s*(?:guiada\s*)?en\s*["']?|viaje\s*a\s*["']?)([^"',.()\n\r]{2,30})/i);
  if (matchDest && matchDest[1]) {
    let d = matchDest[1].trim().replace(/["'()]/g, '');
    d = d.replace(/\b(?:para|con|por|en|de|del|durante|desde)\b.*$/i, '').trim();
    // Solo si empieza con mayúscula (evita "viaje a la playa")
    if (d.length > 2 && /^[A-ZÁÉÍÓÚÑ]/.test(d) && !['un', 'una', 'los', 'las', 'el', 'la', 'mi', 'su', 'este', 'estancia'].includes(d.toLowerCase())) {
      return d.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }
  }
  return null;
}

function autoDetectarDatosCliente(texto) {
  const exp = obtenerOCrearExpedienteActual();
  const t = normalizar(texto);
  let modificado = false;

  const nombre = extraerNombreCliente(texto);
  if (nombre && exp.cliente !== nombre) {
    exp.cliente = nombre;
    modificado = true;
  }

  const destino = extraerDestino(texto);
  if (destino && exp.destino !== destino) {
    exp.destino = destino;
    modificado = true;
  }

  const matchPax = texto.match(/(\d+)\s*(?:personas?|pax|viajeros?|adultos?|integrantes)/i);
  if (matchPax && matchPax[1]) {
    exp.pasajeros = parseInt(matchPax[1], 10);
    modificado = true;
  } else if (/\bpareja\b/.test(t)) {
    exp.pasajeros = 2;
    modificado = true;
  }

  const matchDias = texto.match(/(\d+)\s*d[ií]as?/i);
  if (matchDias && matchDias[1]) {
    exp.dias = parseInt(matchDias[1], 10);
    flujoItinerario.dias = exp.dias;
    modificado = true;
  }

  const matchNoches = texto.match(/(\d+)\s*noches?/i);
  if (matchNoches && matchNoches[1]) {
    exp.noches = parseInt(matchNoches[1], 10);
    modificado = true;
  }

  if (/\b(mochiler[oa]|barato|economic[oa]|bajo)\b/.test(t)) {
    exp.presupuesto = 'Económico';
    modificado = true;
  } else if (/\b(lujo|premium|alto|todo incluido)\b/.test(t)) {
    exp.presupuesto = 'Alto / Todo Incluido';
    modificado = true;
  } else if (/\b(medio|normal|estandar|confort)\b/.test(t)) {
    exp.presupuesto = 'Medio';
    modificado = true;
  }

  if (modificado) {
    guardarExpedientesStorage();
    actualizarBarraClienteActivo();
    renderizarListaDrawer(searchClientInput ? searchClientInput.value : '');
  }
}

// Resumen de expedientes + cliente activo para la memoria de la IA
function construirContextoMemoriaClientes() {
  const previos = expedientes
    .filter(e => e.cliente !== 'Nueva Consulta')
    .slice(0, 15)
    .map(e => `- Cliente: ${e.cliente} | Destino: ${e.destino} | Pasajeros: ${e.pasajeros} | Presupuesto: ${e.presupuesto} | Fecha: ${e.fecha}`)
    .join('\n');
  let ctx = previos ? `[EXPEDIENTES GUARDADOS EN LA AGENCIA]:\n${previos}` : 'No hay clientes registrados previamente.';

  const exp = expedienteActual;
  if (exp) {
    ctx += `\n\n[CONSULTA ACTIVA]: Cliente: ${exp.cliente} | Destino: ${exp.destino} | Pasajeros: ${exp.pasajeros} | Presupuesto: ${exp.presupuesto}`;
    if (exp.ultimoItinerario) {
      ctx += ` | Ya existe una propuesta de ${exp.ultimoItinerario.dias} día(s) en ${exp.ultimoItinerario.destino}.`;
    }
  }
  return ctx;
}

// Búsqueda en memoria local cuando el agente pregunta por un cliente previo
function consultarMemoriaLocal(texto) {
  const tNorm = normalizar(texto);
  const esPreguntaMemoria = /acuerdas|recuerdas|cliente\s+anterior|expediente|tienes\s+a\s+fulanit|datos\s+de/i.test(tNorm);
  if (!esPreguntaMemoria) return null;

  for (const exp of expedientes) {
    if (exp.cliente === 'Nueva Consulta') continue;
    const partes = normalizar(exp.cliente).split(/\s+/);
    const coincide = partes.some(p => p.length > 2 && tNorm.includes(p));

    if (coincide) {
      let respuesta = `<p>¡Sí, colega asesor! Tengo el expediente de <strong>${esc(exp.cliente)}</strong>:</p>`;
      respuesta += `<div class="itin-card">
        <b>Ficha de Expediente: ${esc(exp.cliente)}</b>
        <div class="itin-slot"><em>Destino</em><span>${esc(exp.destino)}</span></div>
        <div class="itin-slot"><em>Viajeros</em><span>${esc(exp.pasajeros)} persona(s)</span></div>
        <div class="itin-slot"><em>Presupuesto</em><span>${esc(exp.presupuesto)}</span></div>
        <div class="itin-slot"><em>Registro</em><span>${esc(exp.fechaCompleta || exp.fecha)}</span></div>
      </div>`;

      if (exp.ultimoItinerario) {
        respuesta += `<p>Tenemos guardada una propuesta de <strong>${esc(exp.ultimoItinerario.dias)} días</strong> en ${esc(exp.ultimoItinerario.destino || exp.destino)}.</p>`;
        respuesta += `<button type="button" class="btn-download-pdf" onclick="descargarPdfExpediente('${esc(exp.id)}')">
          Descargar PDF de ${esc(exp.cliente)}
        </button>`;
      } else {
        respuesta += `<p>¿Deseas que armemos el itinerario detallado o modifiquemos las fechas para este cliente?</p>`;
      }
      return respuesta;
    }
  }
  return `<p>Revisé los expedientes de la agencia pero no encontré coincidencias exactas con ese nombre. Abre el botón <strong>Bitácora</strong> para ver la lista completa de clientes registrados.</p>`;
}

/* ==========================================================================
   4. DRAWER DE HISTORIAL Y EXPEDIENTES
   ========================================================================== */
function renderizarListaDrawer(filtro = '') {
  if (!dossierListEl) return;
  dossierListEl.innerHTML = '';

  const q = filtro.toLowerCase().trim();
  const filtrados = expedientes.filter(exp => {
    if (esExpedienteVacio(exp)) return false;
    if (!q) return true;
    return exp.cliente.toLowerCase().includes(q) || exp.destino.toLowerCase().includes(q);
  });

  if (filtrados.length === 0) {
    dossierListEl.innerHTML = `
      <div class="drawer-empty">
        <p>No se encontraron expedientes ${filtro ? 'para "' + esc(filtro) + '"' : 'guardados aún'}.</p>
        <p style="margin-top: 6px; font-size: 11px;">Escribe una consulta con el nombre de tu cliente para registrarlo automáticamente.</p>
      </div>
    `;
    return;
  }

  filtrados.forEach(exp => {
    const card = document.createElement('div');
    card.className = `dossier-card ${expedienteActual && expedienteActual.id === exp.id ? 'active' : ''}`;

    const tienePdf = Boolean(exp.ultimoItinerario);
    const nombreVisible = exp.cliente === 'Nueva Consulta' ? 'Cliente sin nombre' : exp.cliente;
    card.innerHTML = `
      <div class="dossier-head">
        <span class="dossier-name">${esc(nombreVisible)}</span>
        <span class="dossier-date">${esc(exp.fecha)}</span>
      </div>
      <div class="dossier-meta">
        <span class="dossier-badge">${esc(exp.destino)}</span>
        <span class="dossier-badge">${esc(exp.pasajeros)} viajero(s)</span>
        <span class="dossier-badge">${esc(exp.presupuesto)}</span>
      </div>
      <div class="dossier-footer">
        ${tienePdf ? `<button type="button" class="btn-dossier-action btn-dossier-pdf" title="Descargar PDF">PDF</button>` : ''}
        <button type="button" class="btn-dossier-action btn-dossier-open" title="Cargar conversación">Abrir</button>
        <button type="button" class="btn-dossier-action btn-dossier-delete" title="Eliminar registro">✕</button>
      </div>
    `;

    card.querySelector('.btn-dossier-open').addEventListener('click', (e) => {
      e.stopPropagation();
      cargarExpediente(exp.id);
      cerrarDrawer();
    });

    card.addEventListener('click', () => {
      cargarExpediente(exp.id);
      cerrarDrawer();
    });

    const pdfBtn = card.querySelector('.btn-dossier-pdf');
    if (pdfBtn) {
      pdfBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        descargarPdfExpediente(exp.id);
      });
    }

    card.querySelector('.btn-dossier-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`¿Eliminar el expediente de "${nombreVisible}"?`)) {
        eliminarExpediente(exp.id);
      }
    });

    dossierListEl.appendChild(card);
  });
}

function abrirDrawer() {
  drawerEl.classList.add('open');
  drawerOverlayEl.classList.add('open');
  renderizarListaDrawer(searchClientInput ? searchClientInput.value : '');
}

function cerrarDrawer() {
  drawerEl.classList.remove('open');
  drawerOverlayEl.classList.remove('open');
}

function cargarExpediente(id) {
  const exp = expedientes.find(e => e.id === id);
  if (!exp) return;

  expedienteActual = exp;
  ultimoItinerarioGenerado = exp.ultimoItinerario || null;
  flujoItinerario = flujoInicial();
  if (exp.dias) flujoItinerario.dias = exp.dias;
  actualizarBarraClienteActivo();

  chatEl.innerHTML = '';
  if (exp.historial && exp.historial.length > 0) {
    exp.historial.forEach(m => {
      const texto = m.parts ? m.parts[0].text : (m.text || m.html || '');
      if (m.role === 'user') {
        renderMensajeUI('user', texto, false, false, false);
      } else {
        // Compatibilidad con entradas antiguas que no guardaban el formato
        const esHTML = typeof m.html === 'boolean' ? m.html : /<\/?[a-z][\s\S]*>/i.test(texto);
        renderMensajeUI('bot', texto, false, esHTML, false);
      }
    });
  } else {
    mostrarMensajeBienvenida(exp.cliente !== 'Nueva Consulta' ? exp.cliente : null);
  }

  renderizarChipsPrincipales();
  renderizarListaDrawer(searchClientInput ? searchClientInput.value : '');
}

function crearNuevoExpediente() {
  // Descarta consultas vacías para que no se acumulen al recargar
  expedientes = expedientes.filter(e => !esExpedienteVacio(e));
  expedienteActual = nuevoExpedienteVacio();
  expedientes.unshift(expedienteActual);
  guardarExpedientesStorage();

  ultimoItinerarioGenerado = null;
  flujoItinerario = flujoInicial();

  chatEl.innerHTML = '';
  mostrarMensajeBienvenida();
  actualizarBarraClienteActivo();
  renderizarChipsPrincipales();
  renderizarListaDrawer(searchClientInput ? searchClientInput.value : '');
  cerrarDrawer();
  inputEl.focus();
}

function eliminarExpediente(id) {
  const eraActual = expedienteActual && expedienteActual.id === id;
  expedientes = expedientes.filter(e => e.id !== id);
  guardarExpedientesStorage();

  if (eraActual) {
    expedienteActual = null;
    crearNuevoExpediente();
  } else {
    renderizarListaDrawer(searchClientInput ? searchClientInput.value : '');
  }
}

/* ==========================================================================
   5. GENERACIÓN DE PDF CON jsPDF
   ========================================================================== */
function construirDocumentoPdf(it, datosCliente) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 44;
  const CW = W - M * 2;
  let y = 0;

  // jsPDF con fuentes estándar solo admite Latin-1: se normalizan comillas,
  // viñetas y guiones tipográficos antes de descartar lo no soportado.
  const limpio = s => String(s || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2022/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[^\u0020-\u00FF]/g, '');

  const asegurar = h => {
    if (y + h > H - 55) {
      doc.addPage();
      y = M + 15;
    }
  };

  const partir = (txt, ancho, tam, fuente = 'normal') => {
    doc.setFont('helvetica', fuente);
    doc.setFontSize(tam);
    return doc.splitTextToSize(limpio(txt), ancho);
  };

  const escribir = (txt, x, ancho, tam, fuente, color, interlineado) => {
    const lineas = partir(txt, ancho, tam, fuente);
    doc.setTextColor(...color);
    lineas.forEach(l => {
      asegurar(interlineado);
      doc.setFont('helvetica', fuente);
      doc.setFontSize(tam);
      doc.text(l, x, y);
      y += interlineado;
    });
  };

  const tituloSeccion = t => {
    asegurar(40);
    doc.setTextColor(196, 69, 54);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.5);
    doc.text(limpio(t), M, y);
    y += 6;
    doc.setDrawColor(217, 164, 65);
    doc.setLineWidth(1.2);
    doc.line(M, y, W - M, y);
    y += 14;
  };

  // Encabezado tipo pase de abordar
  doc.setFillColor(18, 48, 59);
  doc.rect(0, 0, W, 110, 'F');
  doc.setFillColor(196, 69, 54);
  doc.rect(0, 110, W, 4, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.text('vIAje - Pase de Itinerario Turístico', M, 48);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  const nombreC = datosCliente && datosCliente.cliente !== 'Nueva Consulta' ? datosCliente.cliente : 'Viajero';
  const destinoPdf = it.destino || (datosCliente && datosCliente.destino) || 'México';
  doc.text(limpio(`Propuesta preparada para: ${nombreC}  |  Destino: ${destinoPdf}`), M, 68);

  doc.setFontSize(9.5);
  doc.setTextColor(244, 238, 221);
  const pax = datosCliente ? datosCliente.pasajeros : 1;
  const estilo = it.estiloEtiqueta || 'Recomendado';
  const pres = it.presupuestoEtiqueta || (datosCliente ? datosCliente.presupuesto : 'Medio');
  doc.text(limpio(`Duración: ${it.dias} día(s)  |  Viajeros: ${pax} pax  |  Estilo: ${estilo}  |  Presupuesto: ${pres}`), M, 86);
  doc.text(limpio(`Fecha de emisión: ${obtenerFechaCompleta()}  |  Asesor: vIAje Suite`), M, 99);

  y = 138;

  // Bloques día por día
  if (it.bloques && it.bloques.length > 0) {
    it.bloques.forEach((b, i) => {
      const filas = [
        ['Mañana', b.manana],
        ['Tarde', b.tarde],
        ['Noche', b.noche]
      ];
      const anchoTexto = CW - 80;
      const altos = filas.map(([, t]) => partir(t, anchoTexto, 10).length * 13 + 5);
      const altoTotalBloque = 28 + altos.reduce((a, c) => a + c, 0) + 8;

      asegurar(altoTotalBloque);

      doc.setFillColor(242, 232, 201);
      doc.roundedRect(M, y - 14, CW, 22, 4, 4, 'F');
      doc.setTextColor(18, 48, 59);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11.5);
      doc.text(limpio(`DÍA ${i + 1}: ${b.titulo || 'Actividades Recomendadas'}`), M + 8, y + 1);
      y += 20;

      filas.forEach(([etiqueta, texto]) => {
        if (!texto) return;
        doc.setTextColor(196, 69, 54);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.text(limpio(etiqueta + ':'), M + 8, y);

        doc.setTextColor(36, 31, 22);
        doc.setFont('helvetica', 'normal');
        partir(texto, anchoTexto, 9.5).forEach(l => {
          asegurar(13);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9.5);
          doc.setTextColor(36, 31, 22);
          doc.text(l, M + 70, y);
          y += 13;
        });
        y += 4;
      });
      y += 8;
    });
  }

  if (it.hospedaje) {
    tituloSeccion('Hospedaje Recomendado');
    escribir(it.hospedaje, M, CW, 10, 'normal', [36, 31, 22], 13.5);
    y += 10;
  }

  if (it.comida) {
    tituloSeccion('Gastronomía y Restaurantes');
    escribir(it.comida, M, CW, 10, 'normal', [36, 31, 22], 13.5);
    y += 10;
  }

  if (it.notas && it.notas.length > 0) {
    tituloSeccion('Tips de Logística y Seguridad');
    it.notas.forEach(n => {
      escribir('-  ' + n, M, CW, 9.5, 'normal', [36, 31, 22], 13);
      y += 2;
    });
    y += 10;
  }

  // Pie de página y numeración
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(217, 164, 65);
    doc.setLineWidth(0.8);
    doc.line(M, H - 38, W - M, H - 38);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 95, 85);
    doc.text(limpio('vIAje · Suite para Agente de Viajes. Las tarifas y horarios pueden variar; verifica disponibilidad antes de reservar.'), M, H - 24);
    doc.text(limpio(`Página ${p} de ${total}`), W - M, H - 24, { align: 'right' });
  }

  return doc;
}

function descargarPdfExpediente(id) {
  const exp = expedientes.find(e => e.id === id);
  if (!exp || !exp.ultimoItinerario) {
    alert('No hay un itinerario generado para este expediente aún.');
    return;
  }
  if (!window.jspdf) {
    alert('La herramienta jsPDF no se encuentra disponible. Revisa tu conexión a internet.');
    return;
  }
  const nombreLimpio = (exp.cliente || 'Viajero').replace(/\s+/g, '_');
  const destLimpio = (exp.ultimoItinerario.destino || exp.destino || 'Destino').replace(/[^\wÁÉÍÓÚáéíóúñÑ]+/g, '_');
  const doc = construirDocumentoPdf(exp.ultimoItinerario, exp);
  doc.save(`Itinerario_${nombreLimpio}_${destLimpio}_vIAje.pdf`);
}

function descargarPdfActual() {
  if (!ultimoItinerarioGenerado) {
    alert('Primero formula o selecciona un itinerario para poder descargarlo en PDF.');
    return;
  }
  const exp = obtenerOCrearExpedienteActual();
  descargarPdfExpediente(exp.id);
}

window.descargarPdfExpediente = descargarPdfExpediente;
window.descargarPdfActual = descargarPdfActual;

/* ==========================================================================
   6. BASE DE CONOCIMIENTO Y MOTOR LOCAL DE ITINERARIOS (SIN API KEY)
   ========================================================================== */
const ESTILOS = {
  relax:    { etiqueta: 'Relax y Descanso',        prompt: 'ritmo tranquilo, descanso, bienestar y paseos suaves' },
  aventura: { etiqueta: 'Aventura y Naturaleza',   prompt: 'aventura, naturaleza y actividades al aire libre' },
  fiesta:   { etiqueta: 'Vida Nocturna',           prompt: 'vida nocturna, música en vivo y gastronomía social' },
  mix:      { etiqueta: 'Completo / Mix',          prompt: 'mezcla equilibrada de cultura, gastronomía, naturaleza y descanso' }
};

const BLOQUES_CABOS = {
  clasico: {
    titulo: 'Cabo San Lucas Clásico y El Arco',
    manana: 'Paseo en lancha o taxi acuático al Arco, pasando por Playa del Amor y la colonia de lobos marinos.',
    tarde: 'Tiempo libre en Playa El Médano para disfrutar del mar, gastronomía de playa y actividades acuáticas.',
    noche: 'Cena de tacos de mariscos en el centro o Paseo de la Marina, seguido de una caminata por el malecón.'
  },
  snorkel: {
    titulo: 'Snorkel en el Corredor Turístico',
    manana: 'Visita temprana a Bahía Chileno y Playa Santa María (ambas Blue Flag). Menor oleaje antes de las 10:30 am.',
    tarde: 'Regreso y descanso en el hotel; tarde libre para piscina o compras de artesanías locales.',
    noche: 'Cena relajada en San José del Cabo disfrutando de su ambiente bohemio.'
  },
  relax: {
    titulo: 'Día de Sol y Desconexión',
    manana: 'Playa Palmilla: aguas muy calmadas, ideal para nadar y relajarse bajo sombrilla.',
    tarde: 'Almuerzo frente al mar en una palapa local y caminata al atardecer.',
    noche: 'Cena tranquila en una terraza al aire libre.'
  },
  sjc: {
    titulo: 'Cultura y Galerías en San José del Cabo',
    manana: 'Recorrido a pie por la plaza central, la misión histórica y boutiques de diseño local.',
    tarde: 'Almuerzo en patio colonial y visita a galerías de arte contemporáneo.',
    noche: 'Si es jueves (nov-jun): Art Walk con vino y música en vivo. Si no, cena en restaurante de autor.'
  },
  todos: {
    titulo: 'Excursión al Pueblo Mágico de Todos Santos',
    manana: 'Ruta hacia la costa del Pacífico (a 1 hora de Cabo San Lucas). Parada en el icónico Hotel California.',
    tarde: 'Recorrido por calles empedradas, galerías y comida orgánica en huertos locales.',
    noche: 'Regreso a Cabo San Lucas y cena ligera.'
  },
  pulmo: {
    titulo: 'Parque Nacional Marino Cabo Pulmo',
    manana: 'Salida temprano en vehículo hacia Cabo Pulmo (unas 2 horas). Snorkel guiado en el arrecife vivo.',
    tarde: 'Comida de mariscos frescos en el pueblo de pescadores y descanso frente al Mar de Cortés.',
    noche: 'Regreso a la ciudad.'
  },
  fiesta: {
    titulo: 'Experiencia Nocturna y Gastronómica',
    manana: 'Mañana libre para descansar y disfrutar las amenidades del hotel.',
    tarde: 'Atardecer con música en vivo o jazz sobre los riscos con vista al Pacífico.',
    noche: 'Recorrido por lugares emblemáticos del centro como Cabo Wabo, Mandala o El Squid Roe.'
  }
};

const ORDENES_ESTILO = {
  relax: ['clasico', 'snorkel', 'relax', 'sjc', 'todos', 'pulmo', 'fiesta'],
  aventura: ['clasico', 'snorkel', 'pulmo', 'todos', 'sjc', 'relax', 'fiesta'],
  fiesta: ['clasico', 'fiesta', 'snorkel', 'sjc', 'todos', 'pulmo', 'relax'],
  mix: ['clasico', 'snorkel', 'fiesta', 'sjc', 'todos', 'pulmo', 'relax']
};

const DATOS_PRESUPUESTO = {
  mochi: {
    etiqueta: 'Económico / Mochilero',
    hospedaje: 'Hostales en el centro de Cabo San Lucas (Sofia Hostel, Casa Luna Bonita) u hoteles familiares cercanos al centro.',
    comida: 'Taquerías tradicionales y mercados: Tacos Gardenias, La Taquiza Centro, Los Tacos Guss y mariscos de carreta.'
  },
  medio: {
    etiqueta: 'Medio / Confort',
    hospedaje: 'Hoteles 3 y 4 estrellas: Siesta Suites Hotel, Hotel Maria Elena o suites frente a la marina.',
    comida: 'Mezcla de cocina tradicional con una cena especial en Metate Cabo (Bib Gourmand MICHELIN) o restaurantes frente al mar.'
  },
  todo: {
    etiqueta: 'Todo Incluido / Lujo',
    hospedaje: 'Resorts de categoría mundial: Casa Dorada Los Cabos frente a Playa El Médano, Grand Velas, Waldorf Astoria Los Cabos Pedregal o Hard Rock.',
    comida: 'Restaurantes gourmet del resort, alta cocina maridada con vinos de Baja California y experiencias privadas de chef.'
  }
};

const NOTAS_GENERALES = [
  'Temporada de huracanes: 15 de mayo al 30 de noviembre; se recomienda seguro de viaje.',
  'Avistamiento de ballenas jorobadas: de diciembre a abril (pico enero a marzo).',
  'Aeropuerto SJD en San José del Cabo: prever 45 minutos de traslado a Cabo San Lucas.',
  'En Playa del Amor solo nadar en el Mar de Cortés; Playa del Divorcio (Pacífico) es peligrosa.',
  'Tarifas y cupos sujetos a disponibilidad al momento de reservar.'
];

const BLOQUES_POR_DESTINO = {
  cdmx: {
    nombre: 'Ciudad de México (CDMX)',
    bloques: [
      {
        titulo: 'Centro Histórico, Zócalo y Palacio de Bellas Artes',
        manana: 'Visita guiada a la Catedral Metropolitana, el Zócalo y recorrido arqueológico del Templo Mayor.',
        tarde: 'Paseo peatonal por calle Madero, Palacio de Bellas Artes y la Alameda Central con parada en Casa de los Azulejos.',
        noche: 'Cena de tacos al pastor tradicionales en El Farolito o El Huequito, y recorrido bohemio por la Roma Norte.'
      },
      {
        titulo: 'Bosque de Chapultepec, Antropología y Polanco',
        manana: 'Visita al Castillo de Chapultepec y recorrido por el Museo Nacional de Antropología (Sala Mexica y Maya).',
        tarde: 'Caminata por Paseo de la Reforma, fotografía en el Ángel de la Independencia y café o compras en Polanco.',
        noche: 'Cena en restaurante contemporáneo de Polanco o terrazas gourmet en Masaryk.'
      },
      {
        titulo: 'Coyoacán Colonial, Museo Frida Kahlo y Trajineras de Xochimilco',
        manana: 'Visita a la Casa Azul (Museo Frida Kahlo) y paseo por la Plaza Hidalgo en el centro de Coyoacán.',
        tarde: 'Paseo en trajinera tradicional por los canales de Xochimilco con mariachis y antojitos a bordo.',
        noche: 'Mercado de artesanías de La Ciudadela y cena de antojitos en el centro de Coyoacán.'
      },
      {
        titulo: 'Zona Arqueológica de Teotihuacán',
        manana: 'Excursión guiada temprano a las Pirámides del Sol y de la Luna en Teotihuacán y calzada de los muertos.',
        tarde: 'Comida campestre en el famoso restaurante La Gruta. Regreso a la ciudad.',
        noche: 'Noche de espectáculo en el Teatro de la Ciudad o función cultural.'
      }
    ],
    hospedaje: 'Hoteles recomendados: Gran Hotel de la Ciudad de México (Centro Histórico), Hotel Geneve (Juárez) o Hyatt Regency / W Mexico City (Polanco).',
    comida: 'Tacos al pastor, churros en El Moro, cocina de autor en Roma/Condesa, pozole en La Casa de Toño y mercados tradicionales.',
    notas: [
      'Transporte: Recomienda Uber o transporte privado de agencia; evitar taxis de calle no regulados.',
      'Boletos anticipados: Comprar accesos a la Casa Azul (Frida Kahlo) con semanas de anticipación en línea.',
      'Clima: En época de lluvias (junio a septiembre) llevar impermeable ligero para las tardes.'
    ]
  },
  cancun: {
    nombre: 'Cancún / Riviera Maya',
    bloques: [
      {
        titulo: 'Playas del Caribe y Zona Hotelera',
        manana: 'Playa Delfines (Mirador con las letras de Cancún) y paseo en catamarán por la bahía.',
        tarde: 'Snorkel guiado en el Arrecife de Punta Nizuc y visita al Museo Subacuático (MUSA).',
        noche: 'Cena frente a la Laguna Nichupté con mariscos caribeños y atardecer tropical.'
      },
      {
        titulo: 'Excursión a Isla Mujeres en Catamarán',
        manana: 'Navegación todo incluido a Isla Mujeres con barra libre y parada de snorkel.',
        tarde: 'Carrito de golf por Punta Sur y tiempo de nado en la icónica Playa Norte.',
        noche: 'Regreso a Cancún y cena en Puerto Cancún o paseo por la zona hotelera.'
      },
      {
        titulo: 'Cenotes y Parque Ecoturístico',
        manana: 'Ruta de los Cenotes en Puerto Morelos: nado en cenote abierto y caverna subterránea.',
        tarde: 'Tirolesas y recorrido en cuatrimoto en la selva maya.',
        noche: 'Cena de tacos de cochinita pibil y pescado tikin-xic en el centro de Cancún.'
      }
    ],
    hospedaje: 'Resorts All-Inclusive en Zona Hotelera (Riu, Hard Rock, Moon Palace) o boutique en Puerto Morelos.',
    comida: 'Pescado a la tikin-xic, ceviche mixto caribeño, marquesitas y cochinita pibil.',
    notas: [
      'Traslados: Contratar transfer privado desde el Aeropuerto de Cancún antes de la llegada.',
      'Bloqueador: Usar únicamente bloqueador solar biodegradable para proteger arrecifes y cenotes.'
    ]
  },
  oaxaca: {
    nombre: 'Oaxaca',
    bloques: [
      {
        titulo: 'Centro Histórico, Santo Domingo y Mercados',
        manana: 'Templo de Santo Domingo de Guzmán y Museo de las Culturas de Oaxaca.',
        tarde: 'Comida en el Mercado 20 de Noviembre ("Pasillo de Humo": tasajo, cecina y chorizo).',
        noche: 'Cata de mezcal artesanal en mezcalería tradicional del centro histórico.'
      },
      {
        titulo: 'Monte Albán y Cuna de los Alebrijes',
        manana: 'Zona Arqueológica de Monte Albán con vista panorámica de los Valles Centrales.',
        tarde: 'Talleres de artesanos en San Martín Tilcajete (elaboración de alebrijes).',
        noche: 'Cena de tlayudas con mole negro y chocolate oaxaqueño.'
      },
      {
        titulo: 'Hierve el Agua y Árbol del Tule',
        manana: 'Visita al milenario Árbol del Tule y cascadas petrificadas de Hierve el Agua.',
        tarde: 'Talleres de tejido en telar de cintura en Teotitlán del Valle.',
        noche: 'Paseo nocturno por el Zócalo y música tradicional en vivo.'
      }
    ],
    hospedaje: 'Hoteles boutique coloniales: Quinta Real Oaxaca, Hotel Los Amantes o Hotel Victoria.',
    comida: 'Mole negro, tlayudas, tasajo, chapulines, quesillo y mezcal de maguey silvestre.',
    notas: ['Calzado cómodo para caminar en calles empedradas y ruinas arqueológicas.']
  }
};

function armarItinerarioObjeto(dias, estilo, presupuestoClave, destino = 'Los Cabos') {
  const destNorm = normalizar(destino);
  const presInfo = DATOS_PRESUPUESTO[presupuestoClave] || DATOS_PRESUPUESTO.medio;
  let pack = null;
  let generico = false;

  if (/^ciudad de mexico|cdmx/.test(destNorm)) {
    pack = BLOQUES_POR_DESTINO.cdmx;
  } else if (/quintana roo|cancun|riviera maya|tulum/.test(destNorm)) {
    pack = BLOQUES_POR_DESTINO.cancun;
  } else if (/^oaxaca/.test(destNorm)) {
    pack = BLOQUES_POR_DESTINO.oaxaca;
  } else if (/baja california sur|cabo/.test(destNorm) || !destino || destino === 'Por definir') {
    const ids = ORDENES_ESTILO[estilo] || ORDENES_ESTILO.mix;
    pack = {
      nombre: 'Los Cabos',
      bloques: ids.map(id => BLOQUES_CABOS[id] || BLOQUES_CABOS.clasico),
      hospedaje: presInfo.hospedaje,
      comida: presInfo.comida,
      notas: NOTAS_GENERALES
    };
  } else {
    // Plantilla general para el resto de los estados (sin lugares específicos)
    generico = true;
    pack = {
      nombre: destino,
      bloques: [
        {
          titulo: `Llegada, Centro Histórico y Reconocimiento de ${destino}`,
          manana: `Llegada y traslado al hotel. Registro y primer recorrido por la plaza principal de ${destino}.`,
          tarde: 'Paseo a pie por monumentos históricos, catedral y principales atractivos culturales.',
          noche: 'Cena de bienvenida en restaurante tradicional degustando gastronomía local.'
        },
        {
          titulo: `Sitios Emblemáticos y Cultura en ${destino}`,
          manana: 'Visita guiada a museos y sitios emblemáticos representativos del estado.',
          tarde: 'Tiempo libre para recorrer mercados de artesanías típicas y miradores panorámicos.',
          noche: 'Experiencia gastronómica o velada cultural en el centro histórico.'
        },
        {
          titulo: 'Naturaleza, Pueblos Mágicos y Alrededores',
          manana: `Excursión a parajes naturales o pueblos pintorescos cercanos a ${destino}.`,
          tarde: 'Comida campestre o en restaurante regional con tiempo para fotografía y artesanías.',
          noche: 'Cena de gala y paseo relajado.'
        },
        {
          titulo: 'Experiencias Complementarias y Despedida',
          manana: 'Actividades matutinas opcionales según el perfil del cliente (aventura, gastronomía o descanso).',
          tarde: 'Tarde libre para compras finales y disfrute de amenidades del hotel.',
          noche: 'Cena de despedida y preparación de logística para el viaje de regreso.'
        }
      ],
      hospedaje: `Hoteles céntricos 4 y 5 estrellas seleccionados según presupuesto en ${destino}.`,
      comida: `Platillos típicos regionales y restaurantes de alta recomendación en ${destino}.`,
      notas: [
        `Verificar requerimientos de transporte interno y transfer aeropuerto en ${destino}.`,
        'Revisar pronóstico del clima para sugerir el equipaje y calzado más adecuado.'
      ]
    };
  }

  // Sin repetir días: no se generan más días que bloques únicos disponibles
  const solicitados = Math.min(Math.max(dias || 3, 1), 7);
  const numDias = Math.min(solicitados, pack.bloques.length);
  const bloquesFinales = pack.bloques.slice(0, numDias).map(b => ({
    titulo: b.titulo, manana: b.manana, tarde: b.tarde, noche: b.noche
  }));

  return {
    dias: numDias,
    diasSolicitados: solicitados,
    destino: pack.nombre || destino,
    estiloEtiqueta: (ESTILOS[estilo] || ESTILOS.mix).etiqueta,
    presupuestoEtiqueta: presInfo.etiqueta,
    bloques: bloquesFinales,
    hospedaje: pack.hospedaje || presInfo.hospedaje,
    comida: pack.comida || presInfo.comida,
    notas: pack.notas || NOTAS_GENERALES,
    generico
  };
}

/* ==========================================================================
   7. GEMINI: LLAMADAS A LA API E ITINERARIOS GENERADOS POR IA
   ========================================================================== */
function mensajeErrorGemini(status, data) {
  const msg = (data && data.error && data.error.message) || '';
  if (status === 400 && /api key/i.test(msg)) return 'La API Key no es válida.';
  if (status === 401 || status === 403) return 'La API Key fue rechazada o no tiene permiso. Revísala en ⚙️.';
  if (status === 404) return `El modelo "${geminiModel}" no existe o fue retirado. Cambia el modelo en ⚙️.`;
  if (status === 429) return 'Se alcanzó el límite de uso de la API. Espera un momento o revisa tu cuota.';
  if (status >= 500) return 'El servicio de Gemini no está disponible por ahora.';
  return msg || `Error ${status} al conectar con Gemini.`;
}

async function llamarGemini({ sistema, contenidos, json = false, schema = null }) {
  const body = {
    system_instruction: { parts: [{ text: sistema }] },
    contents: contenidos
  };
  if (json) {
    body.generationConfig = { responseMimeType: 'application/json' };
    if (schema) body.generationConfig.responseSchema = schema;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(geminiModel)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError'
      ? 'Gemini tardó demasiado en responder.'
      : 'No hay conexión con la API de Gemini.');
  } finally {
    clearTimeout(timer);
  }

  let data = {};
  try { data = await res.json(); } catch (_) { /* respuesta sin JSON */ }
  if (!res.ok) throw new Error(mensajeErrorGemini(res.status, data));

  if (data.promptFeedback && data.promptFeedback.blockReason) {
    throw new Error('Gemini bloqueó la solicitud (' + data.promptFeedback.blockReason + ').');
  }
  const cand = data.candidates && data.candidates[0];
  const partes = (cand && cand.content && cand.content.parts) || [];
  const texto = partes.filter(p => !p.thought).map(p => p.text || '').join('').trim();
  if (!texto) {
    throw new Error('Gemini devolvió una respuesta vacía' + (cand && cand.finishReason ? ` (${cand.finishReason}).` : '.'));
  }
  return texto;
}

const SCHEMA_ITINERARIO = {
  type: 'OBJECT',
  properties: {
    destino: { type: 'STRING' },
    bloques: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          titulo: { type: 'STRING' },
          manana: { type: 'STRING' },
          tarde: { type: 'STRING' },
          noche: { type: 'STRING' }
        },
        required: ['titulo', 'manana', 'tarde', 'noche']
      }
    },
    hospedaje: { type: 'STRING' },
    comida: { type: 'STRING' },
    notas: { type: 'ARRAY', items: { type: 'STRING' } }
  },
  required: ['destino', 'bloques', 'hospedaje', 'comida', 'notas']
};

function construirPromptItinerario({ exp, dias, estilo, presupuestoClave, destino, instruccion, previo }) {
  const est = ESTILOS[estilo] || ESTILOS.mix;
  const pres = DATOS_PRESUPUESTO[presupuestoClave] || DATOS_PRESUPUESTO.medio;
  const nombre = exp.cliente && exp.cliente !== 'Nueva Consulta' ? exp.cliente : 'no especificado';

  const lineas = [
    previo
      ? 'Modifica el itinerario existente (al final) siguiendo la instrucción del agente. Conserva lo que no se pida cambiar. Si el destino cambió, genera el itinerario nuevo para ese destino.'
      : 'Genera un itinerario completo para presentar a un cliente de la agencia.',
    '',
    `Cliente: ${nombre}`,
    `Destino: ${destino}`,
    `Duración: exactamente ${dias} día(s). El arreglo "bloques" debe tener ${dias} elemento(s), uno por día y en orden.`,
    exp.noches ? `Noches de hospedaje: ${exp.noches}` : null,
    `Viajeros: ${exp.pasajeros || 1}`,
    `Estilo de viaje: ${est.prompt}`,
    `Presupuesto: ${pres.etiqueta}`,
    instruccion ? `Instrucción del agente: ${instruccion}` : null,
    '',
    'Requisitos:',
    '- Usa únicamente lugares, restaurantes y hoteles reales del destino; si no estás seguro de que un lugar existe, no lo incluyas.',
    '- No inventes precios exactos ni horarios de apertura.',
    '- Respeta la coherencia geográfica (sin playas marinas en destinos sin litoral).',
    '- Cada periodo (mañana, tarde, noche) debe tener de 2 a 4 oraciones con nombres concretos. Sin emojis.',
    '- "titulo": título breve del día. "destino": nombre del estado o destino principal.',
    '- "hospedaje": 3 opciones reales acordes al presupuesto, con una frase de justificación.',
    '- "comida": 4 a 6 restaurantes o platillos típicos reales.',
    '- "notas": de 4 a 5 consejos de logística y seguridad específicos del destino (traslados, clima, temporada, precauciones).'
  ].filter(l => l !== null);

  if (previo) {
    lineas.push('', 'Itinerario existente (JSON):', JSON.stringify({
      destino: previo.destino, bloques: previo.bloques, hospedaje: previo.hospedaje, comida: previo.comida, notas: previo.notas
    }));
  }
  return lineas.join('\n');
}

async function generarItinerarioConGemini({ exp, dias, estilo, presupuestoClave, destino, instruccion = '', previo = null }) {
  const diasFinal = Math.min(Math.max(dias || 3, 1), 10);
  const prompt = construirPromptItinerario({ exp, dias: diasFinal, estilo, presupuestoClave, destino, instruccion, previo });

  const texto = await llamarGemini({
    sistema: INSTRUCCIONES_SISTEMA,
    contenidos: [{ role: 'user', parts: [{ text: prompt }] }],
    json: true,
    schema: SCHEMA_ITINERARIO
  });

  let data;
  try {
    data = JSON.parse(texto.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim());
  } catch (_) {
    throw new Error('La respuesta de Gemini no tuvo el formato esperado.');
  }
  if (!data || !Array.isArray(data.bloques) || data.bloques.length === 0) {
    throw new Error('Gemini no devolvió los días del itinerario.');
  }

  const bloques = data.bloques.map(b => ({
    titulo: String((b && b.titulo) || 'Actividades recomendadas'),
    manana: String((b && b.manana) || ''),
    tarde: String((b && b.tarde) || ''),
    noche: String((b && b.noche) || '')
  }));
  const pres = DATOS_PRESUPUESTO[presupuestoClave] || DATOS_PRESUPUESTO.medio;

  return {
    dias: bloques.length,
    diasSolicitados: diasFinal,
    destino: String(data.destino || destino),
    estiloEtiqueta: (ESTILOS[estilo] || ESTILOS.mix).etiqueta,
    presupuestoEtiqueta: pres.etiqueta,
    bloques,
    hospedaje: String(data.hospedaje || ''),
    comida: String(data.comida || ''),
    notas: Array.isArray(data.notas) ? data.notas.map(String).filter(Boolean) : [],
    generico: false
  };
}

// Prompt de sistema para chat libre: reglas + memoria de clientes
function construirSistemaChat() {
  return `${INSTRUCCIONES_SISTEMA}\n\n${construirContextoMemoriaClientes()}`;
}

// Convierte el historial guardado al formato de Gemini (texto plano, roles alternados)
function construirContenidosGemini(exp) {
  const brutos = (exp.historial || []).slice(-14).map(h => {
    const raw = (h.parts && h.parts[0] && h.parts[0].text) || h.text || '';
    const esHTML = typeof h.html === 'boolean' ? h.html : /<\/?[a-z][\s\S]*>/i.test(raw);
    let texto = esHTML ? htmlATexto(raw) : String(raw);
    if (texto.length > 1500) texto = texto.slice(0, 1500) + '…';
    return { role: h.role === 'user' ? 'user' : 'model', text: texto };
  }).filter(m => m.text);

  const out = [];
  for (const m of brutos) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.parts[0].text += '\n' + m.text;
    else out.push({ role: m.role, parts: [{ text: m.text }] });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

/* ==========================================================================
   8. RENDERIZADO DE MENSAJES Y CHAT UI
   ========================================================================== */
// Markdown básico (títulos, listas, negritas). Escapa el HTML primero.
function formatearTextoMarkdown(texto) {
  const inline = s => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>');

  let html = '';
  let enLista = false;
  esc(texto).split('\n').forEach(l => {
    const item = l.match(/^\s*[-*•]\s+(.*)$/);
    const enc = l.match(/^\s{0,3}#{1,4}\s+(.*)$/);
    if (item) {
      if (!enLista) { html += '<ul class="bot-list">'; enLista = true; }
      html += `<li>${inline(item[1])}</li>`;
      return;
    }
    if (enLista) { html += '</ul>'; enLista = false; }
    if (enc) html += `<p class="section-label">${inline(enc[1])}</p>`;
    else if (l.trim()) html += `<p>${inline(l)}</p>`;
  });
  if (enLista) html += '</ul>';
  return html;
}

// Pinta un mensaje y, salvo que se indique lo contrario, lo guarda en el historial
function renderMensajeUI(rol, contenido, esError = false, esHTML = false, persistir = true) {
  if (rol === 'bot') ocultarEscribiendo();

  const wrap = document.createElement('div');
  wrap.className = `msg msg--${rol}${esError ? ' error' : ''}`;

  if (rol === 'bot') {
    const stamp = document.createElement('span');
    stamp.className = 'stamp';
    stamp.textContent = STAMP_ICONS[Math.floor(Math.random() * STAMP_ICONS.length)];
    wrap.appendChild(stamp);
  }

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (rol === 'bot') {
    bubble.innerHTML = esHTML ? contenido : formatearTextoMarkdown(contenido);
  } else {
    const p = document.createElement('p');
    p.textContent = contenido;
    bubble.appendChild(p);
  }

  wrap.appendChild(bubble);
  chatEl.appendChild(wrap);

  // Un mensaje largo (itinerario) se muestra desde su inicio, no desde el final
  if (rol === 'bot' && wrap.offsetHeight > chatEl.clientHeight * 0.8) {
    chatEl.scrollTop = wrap.offsetTop - chatEl.offsetTop - 6;
  } else {
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  if (persistir) {
    const exp = obtenerOCrearExpedienteActual();
    exp.historial.push({
      role: rol === 'user' ? 'user' : 'model',
      parts: [{ text: contenido }],
      html: rol === 'bot' ? Boolean(esHTML) : false
    });
    if (exp.historial.length > MAX_HISTORIAL) exp.historial.splice(0, exp.historial.length - MAX_HISTORIAL);
    guardarExpedientesStorage();
  }
  return wrap;
}

function mostrarEscribiendo() {
  if (document.getElementById('typingIndicator')) return;
  const wrap = document.createElement('div');
  wrap.className = 'msg msg--bot typing';
  wrap.id = 'typingIndicator';
  wrap.innerHTML = `
    <span class="stamp">✈</span>
    <div class="bubble">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </div>
  `;
  chatEl.appendChild(wrap);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function ocultarEscribiendo() {
  const t = document.getElementById('typingIndicator');
  if (t) t.remove();
}

function setOcupado(ocupado) {
  inputEl.disabled = ocupado;
  sendBtnEl.disabled = ocupado;
  chipsEl.querySelectorAll('.chip').forEach(c => (c.disabled = ocupado));
}

function mostrarMensajeBienvenida(nombre = null) {
  const saludo = nombre
    ? `¡Hola de nuevo, colega asesor! Retomamos la bitácora de <strong>${esc(nombre)}</strong>. ¿Qué deseas consultar o ajustar hoy?`
    : `¡Hola, viajero! Soy <strong>vIAje</strong>, tu asistente de bitácora turística especializado en los 32 estados de la República Mexicana. Dime qué cliente tienes hoy (nombre, destino, personas, días y presupuesto) y preparo su propuesta e itinerario en PDF.`;
  renderMensajeUI('bot', `<p>${saludo}</p>`, false, true, false);
}

/* ==========================================================================
   9. GENERACIÓN Y PRESENTACIÓN DE ITINERARIOS
   ========================================================================== */
function generarHTMLItinerario(it, nombreCliente, meta = {}) {
  const exp = obtenerOCrearExpedienteActual();
  const cName = nombreCliente && nombreCliente !== 'Nueva Consulta' ? `para <strong>${esc(nombreCliente)}</strong>` : '';
  const nochesTexto = exp.noches ? ` / ${esc(exp.noches)} noches` : '';
  const paxTexto = exp.pasajeros > 1 ? ` para ${esc(exp.pasajeros)} personas` : '';
  const intro = meta.modificado ? 'Listo, colega asesor. Propuesta actualizada' : 'Listo, colega asesor. Aquí tienes la propuesta estructurada';

  let html = `<p>${intro} de <strong>${esc(it.dias)} días${nochesTexto}</strong> en <strong>${esc(it.destino || 'el destino')}</strong> ${cName}${paxTexto} (${esc(it.estiloEtiqueta)}, presupuesto ${esc(it.presupuestoEtiqueta)}):</p>`;

  it.bloques.forEach((b, i) => {
    html += `
      <div class="itin-card">
        <b>Día ${i + 1}: ${esc(b.titulo)}</b>
        <div class="itin-slot"><em>Mañana</em><span>${esc(b.manana)}</span></div>
        <div class="itin-slot"><em>Tarde</em><span>${esc(b.tarde)}</span></div>
        <div class="itin-slot"><em>Noche</em><span>${esc(b.noche)}</span></div>
      </div>
    `;
  });

  html += `
    <div class="itin-card">
      <b>Hospedaje Recomendado</b>
      <p style="font-size: 13px; margin: 0;">${esc(it.hospedaje)}</p>
    </div>
    <div class="itin-card">
      <b>Gastronomía y Restaurantes</b>
      <p style="font-size: 13px; margin: 0;">${esc(it.comida)}</p>
    </div>
    <div class="itin-card">
      <b>Notas Logísticas y Seguridad</b>
      <ul class="bot-list" style="margin-top: 5px;">
        ${(it.notas || []).slice(0, 5).map(n => `<li>${esc(n)}</li>`).join('')}
      </ul>
    </div>
  `;

  // Avisos de origen: siempre se dice qué motor generó la propuesta
  if (meta.origen === 'gemini') {
    html += `<div class="stamp-verification">Propuesta generada con IA (Gemini). Verifica nombres, horarios y tarifas antes de cotizar al cliente.</div>`;
  }
  if (meta.error) {
    html += `<div class="stamp-verification">No se pudo usar Gemini: ${esc(meta.error)} Se muestra la propuesta del motor local.</div>`;
  }
  if (meta.origen !== 'gemini' && it.generico) {
    html += `<div class="stamp-verification">Este destino usa una plantilla general, sin lugares específicos. Activa Gemini en ⚙️ para un itinerario con lugares reales.</div>`;
  }
  if (meta.origen !== 'gemini' && it.diasSolicitados && it.diasSolicitados > it.dias) {
    html += `<div class="stamp-verification">La plantilla local cubre hasta ${esc(it.dias)} día(s) para este destino (pediste ${esc(it.diasSolicitados)}). Con Gemini puedes generar la duración completa.</div>`;
  }

  html += `
    <button type="button" class="btn-download-pdf" onclick="descargarPdfActual()">
      Descargar Itinerario en PDF para el Cliente
    </button>
  `;
  return html;
}

// Genera con Gemini si hay clave; si falla (o no hay clave) usa el motor local
async function producirItinerario({ dias, estilo, presupuesto, destino, instruccion = '', previo = null }) {
  const exp = obtenerOCrearExpedienteActual();
  const presupuestoClave = presupuestoAClave(presupuesto);

  if (apiKey) {
    try {
      const obj = await generarItinerarioConGemini({ exp, dias, estilo, presupuestoClave, destino, instruccion, previo });
      return { obj, origen: 'gemini' };
    } catch (err) {
      console.warn('Falla en Gemini, se usa el motor local:', err.message);
      return {
        obj: armarItinerarioObjeto(dias, estilo, presupuestoClave, destino),
        origen: 'local',
        error: err.message
      };
    }
  }
  return { obj: armarItinerarioObjeto(dias, estilo, presupuestoClave, destino), origen: 'local' };
}

async function generarYMostrarItinerario(params) {
  const exp = obtenerOCrearExpedienteActual();
  setOcupado(true);
  if (apiKey) mostrarEscribiendo();

  try {
    const res = await producirItinerario(params);
    exp.ultimoItinerario = res.obj;
    ultimoItinerarioGenerado = res.obj;
    exp.presupuesto = res.obj.presupuestoEtiqueta;
    exp.dias = res.obj.dias;
    if (res.obj.destino && exp.destino === 'Por definir') exp.destino = res.obj.destino;
    guardarExpedientesStorage();
    actualizarBarraClienteActivo();
    renderizarListaDrawer(searchClientInput ? searchClientInput.value : '');

    renderMensajeUI('bot', generarHTMLItinerario(res.obj, exp.cliente, { ...res, modificado: Boolean(params.previo) }), false, true);
    renderizarChips([
      ['itinerario', 'Nueva Propuesta', true],
      ['tips', 'Logística'],
      ['menu', 'Menú Principal']
    ]);
  } finally {
    ocultarEscribiendo();
    setOcupado(false);
  }
}

/* ==========================================================================
   10. CHIPS INTERACTIVOS Y ASISTENTE GUIADO
   ========================================================================== */
const OPCIONES_MENU_PRINCIPAL = [
  ['itinerario', 'Nueva Propuesta', true],
  ['playas', 'Destinos de Costa'],
  ['cultura', 'Atracciones'],
  ['comida', 'Restaurantes'],
  ['hoteles', 'Alojamiento'],
  ['tips', 'Logística']
];

const DESTINOS_RAPIDOS = [
  ['dest_cancun', 'Cancún / Riviera Maya'],
  ['dest_oaxaca', 'Oaxaca'],
  ['dest_cdmx', 'CDMX'],
  ['dest_cabos', 'Los Cabos'],
  ['dest_yucatan', 'Yucatán'],
  ['dest_jalisco', 'Jalisco']
];

function renderizarChips(lista) {
  chipsEl.innerHTML = '';
  lista.forEach(([clave, texto, esPrincipal], i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chip ${esPrincipal ? 'chip-primary' : ''}`;
    btn.style.setProperty('--r', `${i % 2 === 0 ? -2.5 : 2}deg`);
    btn.textContent = texto;
    btn.addEventListener('click', () => {
      manejarAccionChip(clave, texto).catch(err => console.error('Error en acción de chip:', err));
    });
    chipsEl.appendChild(btn);
  });
}

function renderizarChipsPrincipales() {
  renderizarChips(OPCIONES_MENU_PRINCIPAL);
}

async function manejarAccionChip(clave, texto) {
  autoDetectarDatosCliente(texto);
  renderMensajeUI('user', texto);

  if (clave === 'itinerario') {
    iniciarFlujoItinerario();
  } else if (clave === 'cambiar_destino') {
    pasoFlujoDestino();
  } else if (clave.startsWith('dest_')) {
    if (!extraerDestino(texto)) pasoFlujoDestino('No identifiqué ese destino. ');
    else pasoFlujoDias();
  } else if (/^d[1-7]$/.test(clave)) {
    flujoItinerario.dias = parseInt(clave.slice(1), 10);
    obtenerOCrearExpedienteActual().dias = flujoItinerario.dias;
    pasoFlujoEstilo();
  } else if (clave.startsWith('s_')) {
    flujoItinerario.estilo = clave.slice(2);
    pasoFlujoPresupuesto();
  } else if (clave.startsWith('b_')) {
    flujoItinerario.presupuesto = clave.slice(2);
    await completarFlujoItinerario();
  } else if (['playas', 'comida', 'hoteles', 'cultura', 'tips'].includes(clave)) {
    setOcupado(true);
    try { await responderTema(clave); } finally { ocultarEscribiendo(); setOcupado(false); }
  } else if (clave === 'menu') {
    renderMensajeUI('bot', '<p>¿Qué más necesitas cotizar o planear para tu cliente?</p>', false, true);
    renderizarChipsPrincipales();
  }
}

function destinoDefinido() {
  const exp = obtenerOCrearExpedienteActual();
  return Boolean(exp.destino) && exp.destino !== 'Por definir';
}

function iniciarFlujoItinerario() {
  if (destinoDefinido()) pasoFlujoDias();
  else pasoFlujoDestino();
}

function pasoFlujoDestino(prefijo = '') {
  flujoItinerario.paso = 'destino';
  renderMensajeUI(
    'bot',
    `<p>${prefijo}¿A qué <strong>destino</strong> de México viaja el cliente? Elige uno o escríbelo (ej. Puebla, Chiapas, Veracruz, o "viaje a Taxco").</p>`,
    false,
    true
  );
  renderizarChips(DESTINOS_RAPIDOS);
}

function pasoFlujoDias() {
  flujoItinerario.paso = 'dias';
  const exp = obtenerOCrearExpedienteActual();
  renderMensajeUI(
    'bot',
    `<p>Destino: <strong>${esc(exp.destino)}</strong>. ¿<strong>Cuántos días</strong> durará el viaje?</p>`,
    false,
    true
  );
  renderizarChips([
    ['d2', '2 días'],
    ['d3', '3 días'],
    ['d4', '4 días'],
    ['d5', '5 días'],
    ['d7', '7 días'],
    ['cambiar_destino', 'Cambiar destino']
  ]);
}

function pasoFlujoEstilo() {
  flujoItinerario.paso = 'estilo';
  renderMensajeUI(
    'bot',
    `<p>Anotado: <strong>${esc(flujoItinerario.dias)} días</strong>. Ahora, ¿cuál es el <strong>estilo de viaje</strong> del cliente o grupo?</p>`,
    false,
    true
  );
  renderizarChips([
    ['s_relax', 'Relax y Descanso'],
    ['s_aventura', 'Aventura y Naturaleza'],
    ['s_fiesta', 'Vida Nocturna'],
    ['s_mix', 'Completo / Mix']
  ]);
}

function pasoFlujoPresupuesto() {
  flujoItinerario.paso = 'presupuesto';
  renderMensajeUI(
    'bot',
    `<p>Perfecto. Por último: ¿cuál es el nivel de <strong>presupuesto</strong> previsto?</p>`,
    false,
    true
  );
  renderizarChips([
    ['b_mochi', 'Económico'],
    ['b_medio', 'Medio / Confort'],
    ['b_todo', 'Todo Incluido / Premium']
  ]);
}

async function completarFlujoItinerario() {
  flujoItinerario.paso = null;
  const exp = obtenerOCrearExpedienteActual();
  if (!destinoDefinido()) {
    pasoFlujoDestino('Antes de armar la propuesta necesito el destino. ');
    return;
  }
  await generarYMostrarItinerario({
    dias: flujoItinerario.dias,
    estilo: flujoItinerario.estilo,
    presupuesto: flujoItinerario.presupuesto,
    destino: exp.destino
  });
}

// El agente escribe en lugar de tocar los chips mientras el asistente guiado está activo
async function manejarRespuestaFlujoTexto(texto, t) {
  const exp = obtenerOCrearExpedienteActual();

  if (/\b(cancela\w*|salir|menu|reiniciar)\b/.test(t)) {
    flujoItinerario = flujoInicial();
    renderMensajeUI('bot', '<p>Listo, dejamos la propuesta. ¿Qué más necesitas?</p>', false, true);
    renderizarChipsPrincipales();
    return true;
  }

  switch (flujoItinerario.paso) {
    case 'destino':
      if (extraerDestino(texto)) {
        if (/\d+\s*d[ií]as?/i.test(texto)) {
          flujoItinerario.dias = exp.dias || flujoItinerario.dias;
          pasoFlujoEstilo();
        } else {
          pasoFlujoDias();
        }
      } else {
        pasoFlujoDestino('No reconocí ese destino dentro de México. ');
      }
      return true;

    case 'dias': {
      const m = t.match(/\b(\d{1,2})\b/);
      if (m && parseInt(m[1], 10) >= 1) {
        flujoItinerario.dias = Math.min(parseInt(m[1], 10), 10);
        exp.dias = flujoItinerario.dias;
        pasoFlujoEstilo();
      } else {
        renderMensajeUI('bot', '<p>Indícame el número de días (por ejemplo: 3) o elige una opción.</p>', false, true);
      }
      return true;
    }

    case 'estilo': {
      let e = null;
      if (/\b(relax\w*|descans\w*|tranquil\w*|playa)\b/.test(t)) e = 'relax';
      else if (/\b(aventur\w*|naturaleza)\b/.test(t)) e = 'aventura';
      else if (/\b(fiesta|noctur\w*|antro\w*|noche)\b/.test(t)) e = 'fiesta';
      else if (/\b(mix|complet\w*|mezcla|variad\w*)\b/.test(t)) e = 'mix';
      if (e) {
        flujoItinerario.estilo = e;
        pasoFlujoPresupuesto();
      } else {
        renderMensajeUI('bot', '<p>Elige el estilo de viaje con los botones o escríbelo (relax, aventura, vida nocturna o completo).</p>', false, true);
      }
      return true;
    }

    case 'presupuesto': {
      let p = null;
      if (/\b(econom\w*|barato|mochil\w*|bajo)\b/.test(t)) p = 'mochi';
      else if (/\b(todo incluido|lujo|premium|alto)\b/.test(t)) p = 'todo';
      else if (/\b(medio|confort|normal|estandar)\b/.test(t)) p = 'medio';
      if (p) {
        flujoItinerario.presupuesto = p;
        await completarFlujoItinerario();
      } else {
        renderMensajeUI('bot', '<p>Indica el presupuesto: económico, medio o todo incluido / premium.</p>', false, true);
      }
      return true;
    }
  }
  return false;
}

/* ==========================================================================
   11. RESPUESTAS POR TEMA (PLAYAS, COMIDA, HOTELES, ATRACCIONES, LOGÍSTICA)
   ========================================================================== */
const TEMAS_GEMINI = {
  playas: 'las mejores playas y actividades de mar o, si el destino no tiene litoral, sus cuerpos de agua y balnearios',
  comida: 'restaurantes y platillos imperdibles',
  hoteles: 'opciones de hospedaje por perfil de cliente (económico, confort y lujo)',
  cultura: 'atracciones y sitios culturales imperdibles',
  tips: 'consejos de logística y seguridad (traslados, clima, temporada y precauciones)'
};

const REGEX_SIN_LITORAL = /cdmx|ciudad de mexico|guanajuato|queretaro|puebla|hidalgo|tlaxcala|morelos|aguascalientes|zacatecas|san luis potosi|durango|estado de mexico|edomex|chihuahua|coahuila/;

async function responderTema(tema) {
  if (!destinoDefinido()) {
    pasoFlujoDestino('Antes de recomendarte eso necesito el destino. ');
    return;
  }
  const exp = obtenerOCrearExpedienteActual();
  const destNorm = normalizar(exp.destino);
  const esCabos = /cabo|baja california sur/.test(destNorm);

  if (tema === 'playas' && REGEX_SIN_LITORAL.test(destNorm)) {
    renderMensajeUI('bot', `
      <p><strong>${esc(exp.destino)}</strong> no tiene litoral, así que no conviene presentar playas marinas en esta propuesta.</p>
      <div class="itin-card">
        <b>Alternativas de agua y naturaleza</b>
        <p style="font-size: 13px; margin: 0;">Puedes cotizar parques, lagos, ríos, balnearios y cuerpos de agua interiores. Para CDMX destacan Xochimilco y Chapultepec; para otros destinos conviene priorizar balnearios, presas y ríos locales verificados.</p>
      </div>
      <p>¿Quieres que ajuste la propuesta hacia naturaleza, cultura o actividades familiares?</p>
    `, false, true);
    renderizarChips([['itinerario', 'Nueva Propuesta', true], ['cultura', 'Atracciones'], ['menu', 'Menú Principal']]);
    return;
  }

  // Con Gemini: recomendaciones para cualquier estado (Los Cabos usa las fichas verificadas)
  if (apiKey && !esCabos) {
    mostrarEscribiendo();
    try {
      const prompt = `Dame ${TEMAS_GEMINI[tema]} en ${exp.destino} para presentar a un cliente. Viajeros: ${exp.pasajeros || 1}. Presupuesto: ${exp.presupuesto}. Máximo 6 elementos con nombres reales verificados y una línea de descripción por elemento. Sin saludos.`;
      const texto = await llamarGemini({
        sistema: construirSistemaChat(),
        contenidos: [{ role: 'user', parts: [{ text: prompt }] }]
      });
      renderMensajeUI('bot', formatearTextoMarkdown(texto) +
        '<div class="stamp-verification">Recomendaciones generadas con IA (Gemini). Verifica antes de cotizar.</div>', false, true);
      renderizarChips([['itinerario', 'Nueva Propuesta', true], ['menu', 'Menú Principal']]);
      return;
    } catch (err) {
      console.warn('Falla en Gemini (tema):', err.message);
      renderMensajeUI('bot', `<p>No pude consultar a Gemini: ${esc(err.message)}</p>`, true, true);
    }
  }

  if (esCabos) {
    ({ playas: fichaPlayasCabos, comida: fichaComidaCabos, hoteles: fichaHotelesCabos, cultura: fichaCulturaCabos, tips: fichaTipsCabos })[tema]();
    return;
  }

  renderMensajeUI('bot',
    `<p>Mis fichas rápidas locales solo están cargadas para Los Cabos. Para <strong>${esc(exp.destino)}</strong> usa <strong>Nueva Propuesta</strong>, o activa Gemini en ⚙️ para recomendaciones de cualquier estado.</p>`,
    false, true);
  renderizarChips([['itinerario', 'Nueva Propuesta', true], ['menu', 'Menú Principal']]);
}

function fichaPlayasCabos() {
  renderMensajeUI('bot', `
    <p>Para tus clientes, las playas más recomendadas son:</p>
    <div class="itin-card">
      <b>Playa del Amor y El Arco</b>
      <p style="font-size: 13px; margin: 0;">Icónica y para nadar en el Mar de Cortés. Solo se llega en lancha o taxi acuático desde El Médano.</p>
    </div>
    <div class="itin-card">
      <b>Bahía Chileno y Santa María (Snorkel)</b>
      <p style="font-size: 13px; margin: 0;">Certificadas Blue Flag, ideales para familias y snorkel. Recomienda llegar antes de las 10:30 am.</p>
    </div>
    <div class="itin-card">
      <b>Playa El Médano</b>
      <p style="font-size: 13px; margin: 0;">La más animada: restaurantes en la arena, deportes náuticos y ambiente continuo.</p>
    </div>
  `, false, true);
  renderizarChips([['itinerario', 'Nueva Propuesta', true], ['hoteles', 'Alojamiento'], ['menu', 'Menú Principal']]);
}

function fichaComidaCabos() {
  renderMensajeUI('bot', `
    <p>Opciones gastronómicas para cotizar a tus clientes:</p>
    <div class="itin-card">
      <b>Metate Cabo (Bib Gourmand MICHELIN)</b>
      <p style="font-size: 13px; margin: 0;">Cocina de humo y leña en patio rústico al aire libre. Prueba el taco de costilla y antojitos tradicionales.</p>
    </div>
    <div class="itin-card">
      <b>Tacos Gardenias (Clásico de Mariscos)</b>
      <p style="font-size: 13px; margin: 0;">Más de 30 años de tradición: tacos de camarón, pescado empanizado y sopa de mariscos en Paseo de la Marina.</p>
    </div>
    <div class="itin-card">
      <b>La Taquiza Centro</b>
      <p style="font-size: 13px; margin: 0;">Excelente relación calidad-precio en el corazón de Cabo San Lucas.</p>
    </div>
  `, false, true);
  renderizarChips([['itinerario', 'Nueva Propuesta', true], ['hoteles', 'Alojamiento'], ['menu', 'Menú Principal']]);
}

function fichaHotelesCabos() {
  renderMensajeUI('bot', `
    <p>Alternativas de alojamiento por perfil de cliente:</p>
    <div class="itin-card">
      <b>Perfil Todo Incluido / Lujo</b>
      <p style="font-size: 13px; margin: 0;">Casa Dorada Los Cabos Resort &amp; Spa (El Médano), Grand Velas o Hard Rock en el Corredor.</p>
    </div>
    <div class="itin-card">
      <b>Perfil Confort / Estándar</b>
      <p style="font-size: 13px; margin: 0;">Siesta Suites Hotel, Hotel Maria Elena o alojamientos boutique en San José del Cabo.</p>
    </div>
    <div class="itin-card">
      <b>Perfil Mochilero / Joven</b>
      <p style="font-size: 13px; margin: 0;">Sofia Hostel Cabo o Casa Luna Bonita, céntricos y accesibles.</p>
    </div>
  `, false, true);
  renderizarChips([['itinerario', 'Nueva Propuesta', true], ['comida', 'Restaurantes'], ['menu', 'Menú Principal']]);
}

function fichaCulturaCabos() {
  renderMensajeUI('bot', `
    <p>Atracciones imperdibles para enriquecer la propuesta del cliente:</p>
    <div class="itin-card">
      <b>San José del Cabo y Art Walk</b>
      <p style="font-size: 13px; margin: 0;">Ambiente tranquilo, arquitectura colonial y galerías abiertas todos los jueves de temporada.</p>
    </div>
    <div class="itin-card">
      <b>Pueblo Mágico de Todos Santos</b>
      <p style="font-size: 13px; margin: 0;">A 1 hora de camino: galerías, gastronomía orgánica y playas para surf como Cerritos.</p>
    </div>
    <div class="itin-card">
      <b>Parque Nacional Cabo Pulmo</b>
      <p style="font-size: 13px; margin: 0;">Joya marina del Mar de Cortés, ideal para excursionistas amantes de la naturaleza.</p>
    </div>
  `, false, true);
  renderizarChips([['itinerario', 'Nueva Propuesta', true], ['tips', 'Logística'], ['menu', 'Menú Principal']]);
}

function fichaTipsCabos() {
  renderMensajeUI('bot', `
    <p>Tips esenciales que puedes brindar a tu cliente:</p>
    <div class="itin-card">
      <b>Logística Aeroportuaria</b>
      <p style="font-size: 13px; margin: 0;">El Aeropuerto SJD está en San José del Cabo (33 km de Cabo San Lucas). Prever transfer privado o autobús Ruta del Desierto.</p>
    </div>
    <div class="itin-card">
      <b>Seguridad en el Mar</b>
      <p style="font-size: 13px; margin: 0;">Nadar únicamente en playas con bandera verde o protegidas (Chileno, Palmilla, El Médano). Evitar Playa del Divorcio.</p>
    </div>
    <div class="itin-card">
      <b>Temporada de Ballenas</b>
      <p style="font-size: 13px; margin: 0;">De mediados de diciembre a abril, siendo enero a marzo el momento óptimo.</p>
    </div>
  `, false, true);
  renderizarChips([['itinerario', 'Nueva Propuesta', true], ['menu', 'Menú Principal']]);
}

/* ==========================================================================
   12. ENVÍO DE MENSAJES: GUARDIAS, GEMINI Y MOTOR LOCAL
   ========================================================================== */
// Lista blanca: solo se atienden mensajes que parecen de viajes
const REGEX_TEMA_VIAJES = /\b(viaj\w*|cliente|clienta|itinerario|cotiz\w*|propuesta|hotel\w*|hospedaj\w*|alojamiento|resort|playas?|restaurantes?|comida|comer|cenar|tacos?|tour\w*|excursion\w*|destinos?|presupuesto|vuelos?|aeropuerto|transfer\w*|pdf|dias?|noches?|personas?|pax|pareja|familia|mochiler\w*|logistica|tips?|consejos?|segur\w*|atraccion\w*|visitar|conocer|turis\w*|bitacora|expediente|pasajeros?|clima|equipaje|boletos?|autobus|precio\w*|costo\w*|tarifa\w*|recomiend\w*|recomienda\w*|sugier\w*|sugiere\w*|actividad\w*|lugares|vacacion\w*|reserv\w*|museo\w*|pueblo\w*|cambia\w*|modifica\w*|ajusta\w*|agrega\w*|anade\w*|quita\w*|elimina\w*|reemplaza\w*|sustituye\w*|menu|cancela\w*|salir|reiniciar|estado|estados|mexico|mexicano|barato|economic\w*|lujo|premium|temporada|lluvia|ballenas?|mar)\b/;

function esConsultaDeViajes(t) {
  if (flujoItinerario.paso) return true;
  if (CATALOGO_REGEX.some(item => item.regs.some(r => r.test(t)))) return true;
  return REGEX_TEMA_VIAJES.test(t);
}

function esSaludoOAfirmacion(t) {
  return t.length < 30 && t.split(/\s+/).length <= 3 &&
    /^(hola|buenas|buenos|gracias|muchas gracias|si|ok|okay|va|vale|claro|dale|listo|perfecto)\b/.test(t);
}

async function enviarMensajeUsuario(texto) {
  if (!texto || !texto.trim()) return;
  const mensaje = texto.trim();
  inputEl.value = '';
  const t = normalizar(mensaje);

  renderMensajeUI('user', mensaje);
  setOcupado(true);
  mostrarEscribiendo();

  try {
    await procesarMensaje(mensaje, t);
  } catch (err) {
    console.error('Error al procesar el mensaje:', err);
    renderMensajeUI('bot', '<p>Ocurrió un error inesperado al procesar tu mensaje. Intenta de nuevo.</p>', true, true);
  } finally {
    ocultarEscribiendo();
    setOcupado(false);
    inputEl.focus();
  }
}

async function procesarMensaje(mensaje, t) {
  const exp = obtenerOCrearExpedienteActual();

  // 1. Destino internacional: vIAje solo cubre los 32 estados de México
  if (esDestinoInternacional(mensaje)) {
    await esperar(400);
    renderMensajeUI('bot', `
      <p>Colega asesor, <strong>vIAje</strong> se especializa exclusivamente en los <strong>32 estados de la República Mexicana</strong>.</p>
      <p>No cotizamos destinos internacionales, pero con gusto te armo una propuesta equivalente dentro de México. Por ejemplo:</p>
      <div class="itin-card">
        <b>Alternativas nacionales destacadas</b>
        <div class="itin-slot"><em>Playas caribeñas</em><span>Quintana Roo: Cancún, Tulum, Bacalar, Holbox</span></div>
        <div class="itin-slot"><em>Playas del Pacífico</em><span>Oaxaca: Puerto Escondido · Baja California Sur: Los Cabos, La Paz</span></div>
        <div class="itin-slot"><em>Cultura e historia</em><span>CDMX, Oaxaca, Puebla, Mérida, San Miguel de Allende</span></div>
        <div class="itin-slot"><em>Naturaleza y aventura</em><span>Chiapas, Chihuahua (Barrancas del Cobre), San Luis Potosí (Huasteca)</span></div>
      </div>
      <p>¿Qué perfil tiene tu cliente? Con eso te preparo el itinerario completo en PDF.</p>
    `, false, true);
    return;
  }

  // 2. Guardia de tema (lista blanca). Va antes de tocar el expediente.
  if (!esConsultaDeViajes(t) && !esSaludoOAfirmacion(t)) {
    await esperar(300);
    renderMensajeUI('bot', 'Como asistente de viajes, solo puedo ayudarte a planear tus itinerarios y viajes.');
    return;
  }

  // 3. Extraer cliente, destino, personas, días y presupuesto
  autoDetectarDatosCliente(mensaje);

  // 4. Asistente guiado activo: interpretar la respuesta escrita
  if (flujoItinerario.paso) {
    if (await manejarRespuestaFlujoTexto(mensaje, t)) return;
  }

  // 5. Saludos, agradecimientos y afirmaciones sueltas
  if (esSaludoOAfirmacion(t)) {
    await esperar(250);
    if (/^(gracias|muchas gracias)/.test(t)) {
      renderMensajeUI('bot', '<p>Con gusto, colega asesor. ¿Algo más que necesites para este cliente?</p>', false, true);
      renderizarChipsPrincipales();
    } else if (/^(hola|buenas|buenos)/.test(t)) {
      renderMensajeUI('bot', '<p>Aquí estoy. Dime el cliente, destino, personas, días y presupuesto, o toca <strong>Nueva Propuesta</strong>.</p>', false, true);
      renderizarChipsPrincipales();
    } else if (ultimoItinerarioGenerado) {
      renderMensajeUI('bot', '<p>Perfecto. Puedes descargar el PDF de la propuesta actual o pedirme ajustes.</p>', false, true);
      renderizarChips([['itinerario', 'Nueva Propuesta', true], ['tips', 'Logística'], ['menu', 'Menú Principal']]);
    } else {
      iniciarFlujoItinerario();
    }
    return;
  }

  // 6. Consulta de memoria local (¿te acuerdas de fulanito?)
  const respuestaMemoria = consultarMemoriaLocal(mensaje);
  if (respuestaMemoria) {
    await esperar(350);
    renderMensajeUI('bot', respuestaMemoria, false, true);
    return;
  }

  const pidePdf = /\b(pdf|descarga\w*)\b/.test(t);
  const pideCotizar = /\b(cotiza\w*|itinerario|propuesta|estancia|arma\w*|prepara\w*|planea\w*|plan)\b/.test(t) || /\d+\s*(dias?|noches?)/.test(t);
  const pideModificar = /\b(cambia\w*|modifica\w*|ajusta\w*|agrega\w*|anade|quita\w*|elimina\w*|reemplaza\w*|sustituye\w*|prefiero|mejor|en vez de|en lugar de)\b/.test(t);

  // 7. Descargar PDF
  if (pidePdf) {
    if (ultimoItinerarioGenerado) {
      renderMensajeUI('bot', '<p>Listo, descargando el PDF de la propuesta actual.</p>', false, true);
      descargarPdfActual();
    } else {
      renderMensajeUI('bot', '<p>Aún no hay una propuesta para exportar; armémosla primero.</p>', false, true);
      iniciarFlujoItinerario();
    }
    return;
  }

  // 8. Modificar la propuesta existente (requiere Gemini)
  if (pideModificar && ultimoItinerarioGenerado) {
    if (!apiKey) {
      renderMensajeUI('bot', '<p>Para modificar una propuesta ya generada necesito Gemini (⚙️). Con el motor local puedes armar una nueva con <strong>Nueva Propuesta</strong>.</p>', false, true);
      renderizarChips([['itinerario', 'Nueva Propuesta', true], ['menu', 'Menú Principal']]);
      return;
    }
    const mDias = mensaje.match(/(\d+)\s*d[ií]as?/i);
    await generarYMostrarItinerario({
      dias: mDias ? parseInt(mDias[1], 10) : ultimoItinerarioGenerado.dias,
      estilo: flujoItinerario.estilo,
      presupuesto: exp.presupuesto,
      destino: exp.destino,
      instruccion: mensaje,
      previo: ultimoItinerarioGenerado
    });
    return;
  }

  // 9. Pide una propuesta y ya hay destino: generarla (Gemini si hay clave)
  if (pideCotizar) {
    if (destinoDefinido()) {
      await generarYMostrarItinerario({
        dias: exp.dias || flujoItinerario.dias || 3,
        estilo: flujoItinerario.estilo,
        presupuesto: exp.presupuesto,
        destino: exp.destino
      });
    } else {
      pasoFlujoDestino();
    }
    return;
  }

  // 10. Con Gemini: chat libre con memoria de la consulta
  if (apiKey) {
    try {
      const respuestaIA = await llamarGemini({
        sistema: construirSistemaChat(),
        contenidos: construirContenidosGemini(exp)
      });
      renderMensajeUI('bot', respuestaIA);
      return;
    } catch (err) {
      console.warn('Falla en Gemini, se usa el motor local:', err.message);
      renderMensajeUI('bot', `<p>No pude consultar a Gemini: ${esc(err.message)} Respondo con el motor local.</p>`, true, true);
    }
  }

  // 11. Motor local por temas
  await esperar(300);
  if (/\b(playas?|snorkel|buceo|nadar|mar)\b/.test(t)) return responderTema('playas');
  if (/\b(comida|comer|restaurantes?|tacos?|cenar)\b/.test(t)) return responderTema('comida');
  if (/\b(hotel\w*|hospedaj\w*|dormir|quedarse|resort|alojamiento)\b/.test(t)) return responderTema('hoteles');
  if (/\b(visitar|conocer|cultura|tour\w*|excursion\w*|atraccion\w*|museo\w*)\b/.test(t)) return responderTema('cultura');
  if (/\b(tips?|consejos?|aeropuerto|segur\w*|logistica)\b/.test(t)) return responderTema('tips');

  if (!destinoDefinido()) {
    pasoFlujoDestino();
    return;
  }
  const cName = exp.cliente !== 'Nueva Consulta' ? ` para <strong>${esc(exp.cliente)}</strong>` : '';
  renderMensajeUI('bot', `
    <p>Anotado${cName} en <strong>${esc(exp.destino)}</strong>. Dime días y presupuesto, o toca <strong>Nueva Propuesta</strong> para armarla paso a paso.</p>
  `, false, true);
  renderizarChipsPrincipales();
}

/* ==========================================================================
   13. EVENTOS Y ARRANQUE
   ========================================================================== */
composerEl.addEventListener('submit', (e) => {
  e.preventDefault();
  enviarMensajeUsuario(inputEl.value);
});

openDrawerBtn.addEventListener('click', abrirDrawer);
closeDrawerBtn.addEventListener('click', cerrarDrawer);
drawerOverlayEl.addEventListener('click', cerrarDrawer);
drawerNewClientBtn.addEventListener('click', crearNuevoExpediente);
newChatBtn.addEventListener('click', crearNuevoExpediente);

searchClientInput.addEventListener('input', (e) => {
  renderizarListaDrawer(e.target.value);
});

clearActiveClientBtn.addEventListener('click', () => {
  if (expedienteActual) {
    expedienteActual.cliente = 'Nueva Consulta';
    guardarExpedientesStorage();
    actualizarBarraClienteActivo();
    renderizarListaDrawer(searchClientInput ? searchClientInput.value : '');
  }
});

/* ---------- Modal de configuración de Gemini ---------- */
function mostrarEstadoApi(texto, clase = '') {
  apiStatusMessage.textContent = texto;
  apiStatusMessage.className = 'modal-status' + (clase ? ' ' + clase : '');
}

openKeyModalBtn.addEventListener('click', () => {
  geminiApiKeyInput.value = apiKey;
  geminiModelInput.value = geminiModel;
  if (apiKey) mostrarEstadoApi(`Clave configurada. Modelo: ${geminiModel}.`, 'success');
  else mostrarEstadoApi('Modo actual: motor local activo (sin IA).');
  keyModal.style.display = 'flex';
});

closeKeyModalBtn.addEventListener('click', () => {
  keyModal.style.display = 'none';
});

keyModal.addEventListener('click', (e) => {
  if (e.target === keyModal) keyModal.style.display = 'none';
});

saveApiKeyBtn.addEventListener('click', async () => {
  const k = geminiApiKeyInput.value.trim();
  const m = geminiModelInput.value.trim() || GEMINI_MODEL_DEFAULT;
  apiKey = k;
  geminiModel = m;
  localStorage.setItem(STORAGE_KEY_MODEL, m);

  if (!k) {
    localStorage.removeItem(STORAGE_KEY_KEY);
    mostrarEstadoApi('Sin clave: se usará el motor local.', 'warning');
    setTimeout(() => { keyModal.style.display = 'none'; }, 700);
    return;
  }

  localStorage.setItem(STORAGE_KEY_KEY, k);
  mostrarEstadoApi('Probando la conexión con Gemini...');
  saveApiKeyBtn.disabled = true;
  try {
    await llamarGemini({
      sistema: 'Responde únicamente con la palabra OK.',
      contenidos: [{ role: 'user', parts: [{ text: 'ping' }] }]
    });
    mostrarEstadoApi(`Conexión exitosa con ${m}. Gemini activado.`, 'success');
    setTimeout(() => { keyModal.style.display = 'none'; }, 900);
  } catch (err) {
    // La clave queda guardada, pero se avisa que la prueba falló
    mostrarEstadoApi(`No se pudo conectar: ${err.message}`, 'warning');
  } finally {
    saveApiKeyBtn.disabled = false;
  }
});

clearApiKeyBtn.addEventListener('click', () => {
  apiKey = '';
  localStorage.removeItem(STORAGE_KEY_KEY);
  geminiApiKeyInput.value = '';
  mostrarEstadoApi('Clave eliminada. Se usará el motor local.', 'warning');
});

/* ---------- Arranque ---------- */
function inicializarApp() {
  ticketIdEl.textContent = 'N.º ' + String(Math.floor(Math.random() * 900) + 100);
  ticketDateEl.textContent = obtenerFechaCorta();

  // Limpieza de nombres residuales de versiones anteriores
  let huboCambio = false;
  expedientes.forEach(exp => {
    if (exp.cliente && /ruben\s+que\s+cotiza/i.test(exp.cliente)) {
      exp.cliente = 'Ruben';
      huboCambio = true;
    }
    if (!Array.isArray(exp.historial)) {
      exp.historial = [];
      huboCambio = true;
    }
  });
  if (huboCambio) guardarExpedientesStorage();

  actualizarBadgeExpedientes();

  const expedienteConHistorial = expedientes.find(exp => exp.historial.length > 0);
  if (expedienteConHistorial) {
    cargarExpediente(expedienteConHistorial.id);
  } else {
    crearNuevoExpediente();
  }
}

inicializarApp();