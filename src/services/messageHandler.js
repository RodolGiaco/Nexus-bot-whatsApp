import whatsappService from './whatsappService.js';

// ⚠️ IMPORTANTE: Reemplaza esto con el número real del profesor (con código de país, sin el '+' ni el '9' intermedio en Argentina). Ejemplo: '542610000000'
const PROFESSOR_PHONE = '542616268872';

/**
 * Orquesta toda la conversación de WhatsApp: enruta cada mensaje entrante
 * según prioridad (mensaje del profesor > cliente en modo puente > reserva
 * en curso > saludo/menú), envía los menús interactivos y arma las
 * respuestas. Mantiene el estado de cada conversación en memoria del
 * proceso, por eso esta variante solo tiene sentido en un servidor Node de
 * larga duración (a diferencia de worker/, que persiste el estado en KV).
 */
class MessageHandler {

  constructor() {
    this.appointmentState = {};
    // Estado para pausar el bot cuando un cliente pide hablar con el profesor
    this.humanHandoffState = {};

    // --- Sistema de sesiones (modo puente) ---
    this.activeChats = {}; // Clientes en chat con el profe: { '549...': true }
    this.currentClientForProfessor = null; // Guarda el ID del cliente al que el profe le está respondiendo
  }

  async handleIncomingMessage(message, senderInfo) {
    // 1. ENRUTADOR: ¿El mensaje viene del número del PROFESOR?
    if (message.from === PROFESSOR_PHONE) {
        await this.handleProfessorMessage(message);
        await whatsappService.markAsRead(message.id);
        return;
    }

    // 2. ENRUTADOR: ¿El mensaje viene de un CLIENTE que está en modo chat?
    if (this.activeChats[message.from]) {
        await this.handleClientBridgeMessage(message, senderInfo);
        await whatsappService.markAsRead(message.id);
        return;
    }

    // Si el usuario está en medio de agendar una cita, capturamos su respuesta de texto
    if (message?.type === 'text' && this.appointmentState[message.from]) {
      await this.handleAppointmentFlow(message.from, message.text.body);
      await whatsappService.markAsRead(message.id);
      return; 
    }

    if (message?.type === 'text') {
      const incomingMessage = message.text.body.toLowerCase().trim();

      if(this.isGreeting(incomingMessage)){
        await this.sendWelcomeMessage(message.from, message.id, senderInfo);
        await this.sendWelcomeMenu(message.from);
      } else {
        await this.handleMenuOption(message.from, incomingMessage);
      }
      await whatsappService.markAsRead(message.id);
    } else if (message?.type === 'interactive') {
      const option = message?.interactive?.button_reply?.id;
      await this.handleMenuOption(message.from, option);
      await whatsappService.markAsRead(message.id);
    }

  }

  // --- NUEVO: Lógica del Cliente hacia el Profesor ---
  async handleClientBridgeMessage(message, senderInfo) {
    const to = message.from;
    const text = message.type === 'text' ? message.text.body : '';

    // El cliente decide salir del modo chat
    if (text.trim().toLowerCase() === 'volver') {
        delete this.activeChats[to];
        // Si era el cliente actual del profe, lo liberamos
        if (this.currentClientForProfessor === to) {
            this.currentClientForProfessor = null;
            await whatsappService.sendMessage(PROFESSOR_PHONE, `⚠️ El cliente +${to} abandonó el chat.`);
        }
        await whatsappService.sendMessage(to, "Chat finalizado. Regresando al menú principal 🔄");
        await this.sendWelcomeMenu(to);
        return;
    }

    // Enviar mensaje al profe
    if (message.type === 'text') {
        const userName = this.getSenderName(senderInfo);
        
        // Asignación automática: si el profe está libre, se le asigna este cliente
        if (!this.currentClientForProfessor) {
            this.currentClientForProfessor = to;
            await whatsappService.sendMessage(PROFESSOR_PHONE, `🔔 *NUEVO CHAT INICIADO*\nEstás hablando con: ${userName} (+${to})\nPara terminar la consulta, escribí */cerrar*`);
        }

        // Enviamos el mensaje etiquetado al profe
        await whatsappService.sendMessage(PROFESSOR_PHONE, `💬 *${userName}:* ${text}`);

        if (!this.activeChats[to].firstMessageSent) {
            await whatsappService.sendMessage(to, "✅ Tu mensaje fue enviado exitosamente. A la brevedad se estará comunicando el profe por este medio.");
            this.activeChats[to].firstMessageSent = true; // Cambiamos el interruptor
        }
    } else {
        await whatsappService.sendMessage(to, "Por favor, escribí en formato de *texto*, o escribí *VOLVER* para salir.");
    }
  }

  // --- NUEVO: Lógica del Profesor hacia el Cliente ---
  async handleProfessorMessage(message) {
    const text = message.type === 'text' ? message.text.body : '';

    // Comando para terminar la sesión
    if (text.trim().toLowerCase() === '/cerrar') {
        if (this.currentClientForProfessor) {
            const clientId = this.currentClientForProfessor;
            delete this.activeChats[clientId];
            this.currentClientForProfessor = null;
            
            await whatsappService.sendMessage(clientId, "👨‍🏫 El profesor ha finalizado la consulta. ¡Gracias!\n\nTe dejo nuevamente el menú principal:");
            await this.sendWelcomeMenu(clientId);
            await whatsappService.sendMessage(PROFESSOR_PHONE, "✅ Sesión cerrada correctamente. Estás libre.");
        } else {
            await whatsappService.sendMessage(PROFESSOR_PHONE, "No hay ninguna sesión activa para cerrar.");
        }
        return;
    }

    // Reenviar respuesta al cliente activo
    if (this.currentClientForProfessor) {
        if (message.type === 'text') {
            await whatsappService.sendMessage(this.currentClientForProfessor, text);
        } else {
            await whatsappService.sendMessage(PROFESSOR_PHONE, "⚠️ Por ahora, solo podés responder al cliente con texto.");
        }
    } else {
        await whatsappService.sendMessage(PROFESSOR_PHONE, "No tenés ningún chat activo con un cliente. Cuando alguien elija la opción, se te asignará automáticamente.");
    }
  }

  isGreeting(message) {
    const greetings = ["hola", "hello", "hi", "buenas tardes"];
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
    await whatsappService.sendMessage(to, welcomeMessage, messageId);
  }

  async sendWelcomeMenu(to) {
    const menuMessage = "Elige una Opción"
    const buttons = [
      {
        type: 'reply', reply: { id: 'option_1', title: 'Planes' }
      },
      {
        type: 'reply', reply: { id: 'option_2', title: 'Clase de Prueba'}
      },
      {
        type: 'reply', reply: { id: 'option_3', title: 'Hablar con un Profe'}
      }
    ];

    await whatsappService.sendInteractiveButtons(to, menuMessage, buttons);
  }

  async sendPlansMenu(to) {
    const menuMessage = "Elegí el tipo de plan que te interesa 💪";

    const buttons = [
      {
        type: 'reply',
        reply: { id: 'option_4', title: 'Grupal' }
      },
      {
        type: 'reply',
        reply: { id: 'option_5', title: 'Particular' }
      },
      {
        type: 'reply',
        reply: { id: 'option_6', title: 'Online' }
      }
    ];
    await whatsappService.sendInteractiveButtons(to, menuMessage, buttons);
  }

  async sendTrialMenu(to) {
    const menuMessage = "¿Qué modalidad te gustaría probar en tu clase? 🚀";
    const buttons = [
      { type: 'reply', reply: { id: 'trial_grupal', title: 'Grupal' } },
      { type: 'reply', reply: { id: 'trial_particular', title: 'Particular' } }
    ];
    await whatsappService.sendInteractiveButtons(to, menuMessage, buttons);
  }
  

  waiting = (delay, callback) => {
    setTimeout(callback, delay);
  };
  

  async handleMenuOption(to, option) {
    let response;
    switch (option) {
      case 'back_main':
        await this.sendWelcomeMenu(to);
        return
      case 'back_plans':
        await this.sendPlansMenu(to);
        return
      case 'option_1':
        await this.sendPlansMenu(to);
        return
      case 'option_2':
        // Mostramos el submenú de clase de prueba
        await this.sendTrialMenu(to);
        return;
      case 'trial_grupal':
        // Iniciamos el estado para Grupal
        this.appointmentState[to] = { step: 'name', modality: 'Grupal', day: 'Sábado' };
        response = "¡Excelente elección para entrenar en equipo! 💪\n\nPara agendar tu clase de prueba, por favor escribime tu *Nombre y Apellido*:";
        break;
      case 'trial_particular':
         // Iniciamos el estado para Particular
        this.appointmentState[to] = { step: 'name', modality: 'Particular', day: 'Lunes' };
        response = "¡Perfecto, un enfoque 100% en vos! 🎯\n\nPara agendar tu clase de prueba, por favor escribime tu *Nombre y Apellido*:";
        break;
      case 'option_3':
        // 3. Activamos el estado y damos instrucciones al usuario
        this.humanHandoffState[to] = true;
        this.activeChats[to] = { firstMessageSent: false };
        response = "Entendido 🤝. Escribí tu consulta en un solo mensaje y se la enviaré directamente a uno de los profes.\n\n_(Para cancelar y volver al menú, escribí la palabra *VOLVER*)_";
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

💰 *Valor mensual:* $40.000`  
        await this.sendLocationGrupal(to);
        break
      case 'option_5': 
       response = 
`🔹 *Clases Personalizadas* 🧠💪

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
💰 *Valor mensual:* $40.000`
        await this.sendLocationParticular(to);
        break
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
💰 *Valor mensual:* $30.000`  
        break
      default: 
        response = "Lo siento, no entendí tu selección, Por Favor, elige una de las opciones del menú."
        break
    }
    await whatsappService.sendMessage(to, response);
    // Evitamos enviar el menú de retorno si el usuario está agendando o hablando con un profe
    if (!this.appointmentState[to] && !this.humanHandoffState[to]) {
      await this.answerBack(to);
    }
  }

  // 4. Nueva función para procesar la comunicación entre usuario y profesor
  async handleHumanHandoffFlow(message, senderInfo) {
    const to = message.from;
    const text = message.type === 'text' ? message.text.body : '';

    // Opción para abortar y salir del modo "Pausa"
    if (text.trim().toLowerCase() === 'volver') {
        delete this.humanHandoffState[to];
        await whatsappService.sendMessage(to, "Operación cancelada. Regresando al menú principal 🔄");
        await this.sendWelcomeMenu(to);
        return;
    }

    if (message.type === 'text') {
        const userName = this.getSenderName(senderInfo);
        
        // Construimos el aviso que recibirá el profesor
        const messageForProfessor = `🚨 *NUEVA CONSULTA* 🚨\n\n👤 *De:* ${userName}\n📱 *Número:* +${to}\n💬 *Mensaje:* "${text}"\n\n_Para responderle, tocá su número arriba para abrir el chat directo._`;

        // Reutilizamos whatsappService pero apuntando al PROFESSOR_PHONE
        await whatsappService.sendMessage(PROFESSOR_PHONE, messageForProfessor);

        // Limpiamos el estado y devolvemos al usuario al menú principal
        delete this.humanHandoffState[to];
        await whatsappService.sendMessage(to, "✅ Tu mensaje fue enviado exitosamente al profesor. Se pondrá en contacto con vos a la brevedad.\n\nTe dejo nuevamente el menú principal:");
        await this.sendWelcomeMenu(to);
    } else {
        await whatsappService.sendMessage(to, "Por favor, escribí tu consulta en formato de *texto*, o escribí *VOLVER* para cancelar.");
    }
  }

  async answerBack(to) {
     await whatsappService.sendInteractiveButtons(to, "¿Qué querés hacer?", [
        { type: 'reply', reply: { id: 'back_plans', title: '⬅️ Volver a planes' } },
        { type: 'reply', reply: { id: 'back_main', title: 'Menú principal' } }
      ]);
  
  }

   async sendLocationGrupal(to) {
    const latitude =  -32.932304;
    const longitude = -68.856150;
    const name = 'Nexus-Grupal';
    const address = 'Parque San Vicente, Godoy Cruz, Mendoza'; 

    await whatsappService.sendLocationMessage(to, latitude, longitude, name, address);
  }
  async sendLocationParticular(to) {
    const latitude = -32.931220;
    const longitude = -68.839338;
    const name = 'Nexus-Particular';
    const address = 'Cervantes 486, Godoy Cruz, Mendoza'

    await whatsappService.sendLocationMessage(to, latitude, longitude, name, address);
  }

  async sendMedia(to) {
    // const mediaUrl = 'https://s3.amazonaws.com/gndx.dev/medpet-audio.aac';
    // const caption = 'Bienvenida';
    // const type = 'audio';

    // const mediaUrl = 'https://s3.amazonaws.com/gndx.dev/medpet-imagen.png';
    // const caption = '¡Esto es una Imagen!';
    // const type = 'image';

    // const mediaUrl = 'https://s3.amazonaws.com/gndx.dev/medpet-video.mp4';
    // const caption = '¡Esto es una video!';
    // const type = 'video';

    const mediaUrl = 'https://s3.amazonaws.com/gndx.dev/medpet-file.pdf';
    const caption = '¡Esto es un PDF!';
    const type = 'document';

    await whatsappService.sendMediaMessage(to, type, mediaUrl, caption);
  }

async completeAppointment(to) {
    const appointment = this.appointmentState[to];
    delete this.appointmentState[to];

    // Array preparado para tu Google Sheets cuando lo habilites
    const userData = [
      to,
      appointment.name,
      appointment.age,
      appointment.metrics,
      appointment.modality,
      appointment.day,
      new Date().toISOString()
    ];

    // appendToSheet(userData);

    // 👉 NUEVO: Notificamos al profe sobre el nuevo turno agendado
    const notificationForProfessor = `📅 *NUEVO TURNO AGENDADO* 📅\n\n👤 *Nombre:* ${appointment.name}\n📱 *Número:* +${to}\n🏋️‍♂️ *Modalidad:* ${appointment.modality}\n🎂 *Edad:* ${appointment.age}\n⚖️ *Peso/Altura:* ${appointment.metrics}\n🗓 *Día base:* ${appointment.day}\n\n_El alumno ya recibió el link del formulario inicial._`;
    
    await whatsappService.sendMessage(PROFESSOR_PHONE, notificationForProfessor);

    // Devolvemos el mensaje de confirmación para el cliente
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
    const state = this.appointmentState[to];
    let response;

    switch (state.step) {
      case 'name':
        state.name = message;
        state.step = 'age';
        response = `Gracias ${state.name}. ¿Cuál es tu *edad*?`;
        break;
      case 'age':
        state.age = message;
        state.step = 'metrics';
        response = 'Perfecto. Ahora decime tu *peso y altura* aproximados (ejemplo: 70kg, 1.75m):';
        break;
      case 'metrics':
        state.metrics = message;
        state.step = 'confirmation'; 
        response = `¡Casi listo! Resumen de tu clase de prueba:\n\n👤 *Nombre:* ${state.name}\n🏋️‍♂️ *Modalidad:* ${state.modality}\n🗓 *Día:* ${state.day}\n🎂 *Edad:* ${state.age}\n⚖️ *Peso/Altura:* ${state.metrics}\n\n¿Estás de acuerdo con agendar este turno? Respondé *SI* para confirmar o *NO* para cancelar.`;
        break;
      case 'confirmation':
        const reply = message.toLowerCase().trim();
        if (reply === 'si' || reply === 'sí') {
          response = await this.completeAppointment(to);
        } else if (reply === 'no') {
          delete this.appointmentState[to];
          response = 'Turno cancelado correctamente.';
        } else {
          response = 'Por favor, respondé únicamente con *SI* para confirmar o *NO* para cancelar.';
          await whatsappService.sendMessage(to, response);
          return; 
        }
        break;
    }
    
    await whatsappService.sendMessage(to, response);
    
    if (!this.appointmentState[to]) {
      await this.answerBack(to);
    }
  }



  async sendContact(to) {
    const contact = {
      addresses: [
        {
          street: "123 Calle de las Mascotas",
          city: "Ciudad",
          state: "Estado",
          zip: "12345",
          country: "País",
          country_code: "PA",
          type: "WORK"
        }
      ],
      emails: [
        {
          email: "contacto@medpet.com",
          type: "WORK"
        }
      ],
      name: {
        formatted_name: "MedPet Contacto",
        first_name: "MedPet",
        last_name: "Contacto",
        middle_name: "",
        suffix: "",
        prefix: ""
      },
      org: {
        company: "MedPet",
        department: "Atención al Cliente",
        title: "Representante"
      },
      phones: [
        {
          phone: "+1234567890",
          wa_id: "1234567890",
          type: "WORK"
        }
      ],
      urls: [
        {
          url: "https://www.medpet.com",
          type: "WORK"
        }
      ]
    };

    await whatsappService.sendContactMessage(to, contact);
  }


}

export default new MessageHandler();