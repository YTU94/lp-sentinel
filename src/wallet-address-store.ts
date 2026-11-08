export function walletAddressPreference(action: "read" | "save" | "clear", address?: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error("浏览器未提供 IndexedDB"));
    const request = indexedDB.open("lp-sentinel", 2);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("preferences")) request.result.createObjectStore("preferences"); };
    request.onerror = () => reject(new Error("无法打开本地地址存储"));
    request.onblocked = () => reject(new Error("本地存储被其他页面占用，请关闭旧页面后重试"));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      const transaction = db.transaction("preferences", action === "read" ? "readonly" : "readwrite");
      const store = transaction.objectStore("preferences");
      const operation = action === "read" ? store.get("wallet-address") : action === "save" ? store.put(address, "wallet-address") : store.delete("wallet-address");
      let value: string | undefined;
      operation.onsuccess = () => { if (action === "read" && typeof operation.result === "string") value = operation.result; };
      transaction.oncomplete = () => { db.close(); resolve(value); };
      transaction.onerror = transaction.onabort = () => { db.close(); reject(new Error("地址未能保存到本地，请检查浏览器存储权限")); };
    };
  });
}
