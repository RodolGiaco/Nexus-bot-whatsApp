import { Hono } from 'hono';
import { handleIncoming, verifyWebhook } from '../controllers/webhookController.js';

const router = new Hono();

router.post('/webhook', handleIncoming);
router.get('/webhook', verifyWebhook);

export default router;
