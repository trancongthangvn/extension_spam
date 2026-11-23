declare namespace chrome {
  namespace storage {
    interface StorageChange {
      oldValue?: unknown;
      newValue?: unknown;
    }
    const local: {
      get: (
        keys: Record<string, unknown>,
        callback: (items: Record<string, unknown>) => void
      ) => void;
      set: (items: Record<string, unknown>, callback?: () => void) => void;
    };
    const onChanged: {
      addListener: (
        callback: (changes: Record<string, StorageChange>, areaName: string) => void
      ) => void;
      removeListener: (
        callback: (changes: Record<string, StorageChange>, areaName: string) => void
      ) => void;
    };
  }
  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
    }
    function query(queryInfo: { active?: boolean; currentWindow?: boolean }): Promise<Tab[]>;
    function sendMessage(
      tabId: number,
      message: unknown,
      responseCallback?: (response: unknown) => void
    ): void;
    function create(createProperties: { url: string }): void;
  }
  namespace runtime {
    const id: string | undefined;
    const lastError: { message?: string } | undefined;
  }
}
