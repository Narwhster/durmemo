/** @jsxImportSource @opentui/solid */
import { createEffect, createSignal, onCleanup } from "solid-js";
import { TextAttributes, type InputRenderable, type Renderable } from "@opentui/core";
import {
  parseJsonValue,
  parseReadExactFound,
  type SelectedRow,
  type TagEntry,
} from "./tags-model.ts";
import type { ScopeKind } from "../encoding.ts";
import { normalizeKey } from "../names.ts";
import { notifyError, ownerArg, type TagsActionDeps } from "./tags-actions.ts";

const TEXT = "#eeeeee";
const MUTED = "#808080";
const PRIMARY = "#fab283";
const DIALOG_BG = "#141414";

interface EditFormState {
  readonly key: () => string;
  readonly setKey: (value: string) => void;
  readonly value: () => string;
  readonly setValue: (value: string) => void;
  readonly scope: () => string;
  readonly setScope: (value: string) => void;
  readonly focus: () => number;
}

const EditForm = (props: { readonly topic: string; readonly state: EditFormState }) => {
  const refs: Array<InputRenderable | undefined> = [];
  onCleanup(() => {
    formRoot = null;
  });
  createEffect(() => {
    const target = refs[props.state.focus()];
    if (target === undefined || target.isDestroyed) return;
    const timer = setTimeout(() => {
      if (!target.isDestroyed) target.focus();
    }, 1);
    onCleanup(() => clearTimeout(timer));
  });
  const refFor = (index: number) => (element: InputRenderable) => {
    refs[index] = element;
  };
  const field = (label: string, get: () => string, set: (value: string) => void, index: number) => (
    <box gap={0}>
      <text fg={MUTED}>{label}</text>
      <input
        onInput={set}
        value={get()}
        focusedBackgroundColor={DIALOG_BG}
        cursorColor={PRIMARY}
        focusedTextColor={TEXT}
        ref={refFor(index)}
      />
    </box>
  );
  return (
    <box
      gap={1}
      paddingBottom={1}
      flexGrow={1}
      ref={(element: Renderable) => {
        formRoot = element;
      }}
    >
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={TEXT} attributes={TextAttributes.BOLD}>
            Edit #{props.topic}
          </text>
          <text fg={MUTED}>esc</text>
        </box>
        <box paddingTop={1} gap={1}>
          {field("Key", props.state.key, props.state.setKey, 0)}
          {field("Value (JSON)", props.state.value, props.state.setValue, 1)}
          {field("Scope (global, project, session)", props.state.scope, props.state.setScope, 2)}
        </box>
      </box>
      <box paddingRight={2} paddingLeft={4} flexDirection="row" flexShrink={0}>
        <text fg={TEXT} attributes={TextAttributes.BOLD}>
          save
          <span style={{ fg: MUTED }}> enter</span>
          {"  "}
          next field
          <span style={{ fg: MUTED }}> tab</span>
        </text>
      </box>
    </box>
  );
};

interface EditFormController {
  readonly next: () => void;
  readonly prev: () => void;
  readonly save: () => void;
  readonly cancel: () => void;
}

let activeForm: EditFormController | null = null;
let formRoot: Renderable | null = null;

export const editFormTarget = (): Renderable | null => formRoot;

export const isEditFormOpen = (): boolean => activeForm !== null;
export const editFormNext = (): void => activeForm?.next();
export const editFormPrev = (): void => activeForm?.prev();
export const editFormSave = (): void => activeForm?.save();
export const editFormCancel = (): void => activeForm?.cancel();

const readProjectOwner = async (deps: TagsActionDeps, entry: TagEntry): Promise<string | null> => {
  let directory: unknown;
  try {
    await deps.data.session.sync(deps.sessionID);
    directory = deps.data.session.get(deps.sessionID)?.location.directory;
  } catch {
    directory = undefined;
  }
  if (typeof directory === "string" && directory !== "") return directory;
  return entry.scope === "project" ? entry.owner : null;
};

export const editEntry = (deps: TagsActionDeps, entry: TagEntry): Promise<false | SelectedRow> =>
  new Promise((resolve) => {
    const [key, setKey] = createSignal(entry.key);
    const [value, setValue] = createSignal(JSON.stringify(entry.value) ?? "null");
    const [scope, setScope] = createSignal(entry.scope);
    const [focus, setFocus] = createSignal(0);
    let settled = false;
    let saving = false;
    const finish = (outcome: false | SelectedRow): void => {
      if (settled) return;
      settled = true;
      activeForm = null;
      resolve(outcome);
    };
    const invalid = (title: string, message: string): void => {
      deps.toast.show({ title, message, variant: "error" });
    };
    const save = (): void => {
      if (saving || settled) return;
      saving = true;
      void (async () => {
        try {
          const nextKey = normalizeKey(key());
          if (nextKey === null) {
            invalid("Invalid key", "Use 1-64 chars: a-z, 0-9, dash, underscore.");
            return;
          }
          const scopeText = scope().trim().toLowerCase();
          if (scopeText !== "global" && scopeText !== "project" && scopeText !== "session") {
            invalid("Invalid scope", "Use global, project, or session.");
            return;
          }
          const nextScope: ScopeKind = scopeText;
          const parsed = parseJsonValue(value());
          if (!parsed.ok) {
            invalid("Invalid JSON", parsed.error);
            return;
          }
          let owner: string | null;
          if (nextScope === "global") owner = null;
          else if (nextScope === "session") owner = deps.sessionID;
          else {
            owner = await readProjectOwner(deps, entry);
            if (owner === null) {
              invalid("DurMemo edit failed", "Couldn't resolve this session's project.");
              return;
            }
          }
          const sameTarget =
            nextKey === entry.key && nextScope === entry.scope && owner === entry.owner;
          if (sameTarget && JSON.stringify(parsed.value) === JSON.stringify(entry.value)) {
            finish(false);
            return;
          }
          if (!sameTarget) {
            let targetExists = false;
            try {
              const found = await deps.store.readExact({
                topic: entry.topic,
                key: nextKey,
                scope: nextScope,
                ...(owner === null ? {} : { owner }),
              });
              targetExists = parseReadExactFound(found);
            } catch (error) {
              notifyError(deps.toast, "edit", error);
              return;
            }
            if (targetExists) {
              const overwrite = await deps.dialog.confirm({
                title: `Overwrite ${entry.topic}/${nextKey}?`,
                message: `An entry already exists at scope ${nextScope}. Saving overwrites it.`,
              });
              if (overwrite !== true) {
                showForm();
                return;
              }
            }
          }
          try {
            await deps.store.upsert({
              topic: entry.topic,
              key: nextKey,
              scope: nextScope,
              ...(owner === null ? {} : { owner }),
              value: parsed.value,
              ...(entry.schema === undefined ? {} : { schema: entry.schema }),
              isPrivate: entry.isPrivate,
              locked: entry.locked,
              allowlist: [...entry.allowlist],
            });
            if (!sameTarget) {
              await deps.store.remove({
                topic: entry.topic,
                key: entry.key,
                scope: entry.scope,
                ...ownerArg(entry),
              });
            }
          } catch (error) {
            notifyError(deps.toast, "edit", error);
            return;
          }
          deps.toast.show({
            title: "DurMemo saved",
            message: `${entry.topic}/${nextKey}`,
            variant: "success",
          });
          finish({ topic: entry.topic, key: nextKey });
        } finally {
          saving = false;
        }
      })();
    };
    activeForm = {
      next: () => setFocus((index) => (index + 1) % 3),
      prev: () => setFocus((index) => (index + 2) % 3),
      save,
      cancel: () => finish(false),
    };
    const showForm = (): void => {
      deps.dialog.show(() => (
        <EditForm
          topic={entry.topic}
          state={{ key, setKey, value, setValue, scope, setScope, focus }}
        />
      ));
    };
    try {
      showForm();
    } catch {
      finish(false);
    }
  });
