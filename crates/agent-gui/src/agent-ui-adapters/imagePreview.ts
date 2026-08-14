import { invoke } from "@tauri-apps/api/core";

export const supportsSystemImageOpen = true;

export async function saveImagePreviewData(request: {
  dataBase64: string;
  fileName: string;
  mimeType: string;
}) {
  await invoke<boolean>("system_save_preview_file", {
    data_base64: request.dataBase64,
    file_name: request.fileName,
    mime_type: request.mimeType,
  });
}

export async function copyImagePreviewData(request: { dataBase64: string; mimeType: string }) {
  await invoke("system_clipboard_write_image", {
    data_base64: request.dataBase64,
    mime_type: request.mimeType,
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
