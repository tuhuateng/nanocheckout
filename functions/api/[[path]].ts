import { createPlatformApp, type PlatformEnvironment } from '../../src/platform/create-platform-app';

type CloudflareEnvironment = PlatformEnvironment & {
  HYPERDRIVE?: Hyperdrive;
};

let cachedApp: ReturnType<typeof createPlatformApp> | undefined;
let cachedConnectionString: string | undefined;

export const onRequest: PagesFunction<CloudflareEnvironment> = async (context) => {
  const connectionString = context.env.HYPERDRIVE?.connectionString || context.env.DATABASE_URL;
  if (!cachedApp || cachedConnectionString !== connectionString) {
    cachedApp = createPlatformApp(context.env, context.env.HYPERDRIVE?.connectionString);
    cachedConnectionString = connectionString;
  }
  return cachedApp.fetch(context.request, context.env, context as unknown as ExecutionContext);
};
