// server.js
const express = require('express');
const { handleIncoming } = require('./intentRouter');

const app = express();
app.use(express.json({ limit: '2mb' }));

// Saludos rápidos / healthcheck
app.get('/', (_req, res) => res.status(200).send('FelixHerrera-bot OK'));

// Verificación del Webhook de Meta (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Recepción de eventos de WhatsApp (POST)
app.post('/webhook', async (req, res) => {
  try {
    // Desarmamos el payload de Meta
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];

    // Log útil para depurar
    const preview =
      (msg?.text?.body || msg?.button?.text || msg?.interactive?.button_reply?.title || '').slice(0, 80);
    console.log('[webhook] incoming:', {
      from: msg?.from,
      type: msg?.type,
      hasText: Boolean(preview),
      preview,
    });

    // Si no hay mensaje (p.ej. son "statuses"), respondemos 200 y listo
    if (!msg) return res.sendStatus(200);

    // Enviamos el mensaje tal cual al router
    await handleIncoming(msg);

    return res.sendStatus(200);
  } catch (err) {
    console.error('[webhook] error:', err?.message || err);
    // Siempre responder 200 para que Meta no reintente
    return res.sendStatus(200);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server on :${PORT}`);
});
