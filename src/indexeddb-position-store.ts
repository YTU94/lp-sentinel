import type { LpSourceId, Position } from './types';

export interface StoredLpPosition {
  key: string;
  id: string;
  sourceId: LpSourceId;
  tokenId: string;
  enabled: boolean;
  alertLower: number;
  alertUpper: number;
  alertState: { armed: boolean; lastBoundary: 'lower' | 'upper' | null };
  createdAt: string;
}

export const storedPositionKey = (sourceId: LpSourceId, tokenId: string) => `${sourceId}:${tokenId}`;

export function toStoredPosition(position: Position): StoredLpPosition {
  return {
    key: storedPositionKey(position.source.sourceId, position.source.tokenId),
    id: position.id,
    sourceId: position.source.sourceId,
    tokenId: position.source.tokenId,
    enabled: position.enabled,
    alertLower: position.alertLower,
    alertUpper: position.alertUpper,
    alertState: { ...position.alertState },
    createdAt: position.createdAt,
  };
}

const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error || new Error('IndexedDB 事务失败'));
  transaction.onabort = () => reject(transaction.error || new Error('IndexedDB 事务已中止'));
});

export class IndexedDbPositionStore {
  private readonly databasePromise: Promise<IDBDatabase>;
  private database?: IDBDatabase;

  constructor(private readonly databaseName = 'lp-sentinel') {
    this.databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('positions')) request.result.createObjectStore('positions', { keyPath: 'key' });
      };
      request.onsuccess = () => { this.database = request.result; resolve(request.result); };
      request.onerror = () => reject(request.error || new Error('无法打开 IndexedDB'));
      request.onblocked = () => reject(new Error('IndexedDB 升级被其他页面阻塞'));
    });
  }

  async getAll(): Promise<StoredLpPosition[]> {
    const database = await this.databasePromise;
    const transaction = database.transaction('positions', 'readonly');
    const request = transaction.objectStore('positions').getAll();
    const result = await new Promise<StoredLpPosition[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as StoredLpPosition[]);
      request.onerror = () => reject(request.error || new Error('读取 IndexedDB 失败'));
    });
    await transactionDone(transaction);
    return result.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async put(position: StoredLpPosition): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction('positions', 'readwrite');
    transaction.objectStore('positions').put(position);
    await transactionDone(transaction);
  }

  async putAll(positions: StoredLpPosition[]): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction('positions', 'readwrite');
    const store = transaction.objectStore('positions');
    for (const position of positions) store.put(position);
    await transactionDone(transaction);
  }

  async remove(key: string): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction('positions', 'readwrite');
    transaction.objectStore('positions').delete(key);
    await transactionDone(transaction);
  }

  close(): void {
    this.database?.close();
  }
}
