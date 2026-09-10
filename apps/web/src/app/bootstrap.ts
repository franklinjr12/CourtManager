import { createAppContext } from './context.js';
import { registerRoutes, createRenderer } from './routes.js';

export const bootstrap = () => {
  const root = document.querySelector<HTMLDivElement>('#app');
  if (!root) throw new Error('App root missing');
  const context = createAppContext(root);
  registerRoutes(context);
  const renderRoute = createRenderer(context);
  context.setRenderRoute(renderRoute);
  context.router.listen(() => void renderRoute());
  void renderRoute();
};
