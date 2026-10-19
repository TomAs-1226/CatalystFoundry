import type { Job } from '../domain/model';
import { stableStringify } from '../domain/invariants';
import type { ConfiguredSlicingProfile } from '../adapters/slicing';

/** Process edits can refresh exact profile hashes; hardware changes require selection. */
export function processProfileUpdate(job: Job, profile: ConfiguredSlicingProfile) {
  if (stableStringify(profile.printer) !== stableStringify(job.printer)
    || stableStringify(profile.material) !== stableStringify({ ...job.material, color: profile.material.color }))
    throw new Error('Choose Printer & material and apply the configured profile to this plate.');
  return stableStringify(profile.slicer) === stableStringify(job.slicer) ? undefined : profile;
}
