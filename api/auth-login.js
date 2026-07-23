// /api/auth-login.js — Login proxy a través de Vercel para evitar bloqueos CORS en iOS
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { email, password, action } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_ANON = process.env.SUPABASE_ANON_KEY;

  try {
    let endpoint, body;

    if (action === 'signup') {
      endpoint = '/auth/v1/signup';
      body = { email, password, data: req.body.data || {} };
    } else if (action === 'recover') {
      endpoint = '/auth/v1/recover';
      body = { email };
    } else {
      // login por defecto
      endpoint = '/auth/v1/token?grant_type=password';
      body = { email, password };
    }

    const r = await fetch(SUPA_URL + endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPA_ANON,
        'Authorization': `Bearer ${SUPA_ANON}`
      },
      body: JSON.stringify(body)
    });

    const d = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({ error: d.error_description || d.error || d.message || 'Error de autenticación' });
    }

    return res.status(200).json(d);

  } catch (e) {
    console.error('Error auth-login:', e);
    return res.status(500).json({ error: e.message });
  }
};
