import { beginImport, dayLabel, type ImportOutcome } from "@duet/core";
import type { PickedFile } from "../platform/index.ts";
import type { App, PendingFile } from "./app.ts";

/**
 * Upload, from the button, the drop area or a drop anywhere on the window. Files are
 * read one at a time; a new card or an unfamiliar layout opens its sheet and the next
 * file waits until that is done.
 */
export async function uploadFiles(app: App, files: PickedFile[]): Promise<void> {
  let lastReady: string | null = null;
  let readyCount = 0;
  for (const file of files) {
    const fileId = await uploadOne(app, file);
    if (fileId) {
      lastReady = fileId;
      readyCount++;
      // The Mac mini's models look at the rows still unsure, in the background.
      void app.sorting.run(fileId);
    }
  }
  if (readyCount === 1 && lastReady) app.navigate({ name: "sort", fileId: lastReady });
  else if (readyCount > 1) app.navigate({ name: "uploads", month: null });
}

async function uploadOne(app: App, file: PickedFile): Promise<string | null> {
  let parsed: PendingFile["parsed"];
  try {
    parsed = await app.parse(file);
  } catch {
    app.toast(`Couldn't read ${file.name}. Is it a CSV, XLSX, OFX or QFX file?`);
    return null;
  }
  const pending: PendingFile = { ...file, parsed };
  let outcome: ImportOutcome;
  try {
    outcome = await beginImport(app.store, {
      fileName: file.name,
      bytes: file.bytes,
      parsed,
      path: file.path,
    });
  } catch (error) {
    console.error(error);
    app.toast(`Something went wrong with ${file.name}.`);
    return null;
  }
  switch (outcome.status) {
    case "already":
      app.toast(
        `${file.name} was already uploaded on ${dayLabel(outcome.file.broughtInAt.slice(0, 10))}.`,
      );
      return null;
    case "empty":
      app.toast(`There are no transactions in ${file.name}.`);
      return null;
    case "needs-setup": {
      const fileId = await app.openSheetAndWait<string>({ kind: "column-match", file: pending });
      return fileId ?? null;
    }
    case "new-account": {
      const fileId = await app.openSheetAndWait<string>({
        kind: "new-account",
        file: pending,
        suggestion: outcome.suggestion,
      });
      return fileId ?? null;
    }
    case "ready":
      return outcome.fileId;
  }
}
