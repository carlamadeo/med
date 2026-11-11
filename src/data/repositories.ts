import { storage, type OperationRecord, type PortalRecord } from '@core/storage';
import type {
  Operation,
  OperationDraft,
  OperationRepository,
  Portal,
  PortalDraft,
  PortalRepository,
} from '@domain/repository';

function operationToRecord(op: Operation, createdAt = Date.now()): OperationRecord {
  return {
    id: op.id,
    name: op.name,
    studyIds: op.studyIds,
    color: op.color,
    createdAt,
    updatedAt: Date.now(),
  };
}

function recordToOperation(record: OperationRecord): Operation {
  return {
    id: record.id,
    name: record.name,
    studyIds: record.studyIds,
    color: record.color,
  };
}

function portalToRecord(p: Portal, createdAt = Date.now()): PortalRecord {
  return {
    name: p.name,
    displayName: p.displayName,
    url: p.url,
    createdAt,
    updatedAt: Date.now(),
  };
}

function recordToPortal(record: PortalRecord): Portal {
  return {
    name: record.name,
    displayName: record.displayName,
    url: record.url,
  };
}

export class IndexedDBOperationRepository implements OperationRepository {
  async list(): Promise<Operation[]> {
    const records = await storage.getOperations();
    return records.map(recordToOperation);
  }

  async get(id: string): Promise<Operation> {
    const record = await storage.getOperation(id);
    if (!record) throw new Error(`Operación ${id} no encontrada`);
    return recordToOperation(record);
  }

  async save(draft: OperationDraft): Promise<Operation> {
    const operation: Operation = {
      id: crypto.randomUUID(),
      name: draft.name.trim(),
      studyIds: [],
      color: draft.color,
    };
    await storage.setOperations([operationToRecord(operation)]);
    return operation;
  }

  async delete(id: string): Promise<void> {
    await storage.deleteOperation(id);
  }
}

export class IndexedDBPortalRepository implements PortalRepository {
  async list(): Promise<Portal[]> {
    const records = await storage.getPortals();
    return records.map(recordToPortal);
  }

  async get(name: string): Promise<Portal | undefined> {
    const record = await storage.getPortal(name.trim().toLowerCase());
    return record ? recordToPortal(record) : undefined;
  }

  async save(draft: PortalDraft): Promise<Portal> {
    const name = draft.name.trim().toLowerCase();
    const existing = await storage.getPortal(name);
    const portal: Portal = {
      name,
      displayName: draft.displayName.trim(),
      url: draft.url.trim(),
    };
    await storage.setPortals([portalToRecord(portal, existing?.createdAt)]);
    return portal;
  }

  async delete(name: string): Promise<void> {
    await storage.deletePortal(name.trim().toLowerCase());
  }
}

export const operationRepo = new IndexedDBOperationRepository();
export const portalRepo = new IndexedDBPortalRepository();
