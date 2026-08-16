import { createMessageHandler } from '../services/messageHandler.js';

export async function handleIncoming(c) {
  const body = await c.req.json().catch(() => ({}));

  const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const senderInfo = body.entry?.[0]?.changes?.[0]?.value?.contacts?.[0];

  if (message?.from?.startsWith('549')) {
    message.from = '54' + message.from.slice(3);
  }

  if (message) {
    const messageHandler = createMessageHandler(c.env);
    await messageHandler.handleIncomingMessage(message, senderInfo);
  }

  return c.text('OK', 200);
}

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
