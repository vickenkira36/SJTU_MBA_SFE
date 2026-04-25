import { Hospital, Territory, Constraint, HistoricalAssignment, LockAssignment, RegionConstraintParams, AlgorithmMode } from '@/types';
import { optimizeByProvince } from './optimizer';

self.onmessage = (e: MessageEvent) => {
  const { hospitals, territories, constraints, historicalAssignments, lockAssignments, regionConstraints, algorithmMode } = e.data as {
    hospitals: Hospital[];
    territories: Territory[];
    constraints: Constraint[];
    historicalAssignments?: HistoricalAssignment[];
    lockAssignments?: LockAssignment[];
    regionConstraints?: RegionConstraintParams[];
    algorithmMode?: AlgorithmMode;
  };

  const result = optimizeByProvince(
    hospitals,
    territories,
    constraints,
    (current: number, total: number, province: string) => {
      self.postMessage({
        type: 'progress',
        data: { current, total, province },
      });
    },
    historicalAssignments,
    lockAssignments,
    regionConstraints,
    algorithmMode
  );

  self.postMessage({
    type: 'done',
    data: { result },
  });
};
