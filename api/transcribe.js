// /api/transcribe.js — Transcribe audio usando OpenAI Whisper (key server-side)
const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    const { FormData, Blob } = await import('node-fetch');
    const formData = new FormData();
    const blob = new Blob([buffer], { type: req.headers['content-type'] });
    formData.append('file', blob, 'audio.webm');
    formData.append('model', 'whisper-1');
    formData.append('language', 'es');
    formData.append('response_format', 'text');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: formData
    });

    if (!whisperRes.ok) {
      const err = await whisperRes.json();
      throw new Error('Error Whisper: ' + (err.error?.message || whisperRes.status));
    }

    const texto = await whisperRes.text();
    return res.status(200).json({ texto });

  } catch (e) {
    console.error('Error transcribe:', e);
    return res.status(500).json({ error: e.message });
  }
};
