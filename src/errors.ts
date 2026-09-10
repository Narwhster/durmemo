import { Data } from "effect";

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class InvalidName extends Data.TaggedError("InvalidName")<{
  readonly message: string;
  readonly what?: string;
  readonly value?: unknown;
  readonly scope?: string;
}> {}

export class SchemaInvalid extends Data.TaggedError("SchemaInvalid")<{
  readonly message: string;
}> {}

export class ValidationFailed extends Data.TaggedError("ValidationFailed")<{
  readonly message: string;
  readonly errors: ReadonlyArray<ValidationIssue>;
}> {}

export class AccessDenied extends Data.TaggedError("AccessDenied")<{
  readonly message: string;
  readonly topic: string;
  readonly key: string;
}> {}

export class NotFound extends Data.TaggedError("NotFound")<{
  readonly message: string;
  readonly topic: string;
  readonly key: string;
}> {}

export class Untagged extends Data.TaggedError("Untagged")<{
  readonly message: string;
  readonly topic: string;
  readonly tagged: ReadonlyArray<string>;
}> {}

export class InitFailed extends Data.TaggedError("InitFailed")<{
  readonly message: string;
  readonly cause?: DurmemoError;
}> {}

export type DurmemoError =
  | InvalidName
  | SchemaInvalid
  | ValidationFailed
  | AccessDenied
  | NotFound
  | Untagged
  | InitFailed;
