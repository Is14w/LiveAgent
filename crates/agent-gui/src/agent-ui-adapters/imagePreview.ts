import { invoke } from "@tauri-apps/api/core";

export const supportsSystemImageOpen = true;
export const supportsDirectUploadedImageCopy = true;

type ImagePreviewSaveData = {
  dataBase64: string;
  fileName: string;
  mimeType: string;
};

type ImagePreviewSaveRequest = Pick<ImagePreviewSaveData, "fileName" | "mimeType">;

export async function prepareImagePreviewSave(request: ImagePreviewSaveRequest) {
  const saveToken = await invoke<string | null>("system_prepare_preview_file_save", {
    file_name: request.fileName,
  });
  if (!saveToken) return null;

  return async (data: ImagePreviewSaveData) => {
    await invoke<boolean>("system_write_preview_file", {
      save_token: saveToken,
      data_base64: data.dataBase64,
      mime_type: data.mimeType,
    });
  };
}

export async function saveImagePreviewData(request: ImagePreviewSaveData) {
  const writeImage = await prepareImagePreviewSave(request);
  if (!writeImage) return false;
  await writeImage(request);
  return true;
}

export async function copyImagePreviewData(request: { dataBase64: string; mimeType: string }) {
  await invoke("system_clipboard_write_image", {
    data_base64: request.dataBase64,
    mime_type: request.mimeType,
  });
}

export async function prepareUploadedImagePreviewCopy(request: {
  workdir: string;
  absolutePath: string;
}) {
  await invoke("system_prepare_uploaded_image_clipboard", {
    workdir: request.workdir,
    absolute_path: request.absolutePath,
  });
}

export async function copyUploadedImagePreview(request: {
  workdir: string;
  absolutePath: string;
}) {
  await invoke("system_clipboard_write_uploaded_image", {
    workdir: request.workdir,
    absolute_path: request.absolutePath,
  });
}

export async function openUploadedImageInSystemViewer(request: {
  workdir: string;
  absolutePath: string;
}) {
  await invoke("system_open_uploaded_image", {
    workdir: request.workdir,
    absolute_path: request.absolutePath,
  });
}
