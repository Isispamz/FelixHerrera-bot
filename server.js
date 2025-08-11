import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import { handleIncoming } from './src/intentRouter.js';

const app = express();
app.use(bodyParser.json());

// Verificación del webhook
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Mensajes entrantes
app.post('/webhook', async (req, res) => {
  try {
    const changes = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = changes?.messages?.[0];
    if (msg) await handleIncoming(changes);
  } catch (e) {
    console.error('Webhook error', e);
  }
  res.sendStatus(200);
});

app.get('/', (_, res) => res.send('Félix Herrera bot up.'));

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server on :${process.env.PORT || 3000}`);
});
