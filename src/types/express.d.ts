export {};

declare global {
  namespace Express {
    interface Request {
      /** Correlation id for this request; set by the `requestId` middleware. */
      id: string;
      /**
       * Populated by the `validate()` middleware. Controllers read from here instead of
       * `req.query`/`req.params`/`req.body` directly, since those retain Express's own
       * (pre-validation, pre-coercion) types.
       */
      validated: {
        params?: Record<string, unknown>;
        query?: Record<string, unknown>;
        body?: Record<string, unknown>;
      };
    }
  }
}
