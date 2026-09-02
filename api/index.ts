import { handle } from 'hono/vercel';
import { createPlatformApp } from '../src/platform/create-platform-app';

const app = createPlatformApp(process.env);

export default handle(app);
