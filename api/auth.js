// /api/auth.js — Registra o busca un usuario por email
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { email, nombre } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido' });

  try {
    // Buscar usuario existente
    let { data: usuario, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    // Si no existe, crearlo
    if (!usuario) {
      const { data: nuevo, error: errNuevo } = await supabase
        .from('usuarios')
        .insert({
          email: email.toLowerCase(),
          nombre: nombre || null,
          plan: 'trial',
          trial_activo: true,
          trial_inicio: new Date().toISOString()
        })
        .select()
        .single();

      if (errNuevo) throw errNuevo;
      usuario = nuevo;
    }

    // Verificar si el trial expiró (más de 30 días)
    if (usuario.trial_activo) {
      const inicio = new Date(usuario.trial_inicio);
      const diasTranscurridos = (Date.now() - inicio.getTime()) / (1000 * 60 * 60 * 24);
      if (diasTranscurridos > 30) {
        await supabase
          .from('usuarios')
          .update({ trial_activo: false, plan: 'gratis' })
          .eq('id', usuario.id);
        usuario.trial_activo = false;
        usuario.plan = 'gratis';
      }
    }

    return res.status(200).json({
      id: usuario.id,
      email: usuario.email,
      nombre: usuario.nombre,
      plan: usuario.plan,
      trial_activo: usuario.trial_activo,
      informes_mes: usuario.informes_mes,
      suscripcion_activa: usuario.suscripcion_activa
    });

  } catch (e) {
    console.error('Error auth:', e);
    return res.status(500).json({ error: e.message });
  }
}
