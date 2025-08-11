import twilio from 'twilio';
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Llama primero a tu número y luego conecta con el número que te escribió por WhatsApp
export async function startClickToCall(userNumber, otherNumber) {
  const twiml = `<Response><Dial callerId="${process.env.TWILIO_CALLER_ID}"><Number>${otherNumber}</Number></Dial></Response>`;

  await client.calls.create({
    to: userNumber,
    from: process.env.TWILIO_CALLER_ID,
    twiml
  });
}
