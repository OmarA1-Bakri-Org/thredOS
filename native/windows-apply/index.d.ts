/** Opaque, process-local Windows handles. Never serialize or reuse after commit/close. */
export type PreparedMutation = object;

/** Identity is volume serial plus 128-bit file ID, encoded as 48 hex characters. */
export function identity(root: string, relative: string, directory: boolean): string;

/** Retain a directory and its ancestors without delete sharing; release with close. */
export function pinDirectory(root: string, expectedRootId: string, relative: string, expectedDirectoryId: string): PreparedMutation;

/**
 * Pin an expected root and regular-file source, its parents, and the destination
 * parent (for rename). Caller must have persisted its journal and validated
 * content hashes, scope, policy, approval, and destination absence first.
 * The service must verify content again after the first rename; this primitive
 * only verifies file identities and safe path containment.
 */
export function prepare(
  root: string,
  expectedRootId: string,
  source: string,
  expectedSourceId: string,
  destination: string,
  expectedDestinationParentId: string,
  kind: 'rename' | 'delete',
): PreparedMutation;

/** Perform exactly one pinned operation; a failed commit still consumes the token. */
export function commit(token: PreparedMutation): true;

/** Release a prepared operation without mutation. Safe to call in finally. */
export function close(token: PreparedMutation): void;
