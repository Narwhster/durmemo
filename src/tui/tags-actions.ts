import { usePlugin } from "@opencode/plugin/tui";
import type { Schema } from "effect";
import type { ScopeKind } from "../encoding.ts";
import {
  parseTopics,
  parseWinners,
  previewValue,
  type SelectedRow,
  type TagEntry,
  type TagTopic,
} from "./tags-model.ts";

export const TAGS_PLUGIN_ID = "durmemo-tags";

export interface TagsStore {
  readonly listTopics: (input: { readonly sessionID: string }) => Promise<unknown>;
  readonly listEffective: (input: { readonly sessionID: string }) => Promise<unknown>;
  readonly listVersions: (input: {
    readonly sessionID: string;
    readonly topic: string;
    readonly key: string;
  }) => Promise<unknown>;
  readonly readExact: (input: {
    readonly topic: string;
    readonly key: string;
    readonly scope: ScopeKind;
    readonly owner?: string;
  }) => Promise<unknown>;
  readonly upsert: (input: {
    readonly topic: string;
    readonly key: string;
    readonly scope: ScopeKind;
    readonly owner?: string;
    readonly value: Schema.Json;
    readonly schema?: Schema.Json;
    readonly isPrivate?: boolean;
    readonly locked?: boolean;
    readonly allowlist?: ReadonlyArray<string>;
  }) => Promise<unknown>;
  readonly remove: (input: {
    readonly topic: string;
    readonly key: string;
    readonly scope: ScopeKind;
    readonly owner?: string;
  }) => Promise<unknown>;
}

export type TuiContext = ReturnType<typeof usePlugin>;

type Dialog = TuiContext["ui"]["dialog"];
type Toast = TuiContext["ui"]["toast"];

export interface TagsActionDeps {
  readonly dialog: Dialog;
  readonly toast: Toast;
  readonly data: TuiContext["data"];
  readonly store: TagsStore;
  readonly sessionID: string;
}

export const rpcMessage = (error: unknown): string => {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
};

export const notifyError = (toast: Toast, action: string, error: unknown): void => {
  toast.show({ title: `DurMemo ${action} failed`, message: rpcMessage(error), variant: "error" });
};

export const loadTagsData = async (
  store: TagsStore,
  sessionID: string,
): Promise<{ readonly entries: TagEntry[]; readonly topics: TagTopic[] }> => {
  const [effective, listed] = await Promise.all([
    store.listEffective({ sessionID }),
    store.listTopics({ sessionID }),
  ]);
  return { entries: parseWinners(effective), topics: parseTopics(listed) };
};

export const ownerArg = (entry: Pick<TagEntry, "owner">): { readonly owner?: string } =>
  entry.owner === null ? {} : { owner: entry.owner };

export const deleteKey = async (
  deps: TagsActionDeps,
  entry: TagEntry,
  versions: number,
): Promise<false | SelectedRow> => {
  const shadowed =
    versions > 1 ? ` Deleting reveals ${String(versions - 1)} shadowed version(s).` : "";
  const confirmed = await deps.dialog.confirm({
    title: `Delete ${entry.topic}/${entry.key}?`,
    message: `Scope ${entry.scope}, value ${previewValue(entry.value)}.${shadowed}`,
  });
  if (confirmed !== true) return false;
  try {
    await deps.store.remove({
      topic: entry.topic,
      key: entry.key,
      scope: entry.scope,
      ...ownerArg(entry),
    });
  } catch (error) {
    notifyError(deps.toast, "delete", error);
    return false;
  }
  deps.toast.show({
    title: "DurMemo deleted",
    message: `${entry.topic}/${entry.key}`,
    variant: "success",
  });
  return { topic: entry.topic, key: entry.key };
};

export const countVersions = async (
  store: TagsStore,
  sessionID: string,
  entry: TagEntry,
): Promise<number> => {
  try {
    const result = await store.listVersions({ sessionID, topic: entry.topic, key: entry.key });
    return Math.max(parseWinners(result).length, 1);
  } catch {
    return 1;
  }
};
