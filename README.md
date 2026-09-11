# opencode-durmemo

Shared memory for OpenCode plugins. Stores JSON values by topic and key, at global, project, or session scope.

Session entries shadow project entries, which shadow global entries.

## Install

Add it to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-durmemo"]
}
```

OpenCode installs it on next startup. No config needed.

## Use as a human

Tag a topic into the session by writing `#topic` in a prompt. Tags also accept inputs which other plugins can consume: `#topic[input1, input2]`.

Example:

```
#plan remember my deploy checklist
```

Once tagged, the agent can read and write keys under that topic. You can view and manage keys and values using `/tags`.

## Use as an agent

You get four tools under the `durmemo` namespace. Every call needs a topic already tagged in the session.

- `durmemo_list_keys` lists in-scope keys for tagged topics. Optional `topics` filter.
- `durmemo_read` reads the winning entry for a topic and key.
- `durmemo_write` creates or updates a key at an exact scope: `global`, `project`, or `session`.
- `durmemo_delete` deletes a key at an exact scope.

Read returns the winner. Write and delete act on the exact scope you pass, so a session write shadows the project value instead of replacing it.

## Use as a plugin author

Import the RPC definition from `opencode-durmemo/rpc` and call it with `ctx.rpc`:

```ts
import { DurmemoRpc } from "opencode-durmemo/rpc";

const durmemo = ctx.rpc(DurmemoRpc);
yield * durmemo["keys.readExact"]({ topic, key, scope: "session", owner: sessionID });
yield *
  durmemo["init.ensure"]({
    pluginId,
    topic,
    key,
    scope: "session",
    owner: sessionID,
    initialValue,
  });
```

`init.ensure` seeds a key once without overwriting an existing value. Use it for defaults.

React to a key from a session hook:

```ts
import { Effect } from "effect";
import { DurmemoRpc } from "opencode-durmemo/rpc";

const durmemo = ctx.rpc(DurmemoRpc);
yield *
  ctx.session.hook("context", (event) =>
    Effect.gen(function* () {
      const { found, entry } = yield* durmemo["keys.readExact"]({
        topic: "mytopic",
        key: "mykey",
        scope: "session",
        owner: event.sessionID,
      });
      if (found && entry !== undefined) {
        event.system.push({ type: "text" as const, text: String(entry.value) });
      }
    }).pipe(Effect.orElseSucceed(() => undefined)),
  );
```
