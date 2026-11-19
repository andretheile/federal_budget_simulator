/**
 * A part of the app that is loaded only when it is needed: a module behind a dynamic import, kept
 * once it has arrived. Unlike React.lazy it can be asked whether the module is there yet (so a
 * component can render it at once, without a frame of waiting), it can be loaded ahead of time,
 * and a failed load is forgotten, so that the next attempt fetches it again.
 */
export interface LazyModule<T> {
  /** The module, if it has arrived. */
  current(): T | undefined;
  /** Loads the module, or waits for the load under way. Rejects if it cannot be loaded. */
  load(): Promise<T>;
  /** Starts loading ahead of time; a failure is left for the next `load` to find. */
  preload(): void;
}

export function lazyModule<T>(importer: () => Promise<T>): LazyModule<T> {
  let module: T | undefined;
  let pending: Promise<T> | undefined;
  const load = (): Promise<T> => {
    if (module !== undefined) return Promise.resolve(module);
    pending ??= importer().then(
      (value) => {
        module = value;
        pending = undefined;
        return value;
      },
      (error: unknown) => {
        pending = undefined;
        throw error;
      },
    );
    return pending;
  };
  return {
    current: () => module,
    load,
    preload: () => {
      load().catch(() => undefined);
    },
  };
}
