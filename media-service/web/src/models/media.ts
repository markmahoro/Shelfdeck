export type MediaRating = 1 | 2 | 3 | 4 | 5;
export type MediaSelectedFlow = 'delete' | 'transcode' | 'upgrade' | 'scrape';
export type MediaOptimizationStatus = 'transcoded' | 'upgraded' | 'none';
export type MediaLifecycleStage = 'ingested' | 'metadata_ready' | 'archived' | string;

export type BusinessFlowOperation = {
  targetGate?: string;
  selectedFlow?: string;
  operation: MediaSelectedFlow | string;
};

export type BlockedBusinessFlowOperation = {
  targetGate?: string;
  selectedFlow?: string;
  operation: MediaSelectedFlow | string;
  reason: string;
  metadataMissingReasons?: string[];
  supportedEntry?: string;
  activeTaskId?: string;
};

export type BusinessFlowDecision = {
  lifecycleStage?: string;
  lifecycleDone?: boolean;
  metadataStatus?: string;
  optimizationStatus?: string;
  archiveStatus?: string;
  nextTargetGate?: string | null;
  recommendedTargetGate?: string | null;
  allowedTargets?: BusinessFlowOperation[];
  blockedTargets?: BlockedBusinessFlowOperation[];
  blockedReasonsByTargetGate?: Record<string, string>;
  activeTaskBridge?: string | null;
  activeFlowOperation?: string | null;
  latestEventSummary?: Record<string, unknown> | null;
  diagnosticSummary?: Record<string, unknown> | null;
};

export type ManagedMediaItem = {
  id: string;
  name: string;
  sectionId: string;
  sectionName?: string;
  source?: string;
  itemType?: 'Movie' | 'Season' | 'Other';
  seriesName?: string;
  seasonNumber?: number;
  resolution: '1080p' | '4K';
  codec: 'h264' | 'h265' | 'av1';
  durationSec: number;
  sizeGb: number;
  isBluRayDisc: boolean;
  rating: MediaRating | null;
  doubanStars: MediaRating | null;
  watched: boolean;
  reason?: string;
  equivalentBitrate?: number;
  targetBitrate?: number;
  predictedSizeGb?: number;
  optimizationStatus: MediaOptimizationStatus;
  optimizationAction?: 'transcode' | 'upgrade' | null;
  optimizationDoneAt?: string | null;
  optimizationTaskId?: string | null;
  lifecycleStage?: MediaLifecycleStage;
  lifecycleDone?: boolean;
  lifecycleNextTask?: 'metadata' | 'optimize' | string | null;
  lifecycleReason?: string;
  metadataStatus?: string;
  metadataKind?: string;
  metadataComplete?: boolean;
  metadataMissingReasons?: string[];
  archiveStatus?: string;
  archiveReason?: string;
  archiveDoneAt?: string | null;
  businessFlowDecision?: BusinessFlowDecision;
  embyWebUrl?: string;
  scraped?: boolean;
  adultMetadata?: Record<string, unknown>;
};
