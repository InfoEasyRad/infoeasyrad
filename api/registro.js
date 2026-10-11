// /api/registro.js — Registro de audios
// Los audios se suben con nombre, edad y fecha del paciente y quedan "pendientes".
// Después el médico decide si se transcriben (Whisper) o se descartan.
// Identidad siempre derivada del token de Supabase, nunca del body.
//
// Acciones (POST JSON { action, ... }):
//   crear        → registra el audio (id generado por el equipo, idempotente) y devuelve
//                  una URL firmada para subirlo directo a Storage
//   confirmar    → verifica que el audio llegó y lo pasa a "pendiente"
//   listar       → registros por estado (+ búsqueda por nombre y conteos)
//   obtener      → un registro
//   audio_url    → URL firmada (10 min) para escuchar el audio
//   transcribir  → descarga el audio de Storage y lo transcribe con Whisper
//   estado       → descartar / restaurar / marcar informado
//   actualizar   → corregir nombre, edad, fecha o modalidad
//   eliminar     → borra el audio de Storage y el registro
// Respaldo: POST multipart { action: 'subir', id, file } sube el audio a través de
// esta función cuando la subida directa falla (solo audios de hasta ~4 MB).

const { IncomingForm } = require('formidable');
const fs = require('fs');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const BUCKET = 'audios-registro';
const TABLA = 'registro_audios';
const MAX_BYTES = 25 * 1024 * 1024;            // límite de Whisper y del bucket
const MAX_BYTES_VIA_FUNCION = 4 * 1024 * 1024; // Vercel rechaza cuerpos de más de 4.5 MB
const MAX_SUBIENDO = 30;                       // subidas sin terminar permitidas por usuario
const ESTADOS = ['subiendo', 'pendiente', 'transcrito', 'informado', 'descartado'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNAS = 'id, paciente_nombre, paciente_edad, fecha_estudio, modalidad, mime_type, tamano_bytes, ' +
  'duracion_seg, origen, estado, transcripcion, transcrito_at, informado_at, created_at, updated_at';

// Formatos que acepta Whisper (opus se le envía como ogg)
const FORMATOS = {
  webm: 'audio/webm', mp4: 'audio/mp4', m4a: 'audio/mp4', mp3: 'audio/mpeg', mpeg: 'audio/mpeg',
  mpga: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac'
};

async function verificarToken(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data || !data.user) return null;
  return data.user;
}

// ── Utilidades ──────────────────────────────────────────────────────────
function limpiarTexto(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

function normalizar(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function fechaValida(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

function extensionDe(ext, mime) {
  let e = String(ext || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (FORMATOS[e]) return e;
  const m = String(mime || '').toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('x-m4a') || m.includes('m4a')) return 'm4a';
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  if (m.includes('opus')) return 'opus';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('flac')) return 'flac';
  return null;
}

function noEncontrado(res) {
  return res.status(404).json({ error: 'no_encontrado', mensaje: 'Ese audio ya no está en el registro' });
}

function todaviaSubiendo(res) {
  return res.status(409).json({ error: 'subiendo', mensaje: 'El audio todavía se está subiendo' });
}

function esFaltaDeConfiguracion(e) {
  const t = [e && e.message, e && e.code, e && e.error].join(' ').toLowerCase();
  return /pgrst205|42p01|does not exist|could not find the table|bucket not found/.test(t);
}

async function filaDelUsuario(userId, id, columnas) {
  if (!UUID_RE.test(String(id || ''))) return null;
  const { data, error } = await supabase
    .from(TABLA)
    .select(columnas || COLUMNAS)
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function actualizarFila(userId, id, cambios) {
  const { data, error } = await supabase
    .from(TABLA)
    .update(cambios)
    .eq('id', id)
    .eq('user_id', userId)
    .select(COLUMNAS)
    .single();
  if (error) throw error;
  return data;
}

async function urlDeSubida(path) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error) throw error;
  return { url: data.signedUrl, token: data.token, max_via_funcion: MAX_BYTES_VIA_FUNCION };
}

async function objetoEnStorage(path) {
  const i = path.lastIndexOf('/');
  const carpeta = path.slice(0, i);
  const archivo = path.slice(i + 1);
  const { data, error } = await supabase.storage.from(BUCKET).list(carpeta, { search: archivo, limit: 10 });
  if (error) throw error;
  const o = (data || []).find(x => x.name === archivo);
  return o ? { size: (o.metadata && o.metadata.size) || null } : null;
}

async function contarPorEstado(userId) {
  const res = await Promise.all(ESTADOS.map(e =>
    supabase.from(TABLA).select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('estado', e)
  ));
  const conteos = {};
  ESTADOS.forEach((e, i) => {
    if (res[i].error) throw res[i].error;
    conteos[e] = res[i].count || 0;
  });
  return conteos;
}

async function whisper(audio, ext) {
  const nombre = 'audio.' + (ext === 'opus' ? 'ogg' : ext);
  const fd = new FormData();
  fd.append('file', new Blob([audio], { type: FORMATOS[ext] || 'application/octet-stream' }), nombre);
  fd.append('model', 'whisper-1');
  fd.append('language', 'es');
  fd.append('response_format', 'text');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
    body: fd
  });
  if (!r.ok) throw new Error('Error Whisper: ' + (await r.text()).slice(0, 300));
  return (await r.text()).trim();
}

// ── Acciones ────────────────────────────────────────────────────────────
async function crear(body, res, user) {
  // El id lo genera el equipo al grabar: si la app se cierra a mitad de camino y
  // se reintenta, se reutiliza el mismo registro en vez de crear uno duplicado.
  const id = UUID_RE.test(String(body.id || '')) ? String(body.id).toLowerCase() : crypto.randomUUID();
  const { data: existente, error: errExiste } = await supabase
    .from(TABLA).select('id, user_id, estado, storage_path').eq('id', id).maybeSingle();
  if (errExiste) throw errExiste;
  if (existente) {
    if (existente.user_id !== user.id) return res.status(409).json({ error: 'id_en_uso', mensaje: 'Identificador en uso' });
    if (existente.estado !== 'subiendo') {
      return res.status(200).json({ registro: await filaDelUsuario(user.id, id), ya_subido: true });
    }
    if (await objetoEnStorage(existente.storage_path)) { // el audio llegó pero faltó confirmar
      return res.status(200).json({ registro: await actualizarFila(user.id, id, { estado: 'pendiente' }), ya_subido: true });
    }
    return res.status(200).json({ registro: await filaDelUsuario(user.id, id), subida: await urlDeSubida(existente.storage_path) });
  }

  const nombre = limpiarTexto(body.paciente_nombre, 200);
  if (!nombre) return res.status(400).json({ error: 'nombre_requerido', mensaje: 'Falta el nombre del paciente' });
  const ext = extensionDe(body.ext, body.mime_type);
  if (!ext) {
    return res.status(400).json({
      error: 'formato_no_soportado',
      mensaje: 'Formato de audio no soportado. Usá MP3, M4A, WAV, OGG, OPUS, WEBM o FLAC.'
    });
  }
  const tamano = Number(body.tamano_bytes) || 0;
  if (tamano > MAX_BYTES) return res.status(400).json({ error: 'archivo_grande', mensaje: 'El audio supera 25 MB' });

  const { count, error: errCount } = await supabase
    .from(TABLA).select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).eq('estado', 'subiendo');
  if (errCount) throw errCount;
  if ((count || 0) >= MAX_SUBIENDO) {
    return res.status(429).json({
      error: 'demasiadas_subidas',
      mensaje: 'Hay demasiados audios sin terminar de subir. Eliminá los marcados como "Subida incompleta".'
    });
  }

  const path = `${user.id}/${id}.${ext}`;
  const subida = await urlDeSubida(path); // primero la firma: si falla, no queda fila huérfana

  const fila = {
    id,
    user_id: user.id,
    paciente_nombre: nombre,
    nombre_busqueda: normalizar(nombre),
    paciente_edad: limpiarTexto(body.paciente_edad, 40),
    modalidad: limpiarTexto(body.modalidad, 60),
    storage_path: path,
    mime_type: limpiarTexto(body.mime_type, 100) || FORMATOS[ext],
    tamano_bytes: tamano || null,
    duracion_seg: Math.max(0, Math.round(Number(body.duracion_seg) || 0)) || null,
    origen: body.origen === 'archivo' ? 'archivo' : 'grabacion',
    estado: 'subiendo'
  };
  const fecha = fechaValida(body.fecha_estudio);
  if (fecha) fila.fecha_estudio = fecha;

  const { data: registro, error } = await supabase.from(TABLA).insert(fila).select(COLUMNAS).single();
  if (error) throw error;
  return res.status(200).json({ registro, subida });
}

async function confirmar(body, res, user) {
  const fila = await filaDelUsuario(user.id, body.id, 'id, estado, storage_path');
  if (!fila) return noEncontrado(res);
  if (fila.estado !== 'subiendo') {
    return res.status(200).json({ registro: await filaDelUsuario(user.id, fila.id) }); // idempotente
  }
  const obj = await objetoEnStorage(fila.storage_path);
  if (!obj) return res.status(409).json({ error: 'audio_no_recibido', mensaje: 'El audio todavía no llegó al servidor' });
  const cambios = { estado: 'pendiente' };
  if (obj.size) cambios.tamano_bytes = obj.size;
  return res.status(200).json({ registro: await actualizarFila(user.id, fila.id, cambios) });
}

async function subirViaFuncion(req, res, user) {
  const form = new IncomingForm({ keepExtensions: true, maxFileSize: MAX_BYTES });
  const { fields, files } = await new Promise((resolve, reject) => {
    form.parse(req, (e, f, fl) => (e ? reject(e) : resolve({ fields: f, files: fl })));
  });
  const campo = v => (Array.isArray(v) ? v[0] : v);
  if (campo(fields.action) !== 'subir') return res.status(400).json({ error: 'action inválida' });

  const fila = await filaDelUsuario(user.id, campo(fields.id), 'id, estado, storage_path, mime_type');
  if (!fila) return noEncontrado(res);
  if (fila.estado !== 'subiendo') {
    return res.status(200).json({ registro: await filaDelUsuario(user.id, fila.id) }); // ya estaba subido
  }
  const archivo = campo(files.file);
  if (!archivo) return res.status(400).json({ error: 'sin_archivo', mensaje: 'No se recibió el audio' });

  const buffer = fs.readFileSync(archivo.filepath || archivo.path);
  const tipo = String(fila.mime_type || archivo.mimetype || 'application/octet-stream').split(';')[0];
  const { error: errUp } = await supabase.storage.from(BUCKET).upload(fila.storage_path, buffer, {
    contentType: tipo,
    upsert: true
  });
  if (errUp) throw errUp;
  const registro = await actualizarFila(user.id, fila.id, { estado: 'pendiente', tamano_bytes: buffer.length });
  return res.status(200).json({ registro });
}

async function listar(body, res, user) {
  const filtro = String(body.estado || 'pendiente');
  const limite = Math.min(Math.max(parseInt(body.limite, 10) || 50, 1), 100);
  const desde = Math.max(parseInt(body.desde, 10) || 0, 0);

  let q = supabase.from(TABLA).select(COLUMNAS).eq('user_id', user.id);
  if (filtro === 'pendiente') q = q.in('estado', ['subiendo', 'pendiente']);
  else if (ESTADOS.includes(filtro)) q = q.eq('estado', filtro);
  // 'todos' → sin filtro de estado

  const busqueda = normalizar(body.q).replace(/[%_*\\]/g, '').slice(0, 80);
  if (busqueda) q = q.ilike('nombre_busqueda', `%${busqueda}%`);

  const { data, error } = await q.order('created_at', { ascending: false }).range(desde, desde + limite);
  if (error) throw error;
  const conteos = await contarPorEstado(user.id);
  return res.status(200).json({
    registros: (data || []).slice(0, limite),
    hay_mas: (data || []).length > limite,
    conteos
  });
}

async function obtener(body, res, user) {
  const registro = await filaDelUsuario(user.id, body.id);
  if (!registro) return noEncontrado(res);
  return res.status(200).json({ registro });
}

async function audioUrl(body, res, user) {
  const fila = await filaDelUsuario(user.id, body.id, 'id, estado, storage_path');
  if (!fila) return noEncontrado(res);
  if (fila.estado === 'subiendo') return todaviaSubiendo(res);
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(fila.storage_path, 600);
  if (error) throw error;
  return res.status(200).json({ url: data.signedUrl, expira_en: 600 });
}

async function transcribir(body, res, user) {
  const fila = await filaDelUsuario(user.id, body.id, 'id, estado, storage_path, transcripcion');
  if (!fila) return noEncontrado(res);
  if (fila.estado === 'subiendo') return todaviaSubiendo(res);
  if (fila.transcripcion !== null && fila.transcripcion !== undefined && !body.forzar) {
    return res.status(200).json({ registro: await filaDelUsuario(user.id, fila.id) }); // no se paga dos veces
  }
  const { data: blob, error: errDesc } = await supabase.storage.from(BUCKET).download(fila.storage_path);
  if (errDesc) throw errDesc;
  const audio = Buffer.from(await blob.arrayBuffer());
  const texto = await whisper(audio, fila.storage_path.split('.').pop());

  const cambios = { transcripcion: texto, transcrito_at: new Date().toISOString() };
  if (fila.estado === 'pendiente' || fila.estado === 'descartado') cambios.estado = 'transcrito';
  return res.status(200).json({ registro: await actualizarFila(user.id, fila.id, cambios) });
}

async function cambiarEstado(body, res, user) {
  const nuevo = String(body.estado || '');
  if (!['pendiente', 'descartado', 'informado'].includes(nuevo)) {
    return res.status(400).json({ error: 'estado_invalido', mensaje: 'Estado inválido' });
  }
  const fila = await filaDelUsuario(user.id, body.id, 'id, estado, transcripcion');
  if (!fila) return noEncontrado(res);
  if (fila.estado === 'subiendo') return todaviaSubiendo(res);

  const cambios = {};
  if (nuevo === 'pendiente') {
    // "Restaurar": vuelve a donde estaba antes de descartarlo
    cambios.estado = fila.transcripcion !== null && fila.transcripcion !== undefined ? 'transcrito' : 'pendiente';
  } else {
    cambios.estado = nuevo;
    if (nuevo === 'informado') cambios.informado_at = new Date().toISOString();
  }
  return res.status(200).json({ registro: await actualizarFila(user.id, fila.id, cambios) });
}

async function actualizar(body, res, user) {
  const fila = await filaDelUsuario(user.id, body.id, 'id');
  if (!fila) return noEncontrado(res);
  const cambios = {};
  if ('paciente_nombre' in body) {
    const n = limpiarTexto(body.paciente_nombre, 200);
    if (!n) return res.status(400).json({ error: 'nombre_requerido', mensaje: 'Falta el nombre del paciente' });
    cambios.paciente_nombre = n;
    cambios.nombre_busqueda = normalizar(n);
  }
  if ('paciente_edad' in body) cambios.paciente_edad = limpiarTexto(body.paciente_edad, 40);
  if ('fecha_estudio' in body) {
    const f = fechaValida(body.fecha_estudio);
    if (!f) return res.status(400).json({ error: 'fecha_invalida', mensaje: 'Fecha inválida' });
    cambios.fecha_estudio = f;
  }
  if ('modalidad' in body) cambios.modalidad = limpiarTexto(body.modalidad, 60);
  if (!Object.keys(cambios).length) return res.status(400).json({ error: 'sin_cambios', mensaje: 'No hay cambios' });
  return res.status(200).json({ registro: await actualizarFila(user.id, fila.id, cambios) });
}

async function eliminar(body, res, user) {
  const fila = await filaDelUsuario(user.id, body.id, 'id, storage_path');
  if (!fila) return res.status(200).json({ ok: true }); // ya no existía
  const { error: errSt } = await supabase.storage.from(BUCKET).remove([fila.storage_path]);
  if (errSt) throw errSt;
  const { error } = await supabase.from(TABLA).delete().eq('id', fila.id).eq('user_id', user.id);
  if (error) throw error;
  return res.status(200).json({ ok: true });
}

const ACCIONES = {
  crear, confirmar, listar, obtener, transcribir, actualizar, eliminar,
  audio_url: audioUrl,
  estado: cambiarEstado
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const authUser = await verificarToken(req);
  if (!authUser) return res.status(401).json({ error: 'no_autorizado', mensaje: 'Sesión inválida o expirada' });

  try {
    if (String(req.headers['content-type'] || '').startsWith('multipart/form-data')) {
      return await subirViaFuncion(req, res, authUser);
    }
    const body = req.body || {};
    const accion = ACCIONES[body.action];
    if (!accion) return res.status(400).json({ error: 'action inválida' });
    return await accion(body, res, authUser);
  } catch (e) {
    console.error('Error registro:', e);
    if (esFaltaDeConfiguracion(e)) {
      return res.status(503).json({
        error: 'registro_no_configurado',
        mensaje: 'El registro de audios se está activando. Probá de nuevo en unos minutos.'
      });
    }
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
