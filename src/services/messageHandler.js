import whatsappService from './whatsappService.js';
/* import appendToSheet from './googleSheetsService.js';
import openAiService from './openAiService.js'; */

class MessageHandler {

  constructor() {
    this.appointmentState = {};
    this.assistandState = {};
  }

  async handleIncomingMessage(message, senderInfo) {
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
    const welcomeMessage = `Hola ${firstName} 👋, Bienvenido a *Nexus Calistenia con proposito.*
    
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
        response = "Opcion aun no implementada"
        break
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
    // Evitamos enviar el menú de retorno si el usuario acaba de empezar el cuestionario de cita
    if (!this.appointmentState[to]) {
      await this.answerBack(to);
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

  completeAppointment(to) {
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

    return `¡Listo! Tu clase de prueba ha sido agendada con éxito 🎉.
    
📋 *Resumen de tu clase:*
👤 Nombre: ${appointment.name}
🏋️‍♂️ Modalidad: ${appointment.modality}
🗓 Día: ${appointment.day}
⏱ Hora: Hablar con los profes por disponibilidad
    
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
        response = this.completeAppointment(to);
        break;
    }
    
    await whatsappService.sendMessage(to, response);
    
    // Si la cita finalizó y se borró el estado, le mostramos el menú para volver
    if (!this.appointmentState[to]) {
      await this.answerBack(to);
    }
  }



  async handleAssistandFlow(to, message) {
    const state = this.assistandState[to];
    let response;

    const menuMessage = "¿La respuesta fue de tu ayuda?"
    const buttons = [
      { type: 'reply', reply: { id: 'option_4', title: "Si, Gracias" } },
      { type: 'reply', reply: { id: 'option_5', title: 'Hacer otra pregunta'}},
      { type: 'reply', reply: { id: 'option_6', title: 'Emergencia'}}
    ];

    if (state.step === 'question') {
      response = await openAiService(message);
    }

    delete this.assistandState[to];
    await whatsappService.sendMessage(to, response);
    await whatsappService.sendInteractiveButtons(to, menuMessage, buttons);
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