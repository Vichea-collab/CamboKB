// Minimal typings for the parts of jsreport this service uses.
declare module '@jsreport/jsreport-core' {
  type RenderRequest = {
    template: { content: string; engine: string; recipe: string; chrome?: Record<string, unknown> };
    data?: unknown;
  };
  type Reporter = {
    use(extension: unknown): Reporter;
    init(): Promise<Reporter>;
    close(): Promise<void>;
    render(req: RenderRequest): Promise<{ content: Buffer }>;
  };
  export default function jsreport(options?: Record<string, unknown>): Reporter;
}
declare module '@jsreport/jsreport-handlebars' {
  export default function handlebars(options?: Record<string, unknown>): unknown;
}
declare module '@jsreport/jsreport-chrome-pdf' {
  export default function chromePdf(options?: Record<string, unknown>): unknown;
}
