// server.js — Webhook de WhatsApp + router
const express = require('express');
const app = express();
const { handleIncoming } = require('./intentRouter');

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || process.env.VERIFY_TOKEN || 'felix-verify';
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Ping sencillo
app.get('/', (_, res) => res.status(200).send('Felix Herrera bot up ✅'));

// Verificación del webhook (GET) — Meta te manda hub.challenge
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Recepción de eventos (POST)
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    if (body?.object !== 'whatsapp_business_account') {
      // No es de WhatsApp; ignora con 200 para que no reintenten
      return res.sendStatus(20
