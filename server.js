import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const {
  WEBHOOK_VERIFY_TOKEN,
  API_TOKEN,
  BUSINESS_PHONE,
  API_VERSION,
  PORT
} = process.env;

console.log("TOKEN cargado:", API_TOKEN ? "SI" : "NO");

/*
|--------------------------------------------------------------------------
| RECIBE MENSAJES DE WHATSAPP
|--------------------------------------------------------------------------
*/


async function sendMessage(phoneNumber, message) {
  const url = `https://graph.facebook.com/${API_VERSION}/${BUSINESS_PHONE}/messages`;
  const data = {
    messaging_product: 'whatsapp',
    to: phoneNumber,
    text: { body: message },
  };
  try {
    const response = await axios.post(url, data, {
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
    console.log('Message sent:', response.data);
  } catch (error) {
    console.error('Error sending message:', error.response?.data || error.message);
  }
}


app.post("/webhook", async (req, res) => {

  console.log(
    "Incoming webhook message:",
    JSON.stringify(req.body, null, 2)
  );

  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (message?.type === "text") {
    // send a response message back to the user
    const responseMessage = `You said: ${message.text.body}`;
    sendMessage(542616268872, responseMessage);
    console.log("Mensaje enviado correctamente");
  }

  res.sendStatus(200);

});




/*
|--------------------------------------------------------------------------
| VERIFICACION DEL WEBHOOK
|--------------------------------------------------------------------------
*/

app.get("/webhook", (req, res) => {

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {

    console.log("Webhook verificado correctamente");

    res.status(200).send(challenge);

  } else {

    res.sendStatus(403);

  }

});


/*
|--------------------------------------------------------------------------
| PAGINA PRINCIPAL
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.send("WhatsApp Bot funcionando");
});


/*
|--------------------------------------------------------------------------
| INICIAR SERVIDOR
|--------------------------------------------------------------------------
*/

app.listen(PORT, () => {

  console.log("Servidor corriendo en puerto:", PORT);

});



