// /api/auth-login.js — Login proxy a través de Vercel para evitar bloqueos CORS en iOS
// Acciones: login (por defecto), signup, recover, refresh, update_password
// (update_password se usa al volver del enlace de "Recuperar contraseña" del correo).

// Adonde vuelve el enlace del correo de recuperación (debe estar entre las Redirect URLs
// de Supabase; si no lo está, Supabase usa el Site URL del proyecto).
const APP_URL = (process.env.APP_URL || 'https://www.infoeasyrad.com').replace(/\/+$/, '');

// fetch de Node falla con TypeError "fetch failed" cuando Supabase no responde
// (proyecto pausado, caída de red): no es un problema de credenciales.
function esErrorDeRed(e) {
  const causa = (e && e.cause && (e.cause.code || e.cause.message)) || '';
  const texto = ((e && e.message) || String(e)) + ' ' + causa;
  return (e && e.name === 'TypeError') || /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(texto);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const reqBody = req.body || {};
  const { email, password, action } = reqBody;
  if ((!action || action === 'login') && (!email || !password)) return res.status(400).json({ error: 'Email y contraseña requeridos' });

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_ANON = process.env.SUPABASE_ANON_KEY;
  if (!SUPA_URL || !SUPA_ANON) {
    console.error('auth-login: falta SUPABASE_URL o SUPABASE_ANON_KEY');
    return res.status(500).json({ error: 'Configuración del servidor incompleta' });
  }

  try {
    let endpoint, body, method = 'POST', autorizacion = `Bearer ${SUPA_ANON}`;

    if (action === 'signup') {
      endpoint = '/auth/v1/signup';
      body = { email, password, data: reqBody.data || {} };
    } else if (action === 'recover') {
      if (!email) return res.status(400).json({ error: 'Ingresá tu email primero' });
      endpoint = '/auth/v1/recover?redirect_to=' + encodeURIComponent(APP_URL + '/');
      body = { email };
    } else if (action === 'refresh') {
      endpoint = '/auth/v1/token?grant_type=refresh_token';
      body = { refresh_token: reqBody.refresh_token };
    } else if (action === 'update_password') {
      if (!reqBody.access_token) {
        return res.status(400).json({ error: 'El enlace de recuperación no es válido. Pedí uno nuevo con «¿Olvidaste tu contraseña?».' });
      }
      if (!password || String(password).length < 8) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
      }
      endpoint = '/auth/v1/user';
      method = 'PUT';
      autorizacion = `Bearer ${reqBody.access_token}`; // sesión que abre el enlace del correo
      body = { password: String(password) };
    } else {
      // login por defecto
      endpoint = '/auth/v1/token?grant_type=password';
      body = { email, password };
    }

    const r = await fetch(SUPA_URL + endpoint, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPA_ANON,
        'Authorization': autorizacion
      },
      body: JSON.stringify(body)
    });

    const d = await r.json().catch(() => ({}));
    console.log('auth-login', action || 'login', r.status); // nunca registrar tokens

    if (!r.ok) {
      if (action === 'update_password' && (r.status === 401 || r.status === 403)) {
        return res.status(401).json({ error: 'El enlace de recuperación venció o ya se usó. Pedí uno nuevo con «¿Olvidaste tu contraseña?».' });
      }
      const errMsg = d.error_description || d.error || d.message || d.msg || '';
      console.error('Auth error:', r.status, errMsg);
      if (!errMsg && r.status >= 500) {
        return res.status(503).json({ error: 'No se pudo conectar con el servidor. Probá de nuevo en unos minutos.' });
      }
      if (action === 'recover') {
        if (/rate limit|too many/i.test(errMsg)) {
          return res.status(429).json({ error: 'Se enviaron demasiados correos seguidos. Esperá unos minutos y probá de nuevo.' });
        }
        if (/not authorized|sending|smtp/i.test(errMsg)) {
          return res.status(r.status).json({ error: 'No pudimos enviar el correo de recuperación a esa dirección. Probá más tarde o escribinos a soporte.' });
        }
      }
      return res.status(r.status).json({ error: errMsg || 'Error de autenticación' });
    }

    if (action === 'update_password') return res.status(200).json({ ok: true, email: d.email || null });
    return res.status(200).json(d);

  } catch (e) {
    console.error('Error auth-login:', e && e.message);
    if (esErrorDeRed(e)) {
      return res.status(503).json({ error: 'No se pudo conectar con el servidor. Probá de nuevo en unos minutos.' });
    }
    return res.status(500).json({ error: e.message });
  }
};
