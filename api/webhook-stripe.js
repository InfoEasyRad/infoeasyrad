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
