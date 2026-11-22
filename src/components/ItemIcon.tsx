import React, { useMemo } from 'react';
import { getAtlas } from '../game/atlas';
import { getBlock } from '../game/blocks';

interface ItemIconProps {
  id: number;
  count?: number;
  size?: number;
  className?: string;
}

export const ItemIcon: React.FC<ItemIconProps> = ({ id, count, size = 34, className = '' }) => {
  const src = useMemo(() => {
    if (!id) return '';
    return getAtlas().getItemIcon(id);
  }, [id]);

  if (!id || !src) return null;
  const def = getBlock(id);

  return (
    <div className={`relative flex items-center justify-center select-none ${className}`} style={{ width: size, height: size }}>
      <img
        src={src}
        alt={def.name}
        width={size}
        height={size}
        draggable={false}
        className="pixelated w-full h-full object-contain pointer-events-none"
      />
      {count !== undefined && count > 1 && (
        <span
          className="font-mono-tabular absolute -bottom-0.5 -right-0.5 text-[11px] font-bold leading-none text-white pointer-events-none"
          style={{ textShadow: '1px 1px 0 #090d14, -1px -1px 0 #090d14, 1px -1px 0 #090d14, -1px 1px 0 #090d14' }}
        >
          {count}
        </span>
      )}
    </div>
  );
};
