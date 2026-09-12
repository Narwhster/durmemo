/** @jsxImportSource @opentui/solid */
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { TextAttributes, type InputRenderable } from "@opentui/core";
import type { Schema } from "effect";
import {
  buildRows,
  describeScope,
  previewValue,
  selectableEntries,
  type SelectedRow,
  type TagEntry,
  type TagTopic,
} from "./tags-model.ts";
import {
  countVersions,
  deleteKey,
  loadTagsData,
  rpcMessage,
  TAGS_PLUGIN_ID,
  type TagsStore,
  type TuiContext,
} from "./tags-actions.ts";
import {
  editEntry,
  editFormCancel,
  editFormNext,
  editFormPrev,
  editFormSave,
  editFormTarget,
  isEditFormOpen,
} from "./edit-form.tsx";

const TEXT = "#eeeeee";
const MUTED = "#808080";
const ACCENT = "#9d7cd8";
const PRIMARY = "#fab283";
const SELECTED_FG = "#0a0a0a";
const DIALOG_BG = "#141414";

const makeStore = (context: TuiContext): TagsStore => {
  type ClientJson = Exclude<Parameters<TuiContext["client"]["rpc"]["call"]>[0]["input"], undefined>;
  const toClientJson = (value: Schema.Json): ClientJson => {
    if (Array.isArray(value)) return value.map(toClientJson);
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, toClientJson(entry)]),
      );
    }
    return value;
  };
  const call = (
    method: string,
    input: { readonly [key: string]: Schema.Json | undefined },
  ): Promise<unknown> => {
    const cleaned: { [key: string]: Schema.Json } = {};
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) cleaned[key] = value;
    }
    return context.client.rpc
      .call({ rpcID: "durmemo", method, input: toClientJson(cleaned) })
      .then((result) => result.output);
  };
  return {
    listTopics: ({ sessionID }) => call("topics.list", { sessionID, includeUndiscoverable: true }),
    listEffective: ({ sessionID }) => call("keys.listEffective", { sessionID }),
    listVersions: ({ sessionID, topic, key }) => call("keys.listAll", { sessionID, topic, key }),
    readExact: ({ topic, key, scope, owner }) =>
      call("keys.readExact", { topic, key, scope, owner }),
    upsert: ({ topic, key, scope, owner, value, schema, isPrivate, locked, allowlist }) =>
      call("keys.upsert", {
        topic,
        key,
        scope,
        owner,
        value,
        schema,
        isPrivate,
        locked,
        allowlist: allowlist === undefined ? undefined : [...allowlist],
        pluginId: TAGS_PLUGIN_ID,
      }),
    remove: ({ topic, key, scope, owner }) =>
      call("keys.remove", { topic, key, scope, owner, pluginId: TAGS_PLUGIN_ID }),
  };
};

const currentSessionID = (context: TuiContext): string | null => {
  const route = context.ui.router.current();
  return route.type === "session" ? route.sessionID : null;
};

const dialogState: {
  showAll: boolean;
  index: number;
  filter: string;
  topic?: string;
  key?: string;
} = {
  showAll: false,
  index: 0,
  filter: "",
};

interface TagsController {
  readonly move: (delta: number) => void;
  readonly toggleAll: () => void;
  readonly close: () => void;
  readonly editSelected: () => void;
  readonly deleteSelected: () => void;
}

const [tagsOpen, setTagsOpen] = createSignal(false);
const [keysSuspended, setKeysSuspended] = createSignal(false);
let active: TagsController | null = null;

const listEnabled = (): boolean => tagsOpen() && !keysSuspended();

export const registerTagsKeys = (context: TuiContext): void => {
  context.keymap.layer(() => ({
    mode: "global",
    priority: 100,
    commands: [
      {
        id: "durmemo.tags.open",
        title: "Show DurMemo tags",
        group: "DurMemo",
        palette: true,
        slash: { name: "tags" },
        run: () => openTagsDialog(context),
      },
      { id: "durmemo.tags.prev", bind: "up", enabled: listEnabled, run: () => active?.move(-1) },
      { id: "durmemo.tags.next", bind: "down", enabled: listEnabled, run: () => active?.move(1) },
      {
        id: "durmemo.tags.toggle-all",
        bind: "ctrl+a",
        enabled: listEnabled,
        run: () => active?.toggleAll(),
      },
      {
        id: "durmemo.tags.close",
        bind: "escape",
        enabled: listEnabled,
        run: () => active?.close(),
      },
      {
        id: "durmemo.tags.edit",
        bind: "enter",
        enabled: listEnabled,
        run: () => active?.editSelected(),
      },
      {
        id: "durmemo.tags.delete",
        bind: "ctrl+d",
        enabled: listEnabled,
        run: () => active?.deleteSelected(),
      },
    ],
    bindings: [
      "durmemo.tags.open",
      "durmemo.tags.prev",
      "durmemo.tags.next",
      "durmemo.tags.toggle-all",
      "durmemo.tags.close",
      "durmemo.tags.edit",
      "durmemo.tags.delete",
    ],
  }));
  context.keymap.layer(() => ({
    mode: "global",
    priority: 200,
    target: editFormTarget,
    commands: [
      {
        id: "durmemo.edit.save",
        bind: "enter",
        enabled: isEditFormOpen,
        run: () => editFormSave(),
      },
      {
        id: "durmemo.edit.next",
        bind: "tab",
        enabled: isEditFormOpen,
        run: () => editFormNext(),
      },
      {
        id: "durmemo.edit.down",
        bind: "down",
        enabled: isEditFormOpen,
        run: () => editFormNext(),
      },
      {
        id: "durmemo.edit.up",
        bind: "up",
        enabled: isEditFormOpen,
        run: () => editFormPrev(),
      },
      {
        id: "durmemo.edit.cancel",
        bind: "escape",
        enabled: isEditFormOpen,
        run: () => editFormCancel(),
      },
    ],
    bindings: [
      "durmemo.edit.save",
      "durmemo.edit.next",
      "durmemo.edit.down",
      "durmemo.edit.up",
      "durmemo.edit.cancel",
    ],
  }));
};

const FooterHints = (props: { readonly showAll: boolean }) => (
  <text fg={TEXT} attributes={TextAttributes.BOLD}>
    delete
    <span style={{ fg: MUTED }}> ctrl+d</span>
    {"  "}
    edit
    <span style={{ fg: MUTED }}> enter</span>
    {"  "}
    {props.showAll ? "scoped" : "all"}
    <span style={{ fg: MUTED }}> ctrl+a</span>
  </text>
);

const TagsList = (props: { readonly context: TuiContext; readonly sessionID: string }) => {
  const { context, sessionID } = props;
  const store = makeStore(context);
  const [entries, setEntries] = createSignal<TagEntry[]>([]);
  const [tagTopics, setTagTopics] = createSignal<TagTopic[]>([]);
  const [failed, setFailed] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [showAll, setShowAll] = createSignal(dialogState.showAll);
  const [selected, setSelected] = createSignal(0);
  const [filter, setFilter] = createSignal(dialogState.filter);

  const filteredEntries = createMemo(() => {
    const needle = filter().trim().toLowerCase();
    if (needle === "") return entries();
    return entries().filter((entry) => entry.topic.includes(needle) || entry.key.includes(needle));
  });
  const rows = createMemo(() =>
    buildRows({ entries: filteredEntries(), topics: tagTopics(), showAll: showAll() }),
  );
  const choices = createMemo(() => selectableEntries(rows()));

  const clampSelection = (): void => {
    const list = choices();
    if (list.length === 0) {
      setSelected(0);
      return;
    }
    if (dialogState.topic !== undefined) {
      const index = list.findIndex(
        (entry) => entry.topic === dialogState.topic && entry.key === dialogState.key,
      );
      if (index !== -1) {
        setSelected(index);
        return;
      }
    }
    setSelected(Math.min(Math.max(dialogState.index, 0), list.length - 1));
  };

  const reload = async (): Promise<void> => {
    setLoading(true);
    try {
      const data = await loadTagsData(store, sessionID);
      setEntries(data.entries);
      setTagTopics(data.topics);
      setFailed(null);
    } catch (error) {
      setFailed(rpcMessage(error));
    } finally {
      setLoading(false);
      clampSelection();
    }
  };

  const remember = (): void => {
    const entry = choices()[selected()];
    dialogState.showAll = showAll();
    dialogState.index = selected();
    dialogState.filter = filter();
    dialogState.topic = entry?.topic;
    dialogState.key = entry?.key;
  };

  const reshow = (): void => {
    remember();
    context.ui.dialog.clear();
    setTagsOpen(true);
    context.ui.dialog.show(() => <TagsList context={context} sessionID={sessionID} />);
  };

  const move = (delta: number): void => {
    const count = choices().length;
    if (count === 0) return;
    let next = selected() + delta;
    if (next < 0) next = count - 1;
    if (next >= count) next = 0;
    setSelected(next);
    remember();
  };

  const toggleAll = (): void => {
    const current = choices()[selected()];
    setShowAll(!showAll());
    if (current === undefined) {
      setSelected(0);
    } else {
      const index = selectableEntries(rows()).findIndex(
        (entry) => entry.topic === current.topic && entry.key === current.key,
      );
      setSelected(index === -1 ? 0 : index);
    }
    remember();
  };

  const withSelected = async (
    run: (entry: TagEntry) => Promise<false | SelectedRow>,
  ): Promise<void> => {
    const entry = choices()[selected()];
    if (entry === undefined) return;
    remember();
    setKeysSuspended(true);
    try {
      const outcome = await run(entry);
      if (outcome !== false) {
        dialogState.topic = outcome.topic;
        dialogState.key = outcome.key;
      }
      reshow();
    } finally {
      setKeysSuspended(false);
    }
  };

  const deps = {
    dialog: context.ui.dialog,
    toast: context.ui.toast,
    data: context.data,
    store,
    sessionID,
  };
  const controller: TagsController = {
    move,
    toggleAll,
    close: () => context.ui.dialog.clear(),
    editSelected: () => void withSelected((entry) => editEntry(deps, entry)),
    deleteSelected: () =>
      void (async () => {
        const entry = choices()[selected()];
        if (entry === undefined) return;
        remember();
        context.ui.dialog.clear();
        await deleteKey(deps, entry, await countVersions(store, sessionID, entry));
      })(),
  };

  onMount(() => {
    active = controller;
    void reload();
  });

  onCleanup(() => {
    if (active === controller) active = null;
  });

  const focusSearch = (r: InputRenderable): void => {
    setTimeout(() => {
      if (r.isDestroyed) return;
      r.focus();
    }, 1);
  };

  return (
    <box gap={1} paddingBottom={1} flexGrow={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={TEXT} attributes={TextAttributes.BOLD}>
            DurMemo tags
            <span style={{ fg: MUTED }}>{showAll() ? " (all)" : " (in scope)"}</span>
          </text>
          <text fg={MUTED}>esc</text>
        </box>
        <box paddingTop={1}>
          <input
            onInput={(value) => {
              setFilter(value);
              setSelected(0);
              remember();
            }}
            value={dialogState.filter}
            focusedBackgroundColor={DIALOG_BG}
            cursorColor={PRIMARY}
            focusedTextColor={MUTED}
            placeholder="Search"
            placeholderColor={MUTED}
            ref={focusSearch}
          />
        </box>
      </box>
      <box paddingLeft={1} paddingRight={1}>
        <Show when={loading()}>
          <box paddingLeft={3}>
            <text fg={MUTED}>Loading…</text>
          </box>
        </Show>
        <Show when={!loading() && failed() !== null}>
          <box paddingLeft={3}>
            <text>Couldn't load tags: {failed() ?? ""}</text>
          </box>
        </Show>
        <Show when={!loading() && failed() === null && choices().length === 0}>
          <box paddingLeft={3} paddingTop={1}>
            <text fg={MUTED}>
              {filter().trim() === ""
                ? "No tagged topics have keys in this session yet. Tag one with #topic in a prompt, or press ctrl+a."
                : "No results found"}
            </text>
          </box>
        </Show>
        <For each={rows()}>
          {(row, index) =>
            row.kind === "header" ? (
              <box paddingTop={index() === 0 ? 0 : 1} paddingLeft={3}>
                <text fg={ACCENT} attributes={TextAttributes.BOLD}>
                  #{row.topic}
                  {row.untagged ? <span style={{ fg: MUTED }}> · untagged</span> : ""}
                </text>
              </box>
            ) : (
              <Show
                when={choices()[selected()] === row.entry}
                fallback={
                  <box flexDirection="row" paddingLeft={3} paddingRight={3} gap={1}>
                    <text flexGrow={1} fg={TEXT} overflow="hidden" wrapMode="none">
                      {row.entry.key}
                      <span style={{ fg: MUTED }}>
                        {" "}
                        [{describeScope(row.entry, sessionID)}] {previewValue(row.entry.value)}
                      </span>
                    </text>
                  </box>
                }
              >
                <box
                  flexDirection="row"
                  paddingLeft={1}
                  paddingRight={3}
                  gap={1}
                  backgroundColor={PRIMARY}
                >
                  <text flexShrink={0} fg={SELECTED_FG}>
                    ●
                  </text>
                  <text
                    flexGrow={1}
                    fg={SELECTED_FG}
                    attributes={TextAttributes.BOLD}
                    overflow="hidden"
                    wrapMode="none"
                  >
                    {row.entry.key}
                    <span style={{ fg: SELECTED_FG }}>
                      {" "}
                      [{describeScope(row.entry, sessionID)}] {previewValue(row.entry.value)}
                    </span>
                  </text>
                </box>
              </Show>
            )
          }
        </For>
      </box>
      <box paddingRight={2} paddingLeft={4} flexDirection="row" flexShrink={0}>
        <FooterHints showAll={showAll()} />
      </box>
    </box>
  );
};

export const openTagsDialog = (context: TuiContext): void => {
  const sessionID = currentSessionID(context);
  if (sessionID === null) {
    context.ui.toast.show({
      title: "DurMemo tags",
      message: "Open a session first.",
      variant: "warning",
    });
    return;
  }
  dialogState.showAll = false;
  dialogState.index = 0;
  dialogState.filter = "";
  dialogState.topic = undefined;
  dialogState.key = undefined;
  context.ui.dialog.clear();
  setTagsOpen(true);
  context.ui.dialog.set({ size: "xlarge" });
  context.ui.dialog.show(
    () => <TagsList context={context} sessionID={sessionID} />,
    () => setTagsOpen(false),
  );
};
