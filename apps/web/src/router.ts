export type RouteHandler = (
  params: Record<string, string>,
  query: URLSearchParams,
) => void | Promise<void>;
type Route = { pattern: string; parts: string[]; handler: RouteHandler };
export class Router {
  private routes: Route[] = [];
  add(pattern: string, handler: RouteHandler) {
    this.routes.push({
      pattern,
      parts: pattern.split('/').filter(Boolean),
      handler,
    });
    return this;
  }
  match(path = location.pathname) {
    const parts = path.split('/').filter(Boolean);
    return this.routes
      .map((route) => {
        if (route.parts.length !== parts.length) return undefined;
        const params: Record<string, string> = {};
        for (const [index, part] of route.parts.entries()) {
          const value = parts[index];
          if (part.startsWith(':') && value)
            params[part.slice(1)] = decodeURIComponent(value);
          else if (part !== value) return undefined;
        }
        return { handler: route.handler, params };
      })
      .find(Boolean);
  }
  navigate(path: string) {
    history.pushState({}, '', path);
    return this.match(path);
  }
  listen(render: () => void) {
    window.addEventListener('popstate', render);
    document.addEventListener('click', (event) => {
      const target = (event.target as Element).closest('a');
      if (
        !target ||
        target.target === '_blank' ||
        target.hasAttribute('download') ||
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const url = new URL(target.href);
      if (url.origin !== location.origin) return;
      event.preventDefault();
      this.navigate(url.pathname + url.search);
      render();
    });
    return () => window.removeEventListener('popstate', render);
  }
}
