import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const viewer = loader.loadModule("@liveagent/ui/components/chat/imagePreviewModel.ts");
const userAttachments = loader.loadModule("@liveagent/ui/components/chat/UserAttachmentCards.tsx");

function approximately(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be close to ${expected}`);
}

test("image viewer clamps scale and uses smooth dynamic wheel increments", () => {
  assert.equal(viewer.clampImageViewerScale(0), viewer.IMAGE_VIEWER_MIN_SCALE);
  assert.equal(viewer.clampImageViewerScale(99), viewer.IMAGE_VIEWER_MAX_SCALE);
  approximately(viewer.imageViewerScaleAfterStep(1, 1), viewer.IMAGE_VIEWER_ZOOM_RATIO);
  approximately(viewer.imageViewerScaleAfterStep(1, -1), 1 / viewer.IMAGE_VIEWER_ZOOM_RATIO);
  approximately(viewer.imageViewerScaleAfterWheelDelta(1, -100, 0), viewer.IMAGE_VIEWER_ZOOM_RATIO);
  approximately(viewer.imageViewerScaleAfterWheelDelta(1, 100, 0), 1 / viewer.IMAGE_VIEWER_ZOOM_RATIO);
});

test("zoom keeps the image point under the cursor while remaining within pan bounds", () => {
  const options = {
    imageSize: { width: 800, height: 600 },
    viewportSize: { width: 400, height: 300 },
  };
  const anchor = { x: 100, y: -50 };
  const before = { x: 0, y: 0, scale: 1, rotation: 0 };
  const after = viewer.zoomImageViewerAtPoint(before, 2, anchor, options);

  assert.equal(after.scale, 2);
  assert.equal(after.x, -100);
  assert.equal(after.y, 50);
  approximately((anchor.x - before.x) / before.scale, (anchor.x - after.x) / after.scale);
  approximately((anchor.y - before.y) / before.scale, (anchor.y - after.y) / after.scale);
});

test("rotation-aware fit and panning use rotated dimensions while retaining continuous rotation", () => {
  assert.deepEqual(
    viewer.fitImageViewerSize({ width: 400, height: 200 }, { width: 200, height: 200 }, 90),
    { width: 200, height: 100 },
  );
  assert.deepEqual(
    viewer.clampImageViewerPan(
      { x: 999, y: -999 },
      {
        imageSize: { width: 400, height: 200 },
        viewportSize: { width: 200, height: 200 },
        scale: 2,
        rotation: 0,
      },
    ),
    { x: 300, y: -100 },
  );
  assert.deepEqual(
    viewer.clampImageViewerPan(
      { x: 999, y: -999 },
      {
        imageSize: { width: 400, height: 200 },
        viewportSize: { width: 200, height: 200 },
        scale: 2,
        rotation: 90,
      },
    ),
    { x: 100, y: -300 },
  );
  assert.equal(
    viewer.clampImageViewerState(
      { x: 0, y: 0, scale: 1, rotation: 360 },
      { imageSize: { width: 100, height: 100 }, viewportSize: { width: 100, height: 100 } },
    ).rotation,
    360,
  );
  assert.deepEqual(viewer.resetImageViewerState(), { x: 0, y: 0, scale: 1, rotation: 0 });
});

test("viewer index, image data parsing, and MIME inference cover inline and proxy-backed sources", async () => {
  assert.equal(viewer.clampImagePreviewIndex(-1, 3), 0);
  assert.equal(viewer.clampImagePreviewIndex(8, 3), 2);
  assert.equal(viewer.normalizeImagePreviewIndex(2.9), 2);
  assert.equal(viewer.normalizeImagePreviewIndex(Number.NaN), 0);

  assert.deepEqual(
    await viewer.resolveImagePreviewData({
      src: "ignored",
      dataBase64: "aGVsbG8=",
      mimeType: "image/png",
      sizeBytes: 5,
    }),
    { dataBase64: "aGVsbG8=", mimeType: "image/png", sizeBytes: 5 },
  );
  assert.deepEqual(
    await viewer.resolveImagePreviewData({ src: "data:image/svg+xml;base64,PHN2Zz4=" }),
    { dataBase64: "PHN2Zz4=", mimeType: "image/svg+xml", sizeBytes: 5 },
  );
  assert.deepEqual(
    await viewer.resolveImagePreviewData({ src: "data:image/svg+xml,%3Csvg%3E" }),
    { dataBase64: "PHN2Zz4=", mimeType: "image/svg+xml", sizeBytes: 5 },
  );
  assert.equal(viewer.getImagePreviewMimeType({ src: "blob:local", fileName: "sketch.webp" }), "image/webp");

  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    return {
      ok: true,
      blob: async () => new Blob([Uint8Array.from([1, 2, 3])], { type: "image/webp" }),
    };
  };
  try {
    assert.deepEqual(
      await viewer.resolveImagePreviewData({ src: "https://proxy.example/image" }),
      { dataBase64: "AQID", mimeType: "image/webp", sizeBytes: 3 },
    );
    assert.deepEqual(requests, ["https://proxy.example/image"]);
  } finally {
    if (typeof previousFetch === "undefined") delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("viewer capabilities expose filesystem actions only for a complete verified attachment", () => {
  const remote = viewer.getImagePreviewCapabilities({ src: "https://proxy.example/image" }, true);
  assert.deepEqual(remote, {
    canSave: true,
    canCopyImage: true,
    canCopyPaths: false,
    canOpenSystem: false,
  });
  const verifiedSlide = {
    src: "data:image/png;base64,AQ==",
    attachment: {
      workdir: "C:/work",
      absolutePath: "C:/work/assets/chart.png",
      relativePath: "assets/chart.png",
    },
  };
  assert.equal(viewer.getImagePreviewCapabilities(verifiedSlide, true).canOpenSystem, true);
  assert.equal(viewer.getImagePreviewCapabilities(verifiedSlide, false).canOpenSystem, false);
  assert.equal(
    viewer.getImagePreviewCapabilities(
      { ...verifiedSlide, attachment: { ...verifiedSlide.attachment, relativePath: "" } },
      true,
    ).canCopyPaths,
    false,
  );
});

test("chat attachment sources preserve verified metadata and keep menus scoped to loaded images", () => {
  const slide = userAttachments.createUserAttachmentImagePreviewSlide(
    {
      relativePath: "assets/chart.png",
      absolutePath: "C:/work/assets/chart.png",
      fileName: "chart.png",
      kind: "image",
      sizeBytes: 321,
    },
    "data:image/png;base64,AQ==",
    " C:/work ",
  );
  assert.deepEqual(slide?.attachment, {
    workdir: "C:/work",
    absolutePath: "C:/work/assets/chart.png",
    relativePath: "assets/chart.png",
  });
  assert.equal(
    userAttachments.createUserAttachmentImagePreviewSlide(
      { ...slide, relativePath: "" },
      "data:image/png;base64,AQ==",
      "C:/work",
    )?.attachment,
    undefined,
  );

  const toolImages = fs.readFileSync(
    fileURLToPath(new URL("../../../agent-ui/src/components/chat/assistant-bubble/ToolImages.tsx", import.meta.url)),
    "utf8",
  );
  const viewerSource = fs.readFileSync(
    fileURLToPath(new URL("../../../agent-ui/src/components/chat/ImagePreview.tsx", import.meta.url)),
    "utf8",
  );
  const composerSource = fs.readFileSync(
    fileURLToPath(new URL("../../../agent-ui/src/components/chat/ComposerAttachmentCard.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(composerSource, /file\?: PendingUploadedFile/);
  assert.match(composerSource, /workspaceRoot\?: string/);
  assert.match(composerSource, /onContextMenu=\{\(event\) =>/);
  assert.match(composerSource, /attachment: \{/);
  assert.match(toolImages, /dataBase64: image\.data/);
  assert.match(toolImages, /src: imageSources\[index\]\?\.src \?\? ""/);
  assert.match(toolImages, /onContextMenu=\{\(\{ x, y \}\) => setContextMenu\(\{ index, x, y \}\)\}/);
  assert.match(toolImages, /if \(!canPreview\) return;/);
  assert.match(viewerSource, /z-\[100\]/);
  assert.match(viewerSource, /z-\[110\]/);
  assert.match(viewerSource, /event\.key === "Escape"/);
  assert.match(viewerSource, /event\.stopPropagation\(\)/);
  assert.match(viewerSource, /onPointerDown/);
  assert.match(viewerSource, /onContextMenu/);
  assert.match(viewerSource, /zoomByStep\(-1\)/);
  assert.match(viewerSource, /zoomByStep\(1\)/);
});
