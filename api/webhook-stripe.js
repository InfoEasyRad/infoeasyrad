
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
Webhook stripe · JS
// /api/webhook-stripe.js — Recibe eventos de Stripe para gestionar suscripciones
export const config = { api: { bodyParser: false } };
 
import { createClient } from '@supabase/supabase-js';
 
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
 
const PRICE_A_PLAN = {
  // Mapear price IDs de Stripe a planes — se completan cuando crees los productos en Stripe
  // 'price_xxx': 'starter',
  // 'price_yyy': 'pro',
  // 'price_zzz': 'ilimitado',
};
 
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
 
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');
 
  // Verificar firma de Stripe
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    const stripe = (await import('stripe')).default(process.env.STRIPE_SECRET_KEY);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('Firma Stripe inválida:', e.message);
    return res.status(400).json({ error: 'Firma inválida' });
  }
 
  const stripe = (await import('stripe')).default(process.env.STRIPE_SECRET_KEY);
 
  try {
    switch (event.type) {
 
      case 'checkout.session.completed': {
        const session = event.data.object;
        const email = session.customer_details?.email;
        const customerId = session.customer;
        const subscriptionId = session.subscription;
 
        // Obtener el plan desde el price ID
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = subscription.items.data[0]?.price?.id;
        const plan = PRICE_A_PLAN[priceId] || 'starter';
 
        await supabase
          .from('usuarios')
          .update({
            plan,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            suscripcion_activa: true,
            trial_activo: false
          })
          .eq('email', email.toLowerCase());
        break;
      }
 
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused': {
        const sub = event.data.object;
        await supabase
          .from('usuarios')
          .update({ plan: 'gratis', suscripcion_activa: false })
          .eq('stripe_subscription_id', sub.id);
        break;
      }
 
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const priceId = sub.items.data[0]?.price?.id;
        const plan = PRICE_A_PLAN[priceId];
        if (plan) {
          await supabase
            .from('usuarios')
            .update({ plan, suscripcion_activa: sub.status === 'active' })
            .eq('stripe_subscription_id', sub.id);
        }
        break;
      }
    }
 
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('Error webhook:', e);
    return res.status(500).json({ error: e.message });
  }
}
 
