import { createMessageHandler } from '../services/messageHandler.js';

/**
 * Recibe cada evento del webhook de WhatsApp (POST /webhook).
 * Extrae el primer mensaje del payload de Meta y lo pasa al MessageHandler.
 * Siempre responde 200: si Meta recibe otra cosa, reintenta el envío del
 * evento, así que devolver 200 apenas se acepta el mensaje evita reintentos
 * innecesarios aunque el procesamiento interno todavía esté en curso.
 */
export async function handleIncoming(c) {
  const body = await c.req.json().catch(() => ({}));

  const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const senderInfo = body.entry?.[0]?.changes?.[0]?.value?.contacts?.[0];

  // Meta entrega los números argentinos con un "9" extra después del código
  // de país (ej: 549261XXXXXXX). Lo normalizamos a 54261XXXXXXX para que
  // coincida con el formato que se usa al responder y con PROFESSOR_PHONE.
  if (message?.from?.startsWith('549')) {
    message.from = '54' + message.from.slice(3);
  }

  if (message) {
    const messageHandler = createMessageHandler(c.env);
    await messageHandler.handleIncomingMessage(message, senderInfo);
  }

  return c.text('OK', 200);
}

/**
 * Responde al challenge de verificación que envía Meta al configurar o
 * reconfirmar el webhook (GET /webhook), validando el verify token propio.
 */
export function verifyWebhook(c) {
  const mode = c.req.query('hub.mode');
  const token = c.req.query('hub.verify_token');
  const challenge = c.req.query('hub.challenge');

  if (mode === 'subscribe' && token === c.env.WEBHOOK_VERIFY_TOKEN) {
    console.log('Webhook verified successfully!');
    return c.text(challenge, 200);
  }

  return c.text('Forbidden', 403);
}
