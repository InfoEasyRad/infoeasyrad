// /api/status.js — Verifica el plan y cuántos informes le quedan al usuario
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const LIMITES = { trial: null, gratis: 5, starter: 50, pro: 200, ilimitado: null };

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { usuario_id } = req.body;
  if (!usuario_id) return res.status(400).json({ error: 'usuario_id requerido' });

  try {
    const { data: usuario, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('id', usuario_id)
      .single();

    if (error) throw error;

    const mesActual = new Date().toISOString().slice(0, 7);
    if (usuario.mes_actual !== mesActual) {
      await supabase
        .from('usuarios')
        .update({ informes_mes: 0, mes_actual: mesActual })
        .eq('id', usuario_id);
      usuario.informes_mes = 0;
    }

    const limite = LIMITES[usuario.plan];
    const puedeGenerar = limite === null || usuario.informes_mes < limite;
    const restantes = limite === null ? null : limite - usuario.informes_mes;

    return res.status(200).json({
      plan: usuario.plan,
      trial_activo: usuario.trial_activo,
      informes_mes: usuario.informes_mes,
      limite_mensual: limite,
      restantes,
      puede_generar: puedeGenerar,
      suscripcion_activa: usuario.suscripcion_activa
    });

  } catch (e) {
    console.error('Error status:', e);
    return res.status(500).json({ error: e.message });
  }
};
