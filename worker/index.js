import { Hono } from 'hono';
import webhookRoutes from './routes/webhookRoutes.js';

const app = new Hono();

app.route('/', webhookRoutes);

app.get('/', (c) => c.html('<pre>Nothing to see here.\nCheckout README.md to start.</pre>'));

export default app;
