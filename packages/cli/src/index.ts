export type {
  Constraints,
  Field,
  HttpEndpoint,
  Surface,
  TrpcEndpoint,
  TypeNode,
} from "./surface/types";
export {
  canonicalize,
  contentHash,
  splitNullable,
  stableStringify,
} from "./surface/canonical";
export { fromJsonSchema } from "./surface/jsonschema";
export { fromZod, isZodSchema } from "./surface/zod";
export { fromTypeBox, isTypeBoxSchema } from "./surface/typebox";
export { fromElysiaApp } from "./surface/elysia";
export { fromTrpcRouter, type SchemaConverter } from "./surface/trpc";
export {
  defineSurface,
  type ManualEndpoint,
  type SurfaceDefinition,
} from "./surface/define";
export { extractSurface, serializeSurface } from "./surface/extract";

export { defineConfig, loadConfig, type VersionlessCliConfig } from "./config";
export { CliError, type ExitCode } from "./errors";
export { diffSurfaces, type DiffEntry } from "./diff/diff";
export {
  classificationTable,
  classify,
  opName,
  type Classification,
  type OpKey,
  type Polarity,
  type Severity,
} from "./diff/classify";
export { renderType, renderField } from "./diff/render";
export {
  matchCoverage,
  type CoverageReport,
  type CoverageItem,
} from "./coverage/match";
export { loadChangeChain, type ChangeLike } from "./chain";
export {
  latestSnapshot,
  listSnapshotVersions,
  readSnapshot,
  writeSnapshot,
} from "./snapshot/store";
export {
  getAccessToken,
  getCurrentUser,
  resolveHexclaveSettings,
  DEFAULT_API_URL,
  type HexclaveSettings,
  type HexclaveUser,
} from "./auth/hexclave";
export {
  configDir,
  credentialKey,
  credentialsPath,
  deleteCredential,
  readCredential,
  writeCredential,
  type StoredCredential,
} from "./auth/credentials";
export { main } from "./cli";
