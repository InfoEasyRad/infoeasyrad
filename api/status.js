
/
Ahora entiendo — Supabase actualizó su sistema de keys. Las tuyas son el nuevo formato sb_publishable_ y sb_secret_ que ya me pasaste antes.

Pero también necesito las keys legacy para la librería que vamos a usar. Clic en la pestaña "Legacy anon, service_role API keys" que ves arriba.

eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1cWtneGxkZGJqdmN4emFzbmJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyMDU1NzEsImV4cCI6MjA5OTc4MTU3MX0.saPSEkGfoeA2QBqM-XwJXaUj0CvCmZ7jJ0jus6h7XvY

Perfecto, tengo el anon key. Ahora clic en el ícono del ojo 👁 al lado de la service_role para revelarla y pasámela.

eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1cWtneGxkZGJqdmN4emFzbmJhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDIwNTU3MSwiZXhwIjoyMDk5NzgxNTcxfQ.P7sk7KqUTEb8R4Cer7MFBRVi9WQdwnmev5muWpYqilY

Perfecto. Tengo todo lo que necesito:

✅ Supabase URL: https://huqkgxlddbjvcxzasnba.supabase.co
✅ Supabase anon key
✅ Supabase service_role key
✅ Stripe publishable key
✅ Stripe secret key
Ahora construyo todo. Primero la base de datos en Supabase, luego las funciones de Vercel.

PASO 1 — Crear las tablas en Supabase

Abrí tu proyecto en Supabase → clic en SQL Editor en el menú izquierdo → New query → pegá esto y ejecutá:


Creó un archivo, archivo leído
Creó un archivo, archivo leído
Descargá ese archivo, abrilo con cualquier editor de texto y copiá todo el contenido.

Luego en Supabase:

Menú izquierdo → SQL Editor
New query
Pegá todo el SQL
Clic en Run
Cuando diga Success mandame captura y arrancamos con las funciones de Vercel.


Supabase schema
Código · SQL 
Captura de pantalla 2026-07-17 a la(s) 10.41.01 a. m..png
Success. No rows returned — base de datos creada perfectamente. ✅

Ahora construyo las funciones de Vercel. Son 4 endpoints:

/api/auth — registra o busca al usuario
/api/status — verifica plan y cuántos informes le quedan
/api/generate — genera el informe (llama a OpenAI con tu key)
/api/transcribe — transcribe el audio (llama a Whisper con tu key)

Se crearon 5 archivos, ejecutó un comando
Se crearon 5 archivos, ejecutó un comando
Ahora el archivo de variables de entorno para Vercel:


Creó un archivo, ejecutó un comando, archivo leído
Creó un archivo, ejecutó un comando, archivo leído
Listo. Ahora subís los archivos a GitHub. En tu repo infoeasyrad necesitás crear una carpeta api con los 5 archivos:

En GitHub:

Abrí github.com/InfoEasyRad/infoeasyrad
Clic en Add file → Create new file
En el nombre escribí api/auth.js — GitHub crea la carpeta automáticamente
Pegá el contenido de auth.js
Repetí para status.js, generate.js, transcribe.js y webhook-stripe.js
Luego en Vercel:

Abrí tu proyecto en vercel.com
Settings → Environment Variables
Agregá cada variable del archivo env-vercel.txt (necesitás poner tu API key de OpenAI)
¿Arrancás con GitHub o querés que te guíe paso a paso?


Auth
JS 

Status
JS 

Generate
JS 

Transcribe
JS 

Webhook stripe
JS 

Env vercel
TXT 
con repetir el procesos debo de crear folders nuevos con cada uno

No, GitHub lo hace automático. Cuando escribís el nombre del archivo incluís la carpeta:

Clic en Add file → Create new file
En el campo del nombre escribís: api/auth.js
GitHub automáticamente crea la carpeta api y el archivo adentro
Pegás el contenido → Commit
Luego repetís lo mismo para cada uno — siempre empezando con api/ en el nombre:

api/status.js
api/generate.js
api/transcribe.js
api/webhook-stripe.js
Cada uno es un commit separado. ¿Arrancamos?








Claude es IA y puede cometer errores. Por favor, verifica nuevamente las respuestas.
Status · JS
// /api/status.js — Verifica el plan y cuántos informes le quedan al usuario
import { createClient } from '@supabase/supabase-js';
 
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
 
const LIMITES = {
  trial:     null,  // ilimitado durante trial
  gratis:    5,
  starter:   50,
  pro:       200,
  ilimitado: null   // sin límite
};
 
export default async function handler(req, res) {
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
 
    // Resetear contador si cambió el mes
    const mesActual = new Date().toFullYear
      ? new Date().toISOString().slice(0, 7)
      : new Date().toISOString().slice(0, 7);
 
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
}
