const axios = require('axios');

const BASE = `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

async function sendText(to, body) {
  await axios.post(BASE, {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body }
  }, {
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });
}

module.exports = { sendText };
