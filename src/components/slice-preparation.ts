import type { Job, Project } from '../domain/model';
import { fingerprint } from '../domain/invariants';
import type { BundledSlicing, ConfiguredSlicingProfile, PreparedSlice, SliceJob } from '../adapters/slicing';
import { processProfileUpdate } from './slice-profile';

/** One confirmed action. Intermediate React renders are never prerequisites for
 * applying profiles, arranging, resolving settings and queueing the exact plate. */
export async function prepareConfirmedSlice(options: {
  confirmed: boolean; selection: BundledSlicing['profiles'][number]; targetId: string; arrange: boolean; attemptKey: string;
  current: () => { project: Project; job: Job }; checkActive: () => void;
  apply: (profile: ConfiguredSlicingProfile) => Project | false;
  preparePlate: (arrange: boolean) => Promise<Project>;
  resolveProfile: (settings: Job['settings']) => Promise<ConfiguredSlicingProfile>;
  prepare: (project: Project, id: string) => Promise<PreparedSlice>;
  queue: (preparation: PreparedSlice, key: string) => Promise<SliceJob>;
  stage: (message: string) => void; manifest: (hash: string) => void;
}) {
  if (!options.confirmed) throw new Error('Confirm printer, nozzle, plate and material before slicing.');
  const current = () => { options.checkActive(); const value = options.current(); if (value.job.id !== options.targetId) throw new Error('The active plate changed.'); return value; };
  const first = current();
  if (options.apply({ ...options.selection, profileLabel: options.selection.label, slicer: first.job.slicer }) === false)
    throw new Error('Another action is in progress. Retry Slice plate.');
  options.stage(options.arrange ? 'Arranging copies and checking support rules…' : 'Checking support rules for the current placement…');
  const preparedProject = await options.preparePlate(options.arrange), preparedJob = preparedProject.jobs.find(job => job.id === options.targetId)!;
  const before = await fingerprint(preparedProject, preparedJob); current();
  options.stage('Resolving exact print settings…');
  const profile = await options.resolveProfile(preparedJob.settings);
  const latest = current();
  if (await fingerprint(latest.project, latest.job) !== before) throw new Error('The plate changed while resolving settings. Retry the current plate.');
  // A service configuration change must not silently replace the hardware the
  // operator just confirmed, even when it returns a valid complete profile.
  processProfileUpdate(latest.job, profile);
  const applied = options.apply(profile); if (applied === false) throw new Error('Another action is in progress. Retry Slice plate.');
  const snapshot = structuredClone(applied), target = snapshot.jobs.find(job => job.id === options.targetId)!;
  const expected = await fingerprint(snapshot, target); options.manifest(expected);
  options.stage('Preparing exact geometry for Bambu Studio…');
  const prepared = await options.prepare(snapshot, options.targetId), now = current();
  if (prepared.manifestHash !== expected || await fingerprint(now.project, now.job) !== expected)
    throw new Error('The plate changed during preparation. Retry the updated plate.');
  return options.queue(prepared, options.attemptKey);
}
