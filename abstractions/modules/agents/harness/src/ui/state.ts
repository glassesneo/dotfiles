import { createSignal, onCleanup } from "solid-js";

export function useVersion(...sources: { subscribe(listener: () => void): () => void }[]) {
  const [version, setVersion] = createSignal(0);
  for (const source of sources) {
    onCleanup(source.subscribe(() => setVersion((value) => value + 1)));
  }
  return version;
}
