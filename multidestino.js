// Itinerarios con varios destinos.
// Depende de las funciones existentes en script.js.

function iniciarMultidestino() {
  flujoItinerario = flujoInicial();
  flujoItinerario.paso = 'multi_destinos';

  renderMensajeUI('bot', `
    <p>¿Qué destinos de México quieres visitar?</p>
    <p>Por ejemplo: <strong>Quiero ir a Puebla y Oaxaca.</strong></p>
  `, false, true);

  renderizarChips([]);
}

function detectarDestinosNaturales(texto) {
  const t = normalizar(texto);
  const coincidencias = [];

  for (const item of DESTINOS_CATALOGO) {
    for (const alias of item.claves) {
      const clave = normalizar(alias);
      const escapada = clave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escapada}\\b`, 'g');

      for (const coincidencia of t.matchAll(regex)) {
        coincidencias.push({
          inicio: coincidencia.index,
          fin: coincidencia.index + coincidencia[0].length,
          clave
        });
      }
    }
  }

  // Prioriza nombres completos y conserva el orden del mensaje.
  coincidencias.sort((a, b) =>
    a.inicio - b.inicio || b.fin - a.fin
  );

  const seleccionadas = [];

  for (const coincidencia of coincidencias) {
    const seSuperpone = seleccionadas.some(otra =>
      coincidencia.inicio < otra.fin &&
      coincidencia.fin > otra.inicio
    );

    if (!seSuperpone) seleccionadas.push(coincidencia);
  }

  const equivalencias = {
    'cdmx': 'Ciudad de México',
    'ciudad de mexico': 'Ciudad de México',
    'distrito federal': 'Ciudad de México',
    'df': 'Ciudad de México',
    'edomex': 'Estado de México',
    'estado de mexico': 'Estado de México',
    'bcs': 'Baja California Sur',
    'baja california sur': 'Baja California Sur',
    'cabos': 'Los Cabos',
    'los cabos': 'Los Cabos',
    'cancun': 'Cancún',
    'queretaro': 'Querétaro',
    'yucatan': 'Yucatán',
    'merida': 'Mérida',
    'michoacan': 'Michoacán',
    'nuevo leon': 'Nuevo León',
    'san luis potosi': 'San Luis Potosí'
  };

  const destinos = [];
  const vistos = new Set();

  for (const coincidencia of seleccionadas) {
    const nombre = equivalencias[coincidencia.clave] ||
      coincidencia.clave.replace(/\b[a-z]/g, letra =>
        letra.toUpperCase()
      );

    const id = normalizar(nombre);

    if (!vistos.has(id)) {
      vistos.add(id);
      destinos.push(nombre);
    }
  }

  return destinos;
}

function pedirPresupuestoMultiple() {
  flujoItinerario.paso = 'multi_presupuesto';

  renderMensajeUI('bot', `
    <p>Planearemos esta ruta:
    <strong>${flujoItinerario.destinosNaturales.map(esc).join(' → ')}</strong>.</p>

    <p>¿Qué presupuesto tienes:
    <strong>económico, medio o alto</strong>?</p>
  `, false, true);

  renderizarChips([
    ['multi_economico', 'Económico'],
    ['multi_medio', 'Medio'],
    ['multi_alto', 'Alto']
  ]);
}

function pedirDiasMultiples() {
  flujoItinerario.paso = 'multi_dias';

  renderMensajeUI(
    'bot',
    '¿Cuántos días durará todo el viaje? Por ejemplo: 6 días.'
  );

  renderizarChips([]);
}

function proponerDistribucionMultiple(total) {
  const destinos = flujoItinerario.destinosNaturales;
  const base = Math.floor(total / destinos.length);
  const sobrantes = total % destinos.length;

  flujoItinerario.rutaMultiple = destinos.map((destino, i) => ({
    destino,
    dias: base + (i < sobrantes ? 1 : 0),
    horasTraslado: i === 0 ? 0 : null
  }));

  flujoItinerario.paso = 'multi_confirmacion';

  const resumen = flujoItinerario.rutaMultiple.map(parada =>
    `<li>${esc(parada.destino)}: ${parada.dias} días.</li>`
  ).join('');

  renderMensajeUI('bot', `
    <p>Para tus <strong>${total} días</strong>, propongo:</p>
    <ul>${resumen}</ul>

    <p>Dentro de esos días reservaremos provisionalmente el primer
    día de cada destino posterior para traslado y llegada.
    La duración del transporte queda por confirmar.</p>

    <p>¿Generamos esta propuesta?
    Puedes responder <strong>sí</strong> o indicar otra duración,
    por ejemplo: <strong>mejor 8 días</strong>.</p>
  `, false, true);

  renderizarChips([
    ['multi_si', 'Sí, generar', true],
    ['multi_cancelar', 'Cancelar']
  ]);
}

function mostrarRevisionMultiple() {
  const it = ultimoItinerarioGenerado;
  if (!it?.multidestino) return;

  flujoItinerario = flujoInicial();

  const resumen = it.destinos.map(destino => `
    <li>
      <strong>${esc(destino.nombre)}</strong>:
      días ${esc(destino.diaInicio)} a ${esc(destino.diaFin)}
    </li>
  `).join('');

  renderMensajeUI('bot', `
    <div class="itin-card">
      <b>Revisión de la ruta completa</b>
      <ul>${resumen}</ul>
      <p>Total: <strong>${esc(it.dias)} días</strong>.</p>
    </div>

    <p>Escribe <strong>confirmar</strong> para descargar el PDF.
    Para cambiar la ruta, dime los destinos nuevos,
    por ejemplo: <strong>quiero visitar Puebla y Oaxaca</strong>.</p>

    <p>Para iniciar una consulta independiente de un solo destino,
    utiliza <strong>+ Nuevo</strong>.</p>
  `, false, true);

  renderizarChips([
    ['rev_ok', 'Confirmar y generar PDF', true],
    ['itinerario', 'Cambiar ruta']
  ]);
}

async function generarRutaMultiple(ruta) {
  const exp = obtenerOCrearExpedienteActual();
  const flujo = flujoItinerario;
  const estilo = flujo.estilo || 'mix';
  const presupuesto = flujo.presupuesto || 'medio';

  const propuestas = [];
  const avisos = [];

  const verificarConsulta = () => {
    if (expedienteActual !== exp || flujoItinerario !== flujo) {
      throw new Error(
        'La consulta cambió durante la generación. Inicia nuevamente la ruta.'
      );
    }
  };

  for (const parada of ruta) {
    verificarConsulta();

    const resultado = await producirItinerario({
      dias: parada.dias,
      estilo,
      presupuesto,
      destino: parada.destino
    });

    verificarConsulta();

    if (resultado.obj.bloques.length !== parada.dias) {
      throw new Error(
        `${parada.destino}: el motor devolvió ` +
        `${resultado.obj.bloques.length} días de ${parada.dias}. ` +
        'Reduce la duración total o configura Gemini y vuelve a intentar.'
      );
    }

    avisos.push(
      `${parada.destino}: ` +
      (resultado.origen === 'gemini' ? 'Gemini.' : 'Plantilla local.') +
      (resultado.error ? ' Gemini no estuvo disponible.' : '')
    );

    propuestas.push({
      ...parada,
      plan: resultado.obj
    });
  }

  const respuesta = await fetch('api/multidestino.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ruta: propuestas
    })
  });

  let datos;

  try {
    datos = await respuesta.json();
  } catch {
    throw new Error(
      'PHP no devolvió JSON. Abre el proyecto desde localhost ' +
      'y revisa la terminal del servidor.'
    );
  }

  verificarConsulta();

  if (!respuesta.ok || !datos.ok) {
    throw new Error(datos.error || 'No se pudo construir la ruta.');
  }

  const it = datos.itinerario;

  if (
    !it ||
    !Array.isArray(it.destinos) ||
    !Array.isArray(it.bloques) ||
    !Array.isArray(it.notas)
  ) {
    throw new Error('La respuesta del servidor está incompleta.');
  }

  it.estiloClave = estilo;
  it.presupuestoClave = presupuestoAClave(presupuesto);
  it.origen = 'php';
  it.notas.unshift(...avisos);

  ultimoItinerarioGenerado = it;
  exp.ultimoItinerario = it;
  exp.destino = it.destino;
  exp.destinos = it.destinos;
  exp.dias = it.dias;
  exp.presupuesto = it.presupuestoEtiqueta;

  delete exp.noches;

  guardarExpedientesStorage();
  actualizarBarraClienteActivo();
  renderizarListaDrawer(searchClientInput.value);

  renderMensajeUI(
    'bot',
    generarHTMLItinerario(it, exp.cliente, { origen: 'php' }),
    false,
    true
  );

  renderMensajeUI('bot', `
    <ul>${avisos.map(aviso => `<li>${esc(aviso)}</li>`).join('')}</ul>
    <p>Los días de traslado son reservas provisionales.
    La duración del transporte queda por confirmar.</p>
  `, false, true);

  mostrarRevisionMultiple();
}

async function manejarMensajeMultidestino(mensaje) {
  const t = normalizar(mensaje.trim());
  const paso = flujoItinerario.paso || '';
  const flujoMultiple = paso.startsWith('multi_');

  // Deja responder al control internacional de script.js.
  if (esDestinoInternacional(mensaje)) return false;

  if (flujoMultiple && /^(cancelar|cancela|salir|menu)$/.test(t)) {
    flujoItinerario = flujoInicial();

    renderMensajeUI('bot', 'De acuerdo, cancelamos la captura de la ruta.');

    if (ultimoItinerarioGenerado?.multidestino) {
      mostrarRevisionMultiple();
    } else {
      renderizarChipsPrincipales();
    }

    return true;
  }

  const destinos = detectarDestinosNaturales(mensaje);

  // Detecta automáticamente una ruta con varios destinos.
  if (destinos.length >= 2) {
    if (destinos.length > 5) {
      renderMensajeUI('bot', 'Podemos organizar hasta 5 destinos por viaje.');
      return true;
    }

    const exp = obtenerOCrearExpedienteActual();
    const nombre = extraerNombreCliente(mensaje);
    const pasajeros = mensaje.match(
      /\b(\d+)\s*(?:personas?|viajeros?|pasajeros?|pax)\b/i
    );

    if (nombre) exp.cliente = nombre;

    if (pasajeros && Number(pasajeros[1]) > 0) {
      exp.pasajeros = Number(pasajeros[1]);
    }

    guardarExpedientesStorage();
    actualizarBarraClienteActivo();

    flujoItinerario = flujoInicial();
    flujoItinerario.destinosNaturales = destinos;

    pedirPresupuestoMultiple();
    return true;
  }

  // Sigue disponible, pero ya no es obligatorio escribirlo.
  if (t === 'multidestino') {
    iniciarMultidestino();
    return true;
  }

  if (paso === 'multi_destinos') {
    renderMensajeUI(
      'bot',
      'Dime al menos dos destinos. Por ejemplo: quiero visitar Puebla y Oaxaca.'
    );

    return true;
  }

  if (paso === 'multi_presupuesto') {
    const presupuesto = detectarPresupuesto(t);

    if (!presupuesto) {
      renderMensajeUI(
        'bot',
        'Por ahora manejamos niveles de presupuesto: económico, medio o alto. ¿Cuál prefieres?'
      );

      return true;
    }

    flujoItinerario.presupuesto = presupuesto;
    pedirDiasMultiples();
    return true;
  }

  if (paso === 'multi_dias' || paso === 'multi_confirmacion') {
    const afirmacion = t
      .replace(/[¡!¿?.,]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const respuestasSi = [
      'si',
      'si generar',
      'si por favor',
      'claro',
      'adelante',
      'generar',
      'confirmar',
      'esta bien',
      'ok',
      'vale',
      'dale'
    ];

    if (
      paso === 'multi_confirmacion' &&
      respuestasSi.includes(afirmacion)
    ) {
      try {
        await generarRutaMultiple(flujoItinerario.rutaMultiple);
      } catch (error) {
        renderMensajeUI(
          'bot',
          `${error.message} Puedes indicar otra cantidad de días o cancelar.`,
          true
        );
      }

      return true;
    }

    const coincidencia = t.match(/\b(\d+)\s*dias?\b/) ||
      t.match(/^(\d+)$/);

    if (!coincidencia) {
      renderMensajeUI(
        'bot',
        paso === 'multi_confirmacion'
          ? 'Responde sí para generar, o dime otra duración, por ejemplo: 8 días.'
          : 'Dime cuántos días tienes en total, por ejemplo: 6 días.'
      );

      return true;
    }

    const total = Number(coincidencia[1]);
    const cantidad = flujoItinerario.destinosNaturales.length;
    const minimo = cantidad * 2;
    const maximo = Math.min(30, cantidad * 10);

    if (total < minimo || total > maximo) {
      renderMensajeUI(
        'bot',
        `Para esta ruta necesitamos entre ${minimo} y ${maximo} días. ` +
        'Reservamos al menos dos por destino para contemplar traslados y actividades.'
      );

      return true;
    }

    proponerDistribucionMultiple(total);
    return true;
  }

  if (ultimoItinerarioGenerado?.multidestino) {
    if (/^(confirmar|pdf|descargar pdf)[.!]*$/.test(t)) {
      confirmarPropuestaYGenerarPdf();
    } else {
      mostrarRevisionMultiple();
    }

    return true;
  }

  // Mantiene el flujo original cuando solo hay un destino.
  return false;
}