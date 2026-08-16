import createWhatsappService from './whatsappService.js';
import createStateStore from './state.js';

// ⚠️ IMPORTANTE: número real del profesor (con código de país, sin el '+'
// ni el '9' intermedio en Argentina). Configurable vía wrangler.toml [vars].

/**
 * Orquesta toda la conversación de WhatsApp: enruta cada mensaje entrante
 * según prioridad (mensaje del profesor > cliente en modo puente > reserva
 * en curso > saludo/menú), envía los menús interactivos y arma las
 * respuestas. El estado de cada conversación vive en Workers KV
 * (ver state.js), no en memoria: una misma conversación puede caer en
 * distintas instancias del Worker entre un mensaje y el siguiente.
 */
class MessageHandler {
  constructor(env) {
    this.whatsappService = createWhatsappService(env);
    this.state = createStateStore(env.BOT_STATE);
    this.professorPhone = env.PROFESSOR_PHONE;
  }

  async handleIncomingMessage(message, senderInfo) {
    // 1. ENRUTADOR: ¿El mensaje viene del número del PROFESOR?
    if (message.from === this.professorPhone) {
      await this.handleProfessorMessage(message);
      await this.whatsappService.markAsRead(message.id);
      return;
    }

    // 2. ENRUTADOR: ¿El mensaje viene de un CLIENTE que está en modo chat?
    const activeChat = await this.state.getUser('chat', message.from);
    if (activeChat) {
      await this.handleClientBridgeMessage(message, senderInfo);
      await this.whatsappService.markAsRead(message.id);
      return;
    }

    if (message?.type === 'text') {
      // Si el usuario está en medio de agendar una cita, capturamos su respuesta
      const appointment = await this.state.getUser('appt', message.from);
      if (appointment) {
        await this.handleAppointmentFlow(message.from, message.text.body);
        await this.whatsappService.markAsRead(message.id);
        return;
      }

      const incomingMessage = message.text.body.toLowerCase().trim();
      if (this.isGreeting(incomingMessage)) {
        await this.sendWelcomeMessage(message.from, message.id, senderInfo);
        await this.sendWelcomeMenu(message.from);
      } else {
        await this.handleMenuOption(message.from, incomingMessage);
      }
      await this.whatsappService.markAsRead(message.id);
    } else if (message?.type === 'interactive') {
      const option = message?.interactive?.button_reply?.id;
      await this.handleMenuOption(message.from, option);
      await this.whatsappService.markAsRead(message.id);
    }
  }

  // --- Lógica del Cliente hacia el Profesor ---
  async handleClientBridgeMessage(message, senderInfo) {
    const to = message.from;
    const text = message.type === 'text' ? message.text.body : '';

    // El cliente decide salir del modo chat
    if (text.trim().toLowerCase() === 'volver') {
      await this.state.deleteUser('chat', to);
      const current = await this.state.getGlobal('currentClientForProfessor');
      if (current === to) {
        await this.state.deleteGlobal('currentClientForProfessor');
        await this.whatsappService.sendMessage(this.professorPhone, `⚠️ El cliente +${to} abandonó el chat.`);
      }
      await this.whatsappService.sendMessage(to, 'Chat finalizado. Regresando al menú principal 🔄');
      await this.sendWelcomeMenu(to);
      return;
    }

    // Enviar mensaje al profe
    if (message.type === 'text') {
      const userName = this.getSenderName(senderInfo);

      // Asignación automática: si el profe está libre, se le asigna este cliente
      const current = await this.state.getGlobal('currentClientForProfessor');
      if (!current) {
        await this.state.setGlobal('currentClientForProfessor', to);
        await this.whatsappService.sendMessage(
          this.professorPhone,
          `🔔 *NUEVO CHAT INICIADO*\nEstás hablando con: ${userName} (+${to})\nPara terminar la consulta, escribí */cerrar*`
        );
      }

      // Enviamos el mensaje etiquetado al profe
      await this.whatsappService.sendMessage(this.professorPhone, `💬 *${userName}:* ${text}`);

      const chat = await this.state.getUser('chat', to);
      if (chat && !chat.firstMessageSent) {
        await this.whatsappService.sendMessage(
          to,
          '✅ Tu mensaje fue enviado exitosamente. A la brevedad se estará comunicando el profe por este medio.'
        );
        await this.state.setUser('chat', to, { ...chat, firstMessageSent: true });
      }
    } else {
      await this.whatsappService.sendMessage(to, 'Por favor, escribí en formato de *texto*, o escribí *VOLVER* para salir.');
    }
  }

  // --- Lógica del Profesor hacia el Cliente ---
  async handleProfessorMessage(message) {
    const text = message.type === 'text' ? message.text.body : '';
    const current = await this.state.getGlobal('currentClientForProfessor');

    // Comando para terminar la sesión
    if (text.trim().toLowerCase() === '/cerrar') {
      if (current) {
        await this.state.deleteUser('chat', current);
        await this.state.deleteGlobal('currentClientForProfessor');

        await this.whatsappService.sendMessage(current, '👨‍🏫 El profesor ha finalizado la consulta. ¡Gracias!\n\nTe dejo nuevamente el menú principal:');
        await this.sendWelcomeMenu(current);
        await this.whatsappService.sendMessage(this.professorPhone, '✅ Sesión cerrada correctamente. Estás libre.');
      } else {
        await this.whatsappService.sendMessage(this.professorPhone, 'No hay ninguna sesión activa para cerrar.');
      }
      return;
    }

    // Reenviar respuesta al cliente activo
    if (current) {
      if (message.type === 'text') {
        await this.whatsappService.sendMessage(current, text);
      } else {
        await this.whatsappService.sendMessage(this.professorPhone, '⚠️ Por ahora, solo podés responder al cliente con texto.');
      }
    } else {
      await this.whatsappService.sendMessage(
        this.professorPhone,
        'No tenés ningún chat activo con un cliente. Cuando alguien elija la opción, se te asignará automáticamente.'
      );
    }
  }

  isGreeting(message) {
    const greetings = ['hola', 'hello', 'hi', 'buenas tardes'];
    return greetings.includes(message);
  }

  getSenderName(senderInfo) {
    return senderInfo.profile?.name || senderInfo.wa_id;
  }

  async sendWelcomeMessage(to, messageId, senderInfo) {
    const name = this.getSenderName(senderInfo);
    const firstName = name.split(' ')[0];
    const welcomeMessage = `Hola ${firstName} 👋, Soy Nexia tu asistencia virtual de *Nexus* y voy ayudarte con tus consultas.

Acá no solo entrenás: empezás a entender tu cuerpo, mejorar tu control y evolucionar con intención 🧠💪`;
    await this.whatsappService.sendMessage(to, welcomeMessage, messageId);
  }

  async sendWelcomeMenu(to) {
    const menuMessage = 'Elige una Opción';
    const buttons = [
      { type: 'reply', reply: { id: 'option_1', title: 'Planes' } },
      { type: 'reply', reply: { id: 'option_2', title: 'Clase de Prueba' } },
      { type: 'reply', reply: { id: 'option_3', title: 'Hablar con un Profe' } },
    ];

    await this.whatsappService.sendInteractiveButtons(to, menuMessage, buttons);
  }

  async sendPlansMenu(to) {
    const menuMessage = 'Elegí el tipo de plan que te interesa 💪';
    const buttons = [
      { type: 'reply', reply: { id: 'option_4', title: 'Grupal' } },
      { type: 'reply', reply: { id: 'option_5', title: 'Particular' } },
      { type: 'reply', reply: { id: 'option_6', title: 'Online' } },
    ];
    await this.whatsappService.sendInteractiveButtons(to, menuMessage, buttons);
  }

  async sendTrialMenu(to) {
    const menuMessage = '¿Qué modalidad te gustaría probar en tu clase? 🚀';
    const buttons = [
      { type: 'reply', reply: { id: 'trial_grupal', title: 'Grupal' } },
      { type: 'reply', reply: { id: 'trial_particular', title: 'Particular' } },
    ];
    await this.whatsappService.sendInteractiveButtons(to, menuMessage, buttons);
  }

  async handleMenuOption(to, option) {
    let response;
    // true para las opciones que arrancan un flujo propio (cita / puente con
    // el profe) — ahí no mostramos el menú "¿Qué querés hacer?" de vuelta.
    let skipAnswerBack = false;

    switch (option) {
      case 'back_main':
        await this.sendWelcomeMenu(to);
        return;
      case 'back_plans':
        await this.sendPlansMenu(to);
        return;
      case 'option_1':
        await this.sendPlansMenu(to);
        return;
      case 'option_2':
        await this.sendTrialMenu(to);
        return;
      case 'trial_grupal':
        await this.state.setUser('appt', to, { step: 'name', modality: 'Grupal', day: 'Sábado' });
        response = '¡Excelente elección para entrenar en equipo! 💪\n\nPara agendar tu clase de prueba, por favor escribime tu *Nombre y Apellido*:';
        skipAnswerBack = true;
        break;
      case 'trial_particular':
        await this.state.setUser('appt', to, { step: 'name', modality: 'Particular', day: 'Lunes' });
        response = '¡Perfecto, un enfoque 100% en vos! 🎯\n\nPara agendar tu clase de prueba, por favor escribime tu *Nombre y Apellido*:';
        skipAnswerBack = true;
        break;
      case 'option_3':
        await this.state.setUser('handoff', to, true);
        await this.state.setUser('chat', to, { firstMessageSent: false });
        response = 'Entendido 🤝. Escribí tu consulta en un solo mensaje y se la enviaré directamente a uno de los profes.\n\n_(Para cancelar y volver al menú, escribí la palabra *VOLVER*)_';
        skipAnswerBack = true;
        break;
      case 'option_4':
        response = `
🔹 *Clases Grupales* 🧠💪

Incluye:
✅ *Aprendizaje técnico desde la base*
✅ *Seguimiento presencial continuo*
✅ Progresión guiada y adaptada al grupo

🎯 *Ideal si:*
• Estás empezando a entrenar
• No tenés experiencia en calistenia
• Buscás estructura, guía y constancia

🗓 *Frecuencia:* 3 veces por semana
⏱ *Duración:* 1h 30m por clase
• *Martes y jueves:* 20:00 a 21:30
• *Sábados:* 11:00 a 12:30

👉 Enfocado en construir *base técnica, fuerza inicial y control corporal*, avanzando de forma *progresiva y con propósito*.

💰 *Valor mensual:* $40.000`;
        await this.sendLocationGrupal(to);
        break;
      case 'option_5':
        response = `🔹 *Clases Personalizadas* 🧠💪

Incluye:
✅ *Definición de objetivos*
✅ *Rutina personalizada* adaptada a tu nivel
✅ *Seguimiento técnico individual*
✅ Plan que evoluciona según tu progreso

🎯 *Ideal si buscás:*
• Un plan 100% individual
• Flexibilidad para entrenar a tu ritmo
• Trabajar objetivos específicos con enfoque técnico
• La posibilidad de entrenar solo o complementar con grupo

🗓 *Revisión presencial personalizada:*
• *Lunes:* 18:30 a 21:00

➕ *Opcional:* podés sumarte a entrenamientos grupales
• Miércoles
• Viernes

👉 Es la modalidad más versátil: organizás tus horarios y volumen de entrenamiento según tu disponibilidad, manteniendo siempre un enfoque *consciente y con propósito*.
💰 *Valor mensual:* $40.000`;
        await this.sendLocationParticular(to);
        break;
      case 'option_6':
        response = `
🔹 *Clases Online* 🧠💪

Incluye:
✅ *Evaluación inicial completa*
✅ Definición de *objetivos y planificación semanal*
✅ *Rutina personalizada* según tu nivel y disponibilidad
✅ *Seguimiento técnico online*
✅ Ajustes progresivos según tu evolución

🎯 *Ideal si:*
• No podés asistir de forma presencial
• Podés entrenar de manera independiente
• Buscás flexibilidad total de horarios
• Querés entrenar con criterio técnico y acompañamiento profesional

📲 *Seguimiento online:*
• Envío de fotos y videos
• Consultas técnicas
• Correcciones de ejercicios
(Las respuestas se dan dentro de tiempos operativos, priorizando la calidad del análisis)

🎥 *Reuniones online:*
• 2 encuentros mensuales por Meet
• Hasta 30 minutos cada uno
• Espacio para trabajar técnica, dudas y planificación

👉 Modalidad 100% adaptable: definimos juntos objetivos, volumen y frecuencia para lograr un entrenamiento *realista, progresivo y con propósito*.
💰 *Valor mensual:* $30.000`;
        break;
      default:
        response = 'Lo siento, no entendí tu selección, Por Favor, elige una de las opciones del menú.';
        break;
    }

    await this.whatsappService.sendMessage(to, response);
    if (!skipAnswerBack) {
      await this.answerBack(to);
    }
  }

  // Flujo de "hablar con un profe" cuando NO se usa el puente activo
  // (queda inerte hoy: nada dispara este método directamente, se conserva
  // por paridad con la versión original).
  async handleHumanHandoffFlow(message, senderInfo) {
    const to = message.from;
    const text = message.type === 'text' ? message.text.body : '';

    if (text.trim().toLowerCase() === 'volver') {
      await this.state.deleteUser('handoff', to);
      await this.whatsappService.sendMessage(to, 'Operación cancelada. Regresando al menú principal 🔄');
      await this.sendWelcomeMenu(to);
      return;
    }

    if (message.type === 'text') {
      const userName = this.getSenderName(senderInfo);
      const messageForProfessor = `🚨 *NUEVA CONSULTA* 🚨\n\n👤 *De:* ${userName}\n📱 *Número:* +${to}\n💬 *Mensaje:* "${text}"\n\n_Para responderle, tocá su número arriba para abrir el chat directo._`;

      await this.whatsappService.sendMessage(this.professorPhone, messageForProfessor);

      await this.state.deleteUser('handoff', to);
      await this.whatsappService.sendMessage(to, '✅ Tu mensaje fue enviado exitosamente al profesor. Se pondrá en contacto con vos a la brevedad.\n\nTe dejo nuevamente el menú principal:');
      await this.sendWelcomeMenu(to);
    } else {
      await this.whatsappService.sendMessage(to, 'Por favor, escribí tu consulta en formato de *texto*, o escribí *VOLVER* para cancelar.');
    }
  }

  async answerBack(to) {
    await this.whatsappService.sendInteractiveButtons(to, '¿Qué querés hacer?', [
      { type: 'reply', reply: { id: 'back_plans', title: '⬅️ Volver a planes' } },
      { type: 'reply', reply: { id: 'back_main', title: 'Menú principal' } },
    ]);
  }

  async sendLocationGrupal(to) {
    await this.whatsappService.sendLocationMessage(
      to,
      -32.932304,
      -68.85615,
      'Nexus-Grupal',
      'Parque San Vicente, Godoy Cruz, Mendoza'
    );
  }

  async sendLocationParticular(to) {
    await this.whatsappService.sendLocationMessage(
      to,
      -32.93122,
      -68.839338,
      'Nexus-Particular',
      'Cervantes 486, Godoy Cruz, Mendoza'
    );
  }

  async completeAppointment(to) {
    const appointment = await this.state.getUser('appt', to);
    await this.state.deleteUser('appt', to);

    const notificationForProfessor = `📅 *NUEVO TURNO AGENDADO* 📅\n\n👤 *Nombre:* ${appointment.name}\n📱 *Número:* +${to}\n🏋️‍♂️ *Modalidad:* ${appointment.modality}\n🎂 *Edad:* ${appointment.age}\n⚖️ *Peso/Altura:* ${appointment.metrics}\n🗓 *Día base:* ${appointment.day}\n\n_El alumno ya recibió el link del formulario inicial._`;
    await this.whatsappService.sendMessage(this.professorPhone, notificationForProfessor);

    return `¡Listo! Tu clase de prueba ha sido agendada con éxito 🎉.

📋 *Resumen de tu clase:*
👤 Nombre: ${appointment.name}
🏋️‍♂️ Modalidad: ${appointment.modality}
🗓 Día: ${appointment.day}
⏱ Hora: Nos pondremos en contacto!

Por último, te pido que completes este breve cuestionario para conocerte mejor antes de arrancar. Es súper importante:
👉 https://docs.google.com/forms/d/16CCzddeGjIaj1K93y7oyvVnallAAh7Gn0WsZydtUC3o/edit#response=ACYDBNhZmmg7gG8nE2LKHxIpduKNSr9CMhMDoDreeQNKl5X04_cUowy8SfL-yJDs41XqGYw

¡Nos vemos pronto en Nexus Calistenia!`;
  }

  async handleAppointmentFlow(to, message) {
    const appt = await this.state.getUser('appt', to);
    let response;
    let cleared = false;

    switch (appt.step) {
      case 'name':
        appt.name = message;
        appt.step = 'age';
        response = `Gracias ${appt.name}. ¿Cuál es tu *edad*?`;
        await this.state.setUser('appt', to, appt);
        break;
      case 'age':
        appt.age = message;
        appt.step = 'metrics';
        response = 'Perfecto. Ahora decime tu *peso y altura* aproximados (ejemplo: 70kg, 1.75m):';
        await this.state.setUser('appt', to, appt);
        break;
      case 'metrics':
        appt.metrics = message;
        appt.step = 'confirmation';
        response = `¡Casi listo! Resumen de tu clase de prueba:\n\n👤 *Nombre:* ${appt.name}\n🏋️‍♂️ *Modalidad:* ${appt.modality}\n🗓 *Día:* ${appt.day}\n🎂 *Edad:* ${appt.age}\n⚖️ *Peso/Altura:* ${appt.metrics}\n\n¿Estás de acuerdo con agendar este turno? Respondé *SI* para confirmar o *NO* para cancelar.`;
        await this.state.setUser('appt', to, appt);
        break;
      case 'confirmation': {
        const reply = message.toLowerCase().trim();
        if (reply === 'si' || reply === 'sí') {
          response = await this.completeAppointment(to);
          cleared = true;
        } else if (reply === 'no') {
          await this.state.deleteUser('appt', to);
          response = 'Turno cancelado correctamente.';
          cleared = true;
        } else {
          response = 'Por favor, respondé únicamente con *SI* para confirmar o *NO* para cancelar.';
          await this.whatsappService.sendMessage(to, response);
          return;
        }
        break;
      }
    }

    await this.whatsappService.sendMessage(to, response);
    if (cleared) {
      await this.answerBack(to);
    }
  }

  async sendContact(to) {
    const contact = {
      addresses: [
        {
          street: '123 Calle de las Mascotas',
          city: 'Ciudad',
          state: 'Estado',
          zip: '12345',
          country: 'País',
          country_code: 'PA',
          type: 'WORK',
        },
      ],
      emails: [{ email: 'contacto@medpet.com', type: 'WORK' }],
      name: {
        formatted_name: 'MedPet Contacto',
        first_name: 'MedPet',
        last_name: 'Contacto',
        middle_name: '',
        suffix: '',
        prefix: '',
      },
      org: { company: 'MedPet', department: 'Atención al Cliente', title: 'Representante' },
      phones: [{ phone: '+1234567890', wa_id: '1234567890', type: 'WORK' }],
      urls: [{ url: 'https://www.medpet.com', type: 'WORK' }],
    };

    await this.whatsappService.sendContactMessage(to, contact);
  }
}

export function createMessageHandler(env) {
  return new MessageHandler(env);
}

export default MessageHandler;
