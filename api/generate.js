// /api/generate.js — Genera el informe radiológico usando OpenAI (key server-side)
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const LIMITES = {
  trial:     null,
  gratis:    5,
  starter:   50,
  pro:       200,
  ilimitado: null
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { usuario_id, system_prompt, transcripcion } = req.body;
  if (!usuario_id || !system_prompt || !transcripcion) {
    return res.status(400).json({ error: 'Faltan parámetros: usuario_id, system_prompt, transcripcion' });
  }

  try {
    // Verificar usuario y límites
    const { data: usuario, error: errUser } = await supabase
      .from('usuarios')
      .select('*')
      .eq('id', usuario_id)
      .single();

    if (errUser) throw new Error('Usuario no encontrado');

    // Verificar mes y resetear si cambió
    const mesActual = new Date().toISOString().slice(0, 7);
    if (usuario.mes_actual !== mesActual) {
      await supabase
        .from('usuarios')
        .update({ informes_mes: 0, mes_actual: mesActual })
        .eq('id', usuario_id);
      usuario.informes_mes = 0;
    }

    // Verificar límite
    const limite = LIMITES[usuario.plan];
    if (limite !== null && usuario.informes_mes >= limite) {
      return res.status(403).json({
        error: 'limite_alcanzado',
        mensaje: `Alcanzaste el límite de ${limite} informes este mes. Actualizá tu plan para continuar.`,
        plan: usuario.plan,
        informes_mes: usuario.informes_mes
      });
    }

    // Generar informe con OpenAI (key guardada en el servidor)
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 2000,
        temperature: 0.3,
        messages: [
          { role: 'system', content: system_prompt },
          { role: 'user', content: transcripcion }
        ]
      })
    });

    if (!openaiRes.ok) {
      const errOpenAI = await openaiRes.json();
      throw new Error('Error OpenAI: ' + (errOpenAI.error?.message || openaiRes.status));
    }

    const openaiData = await openaiRes.json();
    const informe = openaiData.choices[0].message.content;

    // Incrementar contador del usuario
    await supabase
      .from('usuarios')
      .update({ informes_mes: usuario.informes_mes + 1 })
      .eq('id', usuario_id);

    // Registrar en tabla de informes
    await supabase
      .from('informes')
      .insert({ usuario_id, modalidad: req.body.modalidad || 'CCTA' });

    return res.status(200).json({
      informe,
      informes_mes: usuario.informes_mes + 1,
      limite_mensual: limite,
      restantes: limite === null ? null : limite - usuario.informes_mes - 1
    });

  } catch (e) {
    console.error('Error generate:', e);
    return res.status(500).json({ error: e.message });
  }
}
