import assert from "node:assert/strict";
import test from "node:test";

import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function loadAdapter() {
  const calls = [];
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, payload) {
          calls.push({ command, payload });
          return true;
        },
      },
    },
  });
  return { adapter: loader.loadModule("@liveagent/adapters/imagePreview"), calls };
}

test("desktop image preview adapter sends exact save, copy, and system-open Tauri payloads", async () => {
  const { adapter, calls } = loadAdapter();

  assert.equal(adapter.supportsSystemImageOpen, true);
  await adapter.saveImagePreviewData({
    dataBase64: "aGVsbG8=",
    fileName: "chart.png",
    mimeType: "image/png",
  });
  await adapter.copyImagePreviewData({ dataBase64: "aGVsbG8=", mimeType: "image/png" });
  await adapter.openUploadedImageInSystemViewer({
    workdir: "C:/work",
    absolutePath: "C:/work/assets/chart.png",
  });

  assert.deepEqual(calls, [
    {
      command: "system_save_preview_file",
      payload: {
        data_base64: "aGVsbG8=",
        file_name: "chart.png",
        mime_type: "image/png",
      },
    },
    {
      command: "system_clipboard_write_image",
      payload: { data_base64: "aGVsbG8=", mime_type: "image/png" },
    },
    {
      command: "system_open_uploaded_image",
      payload: {
        workdir: "C:/work",
        absolute_path: "C:/work/assets/chart.png",
      },
    },
  ]);
});
