export type MediaRating = 1 | 2 | 3 | 4 | 5;
export type MediaAction = 'delete' | 'transcode' | 'upgrade' | 'keep';

export type ManagedMediaItem = {
  id: string;
  name: string;
  sectionId: string;
  sectionName?: string;
  itemType?: 'Movie' | 'Episode' | 'Other';
  resolution: '1080p' | '4K';
  codec: 'h264' | 'h265' | 'av1';
  durationSec: number;
  sizeGb: number;
  isBluRayDisc: boolean;
  rating: MediaRating | null;
  doubanStars: MediaRating | null;
  watched: boolean;
  recommendedAction?: MediaAction;
  equivalentBitrate?: number;
  targetBitrate?: number;
  predictedSizeGb?: number;
  embyWebUrl?: string;
};
