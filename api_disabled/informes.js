// /api/informes.js — Historial de informes en la nube (requiere sesión válida)
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function verificarToken(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data || !data.user) return null;
  return data.user;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const authUser = await verificarToken(req);
  if (!authUser) return res.status(401).json({ error: 'no_autorizado', mensaje: 'Sesión inválida o expirada' });

  try {
    // Usuario derivado del token, nunca del body
    const { data: usuario, error: errUser } = await supabase
      .from('usuarios')
      .select('id')
      .eq('email', authUser.email.toLowerCase())
      .single();
    if (errUser || !usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    const { action } = req.body;

    if (action === 'list') {
      const { data, error } = await supabase
        .from('informes')
        .select('id, created_at, modalidad, nombre_paciente, texto')
        .eq('usuario_id', usuario.id)
        .not('texto', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return res.status(200).json({ informes: data });
    }

    if (action === 'save') {
      const { modalidad, nombre_paciente, texto } = req.body;
      if (!texto) return res.status(400).json({ error: 'texto requerido' });
      const { data, error } = await supabase
        .from('informes')
        .insert({
          usuario_id: usuario.id,
          modalidad: (modalidad || 'CCTA').slice(0, 100),
          nombre_paciente: (nombre_paciente || 'Sin nombre').slice(0, 200),
          texto: String(texto).slice(0, 50000)
        })
        .select('id, created_at')
        .single();
      if (error) throw error;
      return res.status(200).json({ id: data.id, created_at: data.created_at });
    }

    if (action === 'delete') {
      const { informe_id } = req.body;
      if (!informe_id) return res.status(400).json({ error: 'informe_id requerido' });
      const { error } = await supabase
        .from('informes')
        .delete()
        .eq('id', informe_id)
        .eq('usuario_id', usuario.id); // solo puede borrar los propios
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (action === 'clear') {
      const { error } = await supabase
        .from('informes')
        .delete()
        .eq('usuario_id', usuario.id)
        .not('texto', 'is', null); // conserva las filas de conteo sin texto
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'action inválida (list|save|delete|clear)' });
  } catch (e) {
    console.error('Error informes:', e);
    return res.status(500).json({ error: e.message });
  }
};
