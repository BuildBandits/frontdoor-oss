import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import AppCard from './AppCard';

export default function SortableAppCard({
  app,
  isFavorite,
  onToggleFavorite,
  disabled,
  showModeBadges,
  compact,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: app.id,
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <AppCard
      ref={setNodeRef}
      app={app}
      isFavorite={isFavorite}
      onToggleFavorite={onToggleFavorite}
      showModeBadges={showModeBadges}
      compact={compact}
      dragHandleProps={disabled ? null : { ...attributes, ...listeners }}
      dragging={isDragging}
      style={style}
    />
  );
}
