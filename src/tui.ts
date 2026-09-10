import { Plugin } from "@opencode/plugin/tui";
import { registerTagsKeys } from "./tui/tags-dialog.tsx";

export default Plugin.define({
  id: "opencode-durmemo-tags",
  setup(context) {
    if (context.ui === undefined) return;
    return context.ui.slot({
      append: "app",
      render: () => {
        registerTagsKeys(context);
        return null;
      },
    });
  },
});
