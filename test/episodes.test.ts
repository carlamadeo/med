import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storage } from '@core/storage';
import { driveAuth, driveEpisodeRepo } from '@data';
import { resetFakeDrive, addRemoteRaw } from './fake-drive';

const baseEpisode = {
  illness: 'Gripe',
  observations: [{ date: '2024-01-01', text: 'Síntomas leves', symptoms: [] }],
  medications: [{ name: 'Paracetamol', frequency: 'cada 8h', instructions: 'Tomar con comida' }],
};

beforeEach(async () => {
  resetFakeDrive();
  await storage.clearStudyCache();
  await driveAuth.signOut();
  await driveAuth.signIn();
});

describe('episodes', () => {
  it('saves and lists episodes online', async () => {
    const saved = await driveEpisodeRepo.save(baseEpisode);
    
    expect(saved.illness).toBe('Gripe');
    expect(saved.id).toBeTruthy();
    
    const listed = await driveEpisodeRepo.list();
    expect(listed).toHaveLength(1);
    expect(listed.at(0)?.illness).toBe('Gripe');
  });

  it('reserves and persists a Drive ID before a create', async () => {
    await driveEpisodeRepo.save(baseEpisode);
    
    const listed = await driveEpisodeRepo.list();
    expect(listed).toHaveLength(1);
    expect(listed.at(0)?.id).toBeTruthy();
  });

  it('updates an existing episode with revision check', async () => {
    const saved = await driveEpisodeRepo.save(baseEpisode);
    expect(saved.id).toBeTruthy();
    
    const updated = await driveEpisodeRepo.save({ ...baseEpisode, id: saved.id, revision: saved.revision, illness: 'Gripe actualizada' });
    expect(updated.illness).toBe('Gripe actualizada');
    expect(updated.revision).not.toBe(saved.revision);
  });

  it('rejects stale revision on update', async () => {
    const saved = await driveEpisodeRepo.save(baseEpisode);
    
    // Simulate another device changing the episode
    addRemoteRaw(saved.id, { illness: 'Gripe modificada por otro dispositivo' });
    
    await expect(driveEpisodeRepo.save({ ...baseEpisode, id: saved.id, revision: saved.revision, illness: 'Intento de actualización' })).rejects.toThrow();
  });

  it('lists episodes from cache when offline', async () => {
    await driveEpisodeRepo.save(baseEpisode);
    await driveEpisodeRepo.save({ ...baseEpisode, illness: 'Lumbalgia' });
    
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    
    const listed = await driveEpisodeRepo.list();
    expect(listed).toHaveLength(2);
    expect(listed.map(e => e.illness).sort()).toEqual(['Gripe', 'Lumbalgia']);
  });

  it('deletes an episode with revision check', async () => {
    const saved = await driveEpisodeRepo.save(baseEpisode);
    
    await driveEpisodeRepo.delete(saved.id, saved.revision);
    
    const listed = await driveEpisodeRepo.list();
    expect(listed).toHaveLength(0);
  });

  it('rejects delete with stale revision', async () => {
    const saved = await driveEpisodeRepo.save(baseEpisode);
    
    // Simulate another device changing the episode
    addRemoteRaw(saved.id, { illness: 'Gripe modificada' });
    
    await expect(driveEpisodeRepo.delete(saved.id, saved.revision)).rejects.toThrow();
  });

  it('stores episodes scoped to the verified account', async () => {
    await driveEpisodeRepo.save(baseEpisode);
    
    const listed = await driveEpisodeRepo.list();
    expect(listed).toHaveLength(1);
    expect(listed.at(0)?.illness).toBe('Gripe');
  });

  it('clears episodes when cache is rebound to different owner', async () => {
    await driveEpisodeRepo.save(baseEpisode);
    
    await driveAuth.signOut();
    await driveAuth.signIn();
    
    // After sign-out/sign-in, the local cache should be cleared for the new owner
    const newOwner = await driveEpisodeRepo.client.cacheOwner();
    const cached = await storage.readSessionEpisodes(newOwner);
    expect(cached).toEqual([]);
  });
});