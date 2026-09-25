import { type ReadOptions, readStatement } from "@duet/importers";

/** Reads statements off the main thread so the screen stays smooth on big files. */
self.onmessage = (
  event: MessageEvent<{ id: number; bytes: Uint8Array; name: string; options?: ReadOptions }>,
) => {
  const { id, bytes, name, options } = event.data;
  try {
    const parsed = readStatement(bytes, name, options);
    self.postMessage({ id, parsed });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
