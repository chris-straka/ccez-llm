// Write the phone's app guide for the Android turn runner, which
// answers the model's app questions without the webview:
//   bun scripts/app-help.ts
// app-help.test.ts fails until this runs after the guide or the
// gestures change.
import { writeFileSync } from "node:fs";
import { buildAppHelp } from "../src/lib/app-help";

writeFileSync("src-tauri/src/app_help_touch.md", buildAppHelp("touch"));
console.log("wrote src-tauri/src/app_help_touch.md");
