import config from '../config/env.js';
import messageHandler from '../services/messageHandler.js';

class WebhookController {
  /**
   * Recibe cada evento del webhook de WhatsApp (POST /webhook).
   * Extrae el primer mensaje del payload de Meta y lo pasa al MessageHandler.
   */
  async handleIncoming(req, res) {
    const message = req.body.entry?.[0]?.changes[0]?.value?.messages?.[0];
    const senderInfo = req.body.entry?.[0]?.changes[0]?.value?.contacts?.[0];

    // Meta entrega los números argentinos con un "9" extra después del código
    // de país (ej: 549261XXXXXXX). Lo normalizamos a 54261XXXXXXX para que
    // coincida con el formato que se usa al responder y con PROFESSOR_PHONE.
    if (message?.from?.startsWith("549")) {
      message.from = "54" + message.from.slice(3);
    }

    if (message) {
      await messageHandler.handleIncomingMessage(message, senderInfo);
    }
    res.sendStatus(200);
  }

  /**
   * Responde al challenge de verificación que envía Meta al configurar o
   * reconfirmar el webhook (GET /webhook), validando el verify token propio.
   */
  verifyWebhook(req, res) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === config.WEBHOOK_VERIFY_TOKEN) {
      res.status(200).send(challenge);
      console.log('Webhook verified successfully!');
    } else {
      res.sendStatus(403);
    }
  }
}

export default new WebhookController();