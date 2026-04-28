import { useState } from 'react';

type Props = {
  itemName: string;
  currentRating: number | null;
  onConfirm: (rating: number) => void;
  onClear: () => void;
  onClose: () => void;
};

export default function StarRatingModal({ itemName, currentRating, onConfirm, onClear, onClose }: Props) {
  const [hoverRating, setHoverRating] = useState<number>(0);
  const displayRating = hoverRating || currentRating || 0;

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()}>
        <div className="modalTitle">{itemName}</div>
        <div className="modalSubtitle">评分</div>
        <div className="starRow">
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              type="button"
              className={`starBtn${s <= displayRating ? ' starActive' : ''}`}
              onClick={() => onConfirm(s)}
              onMouseEnter={() => setHoverRating(s)}
              onMouseLeave={() => setHoverRating(0)}
              aria-label={`${s}星`}
            >
              ★
            </button>
          ))}
        </div>
        <div className="modalActions">
          {currentRating != null && (
            <button type="button" className="modalBtnClear" onClick={onClear}>
              清除评分
            </button>
          )}
          <button type="button" className="modalBtnCancel" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
