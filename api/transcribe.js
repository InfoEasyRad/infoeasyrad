// /api/transcribe.js — Transcribe audio usando OpenAI Whisper (key server-side)
const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Usuario-Id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    // Leer el body como buffer
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    // Detectar el content-type del audio
    const contentType = req.headers['content-type'] || 'audio/webm';

    // Construir el multipart/form-data manualmente
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    
    // Determinar extensión del archivo
    let ext = 'webm';
    if (contentType.includes('mp4')) ext = 'mp4';
    else if (contentType.includes('mpeg')) ext = 'mp3';
    else if (contentType.includes('ogg')) ext = 'ogg';
    else if (contentType.includes('wav')) ext = 'wav';
    
    const filename = `audio.${ext}`;

    // Construir el body multipart manualmente
    const part1 = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`
    );
    const part2 = Buffer.from(`\r\n--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="language"\r\n\r\nes\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="response_format"\r\n\r\ntext\r\n` +
      `--${boundary}--\r\n`
    );

    const multipartBody = Buffer.concat([part1, buffer, part2]);

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: multipartBody
    });

    if (!whisperRes.ok) {
      const err = await whisperRes.text();
      throw new Error('Error Whisper: ' + err);
    }

    const texto = await whisperRes.text();
    return res.status(200).json({ texto });

  } catch (e) {
    console.error('Error transcribe:', e);
    return res.status(500).json({ error: e.message });
  }
};
