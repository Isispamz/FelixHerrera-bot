let client = null;

function ensureClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return false; // No configurado => no usar Twilio
  if (!client) {
    const twilio = require('twilio');
    client = twilio(sid, token);
  }
  return true;
}

// Llama primero a tu número y luego conecta con el otro número.
// Si Twilio no está configurado, simplemente no hace nada.
async function startClickToCall(userNumber, otherNumber) {
  if (!ensureClient()) return { ok: false, reason: 'TWILIO_NOT_CONFIGURED' };
  const twiml = `<Response><Dial callerId="${process.env.TWILIO_CALLER_ID}"><Number>${otherNumber}</Number></Dial></Response>`;
  await client.calls.create({ to: userNumber, from: process.env.TWILIO_CALLER_ID, twiml });
  return { ok: true };
}

module.exports = { startClickToCall };
