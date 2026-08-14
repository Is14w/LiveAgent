import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createWebModuleLoader } from "../../test/helpers/load-web-module.mjs";

const loader = createWebModuleLoader({
  rootDir: fileURLToPath(new URL("../", import.meta.url)),
});
const adapter = loader.loadModule("@liveagent/adapters/imagePreview");

function installGlobals(values) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  return () => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
}

function base64Atob(value) {
  return Buffer.from(value, "base64").toString("binary");
}

test("Gateway image save uses the file picker and silently accepts a picker cancellation", async () => {
  const writes = [];
  const restore = installGlobals({
    window: {
      atob: base64Atob,
      showSaveFilePicker: async (options) => {
        assert.deepEqual(options, {
          suggestedName: "chart.png",
          types: [
            {
              accept: { "image/png": [".png"] },
              description: "Image",
            },
          ],
        });
        return {
          createWritable: async () => ({
            async write(blob) {
              writes.push(blob);
            },
            async close() {
              writes.push("closed");
            },
          }),
        };
      },
    },
  });
  try {
    await adapter.saveImagePreviewData({
      dataBase64: "aGVsbG8=",
      fileName: "chart.png",
      mimeType: "image/png",
    });
    assert.equal(writes[0] instanceof Blob, true);
    assert.equal(writes[0].type, "image/png");
    assert.equal(writes[0].size, 5);
    assert.equal(writes[1], "closed");
  } finally {
    restore();
  }

  const restoreCancellation = installGlobals({
    window: {
      atob: base64Atob,
      showSaveFilePicker: async () => {
        throw new DOMException("cancelled", "AbortError");
      },
    },
  });
  try {
    await assert.doesNotReject(
      adapter.saveImagePreviewData({
        dataBase64: "aGVsbG8=",
        fileName: "chart.png",
        mimeType: "image/png",
      }),
    );
  } finally {
    restoreCancellation();
  }
});

test("Gateway image save falls back to a browser download anchor", async () => {
  const events = [];
  const anchor = {
    href: "",
    download: "",
    style: {},
    click() {
      events.push("click");
    },
    remove() {
      events.push("remove");
    },
  };
  const restore = installGlobals({
    window: {
      atob: base64Atob,
      setTimeout(callback) {
        callback();
        return 1;
      },
    },
    document: {
      body: {
        appendChild(node) {
          assert.equal(node, anchor);
          events.push("append");
        },
      },
      createElement(tagName) {
        assert.equal(tagName, "a");
        return anchor;
      },
    },
    URL: {
      createObjectURL(blob) {
        assert.equal(blob.type, "image/png");
        return "blob:download";
      },
      revokeObjectURL(url) {
        events.push(`revoke:${url}`);
      },
    },
  });
  try {
    await adapter.saveImagePreviewData({
      dataBase64: "aGVsbG8=",
      fileName: "chart.png",
      mimeType: "image/png",
    });
    assert.equal(anchor.href, "blob:download");
    assert.equal(anchor.download, "chart.png");
    assert.deepEqual(events, ["append", "click", "remove", "revoke:blob:download"]);
  } finally {
    restore();
  }
});

test("Gateway image copy writes a PNG ClipboardItem and reports unsupported browser APIs", async () => {
  const writes = [];
  const imageBitmap = {
    width: 12,
    height: 8,
    close() {
      writes.push("bitmap-closed");
    },
  };
  class TestClipboardItem {
    constructor(items) {
      this.items = items;
    }
  }
  const restore = installGlobals({
    window: { atob: base64Atob },
    navigator: {
      clipboard: {
        async write(items) {
          writes.push(items);
        },
      },
    },
    ClipboardItem: TestClipboardItem,
    createImageBitmap: async () => imageBitmap,
    document: {
      createElement(tagName) {
        assert.equal(tagName, "canvas");
        return {
          width: 0,
          height: 0,
          getContext() {
            return { drawImage: (...args) => writes.push(args) };
          },
          toBlob(callback, type) {
            callback(new Blob(["png"], { type }));
          },
        };
      },
    },
  });
  try {
    await adapter.copyImagePreviewData({ dataBase64: "aGVsbG8=", mimeType: "image/jpeg" });
    const clipboardWrite = writes.find(
      (value) => Array.isArray(value) && value[0] instanceof TestClipboardItem,
    );
    assert.equal(clipboardWrite.length, 1);
    assert.equal(clipboardWrite[0] instanceof TestClipboardItem, true);
    assert.equal(clipboardWrite[0].items["image/png"].type, "image/png");
    assert.ok(writes.includes("bitmap-closed"));
  } finally {
    restore();
  }

  const restoreUnsupported = installGlobals({
    navigator: { clipboard: {} },
    ClipboardItem: undefined,
  });
  try {
    await assert.rejects(
      adapter.copyImagePreviewData({ dataBase64: "aGVsbG8=", mimeType: "image/png" }),
      /Image clipboard is unavailable/,
    );
    await assert.rejects(
      adapter.openUploadedImageInSystemViewer({ workdir: "/workspace", absolutePath: "/workspace/chart.png" }),
      /unavailable in WebUI/,
    );
    assert.equal(adapter.supportsSystemImageOpen, false);
  } finally {
    restoreUnsupported();
  }
});
