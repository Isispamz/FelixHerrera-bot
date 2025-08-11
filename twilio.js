const twilio = require('twilio');
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function startClickToCall(userNumber, otherNumber) {
  const twiml = `<Response><Dial callerId="${process.env.TWILIO_CALLER_ID}"><Number>${otherNumber}</Number></Dial></Response>`;
  await client.calls.create({ to: userNumber, from: process.env.TWILIO_CALLER_ID, twiml });
}

module.exports = { startClickToCall };
