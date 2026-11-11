import { beforeEach, describe, expect, it } from 'vitest';
import { storage } from '@core/storage';
import { operationRepo, portalRepo } from '@data';

async function clearStores(): Promise<void> {
  for (const op of await storage.getOperations()) await storage.deleteOperation(op.id);
  for (const portal of await storage.getPortals()) await storage.deletePortal(portal.name);
}

describe('IndexedDBOperationRepository', () => {
  beforeEach(clearStores);

  it('returns an empty list initially', async () => {
    expect(await operationRepo.list()).toEqual([]);
  });

  it('saves and lists an operation', async () => {
    const saved = await operationRepo.save({ name: '  Operación test ', color: '#ff0000' });

    expect(saved).toMatchObject({ name: 'Operación test', color: '#ff0000', studyIds: [] });
    expect(saved.id).toBeTruthy();

    const operations = await operationRepo.list();
    expect(operations).toHaveLength(1);
    expect(operations[0]?.id).toBe(saved.id);
  });

  it('gets an operation by id', async () => {
    const saved = await operationRepo.save({ name: 'Test', color: '#0000ff' });
    expect(await operationRepo.get(saved.id)).toEqual(saved);
  });

  it('throws when the operation does not exist', async () => {
    await expect(operationRepo.get('missing')).rejects.toThrow('Operación missing no encontrada');
  });

  it('deletes only the requested operation', async () => {
    const keep = await operationRepo.save({ name: 'Keep', color: '#111111' });
    const drop = await operationRepo.save({ name: 'Drop', color: '#222222' });

    await operationRepo.delete(drop.id);

    const remaining = await operationRepo.list();
    expect(remaining.map((o) => o.id)).toEqual([keep.id]);
  });
});

describe('IndexedDBPortalRepository', () => {
  beforeEach(clearStores);

  it('returns an empty list initially', async () => {
    expect(await portalRepo.list()).toEqual([]);
  });

  it('saves and lists a portal', async () => {
    const saved = await portalRepo.save({
      name: 'hospital-central',
      displayName: 'Hospital Central',
      url: 'https://hospital.com',
    });

    expect(saved).toEqual({
      name: 'hospital-central',
      displayName: 'Hospital Central',
      url: 'https://hospital.com',
    });
    expect(await portalRepo.list()).toEqual([saved]);
  });

  it('normalizes the portal name to lowercase', async () => {
    const saved = await portalRepo.save({
      name: 'HOSPITAL-CENTRAL',
      displayName: 'Hospital Central',
      url: 'https://hospital.com',
    });
    expect(saved.name).toBe('hospital-central');
    expect(await portalRepo.get('Hospital-Central')).toEqual(saved);
  });

  it('upserts when saving the same name twice', async () => {
    await portalRepo.save({ name: 'labcorp', displayName: 'LabCorp', url: 'https://old.com' });
    await portalRepo.save({ name: 'LABCORP', displayName: 'LabCorp', url: 'https://new.com' });

    const portals = await portalRepo.list();
    expect(portals).toHaveLength(1);
    expect(portals[0]?.url).toBe('https://new.com');
  });

  it('returns undefined for a missing portal', async () => {
    expect(await portalRepo.get('missing')).toBeUndefined();
  });

  it('deletes a portal', async () => {
    await portalRepo.save({ name: 'to-delete', displayName: 'To Delete', url: 'https://delete.com' });
    await portalRepo.delete('to-delete');
    expect(await portalRepo.list()).toEqual([]);
  });
});
