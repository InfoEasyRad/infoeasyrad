// /api/checkout.js — Crea una sesión de Stripe Checkout
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PLAN_POR_PRICE = {
  'price_1Tvk952UwoUQkw5sFpEbLoS3': 'basico',
  'price_1Tvk962UwoUQkw5sQwSXlupm': 'basico',
  'price_1Tvk972UwoUQkw5sSO9EEHN9': 'pro',
  'price_1Tvk972UwoUQkw5s8O3e4hZ0': 'pro',
  'price_1Tvk982UwoUQkw5stwF6ec8R': 'clinica',
  'price_1Tvk982UwoUQkw5sJOBbShcm': 'clinica',
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { usuario_id, email, price_id, plan } = req.body;
  if (!usuario_id || !email || !price_id) {
    return res.status(400).json({ error: 'Faltan parámetros' });
  }

  try {
    const Stripe = require('stripe');
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

    // Buscar o crear customer en Stripe
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('stripe_customer_id')
      .eq('id', usuario_id)
      .single();

    let customerId = usuario?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email });
      customerId = customer.id;
      await supabase.from('usuarios')
        .update({ stripe_customer_id: customerId })
        .eq('id', usuario_id);
    }

    // Crear sesión de Checkout
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: price_id, quantity: 1 }],
      mode: 'subscription',
      success_url: `${process.env.APP_URL || 'https://infoeasyrad.vercel.app'}?pago=exitoso&plan=${plan}`,
      cancel_url: `${process.env.APP_URL || 'https://infoeasyrad.vercel.app'}?pago=cancelado`,
      metadata: { usuario_id, plan: PLAN_POR_PRICE[price_id] || plan }
    });

    return res.status(200).json({ url: session.url });

  } catch (e) {
    console.error('Error checkout:', e);
    return res.status(500).json({ error: e.message });
  }
};
