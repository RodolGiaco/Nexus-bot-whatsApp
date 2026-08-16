// Workers runs on the native fetch API — no axios needed.

/**
 * API de alto nivel para enviar mensajes de WhatsApp (texto, botones,
 * medios, ubicación, contactos) y marcar mensajes como leídos, delegando
 * el POST a la Graph API en sendToWhatsApp().
 * @param {object} env - bindings/vars del Worker (BASE_URL, API_VERSION,
 *   BUSINESS_PHONE, API_TOKEN), definidos en wrangler.toml y como secrets.
 */
function createWhatsappService(env) {
  const url = `${env.BASE_URL}/${env.API_VERSION}/${env.BUSINESS_PHONE}/messages`;

  async function sendToWhatsApp(data) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        console.error('WhatsApp API error:', response.status, await response.text());
      }
    } catch (error) {
      console.error('Error sending to WhatsApp:', error);
    }
  }

  return {
    async sendMessage(to, body) {
      await sendToWhatsApp({
        messaging_product: 'whatsapp',
        to,
        text: { body },
      });
    },

    async sendInteractiveButtons(to, bodyText, buttons) {
      await sendToWhatsApp({
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: { buttons },
        },
      });
    },

    async sendMediaMessage(to, type, mediaUrl, caption) {
      const mediaObject = {};
      switch (type) {
        case 'image':
          mediaObject.image = { link: mediaUrl, caption };
          break;
        case 'audio':
          mediaObject.audio = { link: mediaUrl };
          break;
        case 'video':
          mediaObject.video = { link: mediaUrl, caption };
          break;
        case 'document':
          mediaObject.document = { link: mediaUrl, caption, filename: 'medpet-file.pdf' };
          break;
        default:
          throw new Error('Not Supported Media Type');
      }

      await sendToWhatsApp({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type,
        ...mediaObject,
      });
    },

    async markAsRead(messageId) {
      await sendToWhatsApp({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      });
    },

    async sendContactMessage(to, contact) {
      await sendToWhatsApp({
        messaging_product: 'whatsapp',
        to,
        type: 'contacts',
        contacts: [contact],
      });
    },

    async sendLocationMessage(to, latitude, longitude, name, address) {
      await sendToWhatsApp({
        messaging_product: 'whatsapp',
        to,
        type: 'location',
        location: { latitude, longitude, name, address },
      });
    },
  };
}

export default createWhatsappService;
