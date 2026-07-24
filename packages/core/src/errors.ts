/**
 * Stable machine-readable error codes. These are a protocol contract: the same
 * identifier appears on the error instance, in adapter JSON bodies, and in the
 * `x-versionless-error` response header. Codes are append-only — existing
 * values never change meaning or disappear.
 */
export type VersionlessErrorCode =
  | "VERSION_INVALID"
  | "VERSION_AHEAD"
  | "VERSION_SUNSET"
  | "REGISTRATION_INVALID"
  | "TRANSFORM_FAILED";

export class VersionlessError extends Error {
  readonly code: VersionlessErrorCode = "REGISTRATION_INVALID";
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Invalid or unparseable version supplied by a client. Adapters map this to HTTP 400. */
export class VersionResolutionError extends VersionlessError {
  override readonly code = "VERSION_INVALID";
  constructor(
    readonly requested: string,
    readonly scheme: string,
  ) {
    super(
      `Invalid API version "${requested}" for scheme "${scheme}"` +
        (scheme === "date" ? ' (expected "YYYY-MM-DD")' : ' (expected "MAJOR.MINOR.PATCH")'),
    );
  }
}

/**
 * Client pinned a version newer than this server's `current` — the client is
 * from the future (a newer SDK, or a rollback on the server side). Only thrown
 * when `onFutureVersion: "reject"`; the default policy clamps to `current` and
 * advertises the served version via response headers instead.
 * Adapters map this to HTTP 400.
 */
export class FutureVersionError extends VersionlessError {
  override readonly code = "VERSION_AHEAD";
  constructor(
    readonly requested: string,
    readonly current: string,
  ) {
    super(
      `Requested API version "${requested}" is newer than this server's current version "${current}". ` +
        `The server cannot safely serve a wire shape it does not know about.`,
    );
  }
}

/** A change/jump/sunset was registered with invalid data, or after the registry was sealed. */
export class RegistrationError extends VersionlessError {
  override readonly code = "REGISTRATION_INVALID";
}

/** A transform function threw while a request/response was being converted. */
export class TransformError extends VersionlessError {
  override readonly code = "TRANSFORM_FAILED";
  constructor(
    readonly changeVersion: string,
    readonly routeKey: string,
    readonly direction: "up" | "down" | "error",
    override readonly cause: unknown,
  ) {
    super(
      `Transform ${direction}() of change ${changeVersion} failed on ${routeKey}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
}
