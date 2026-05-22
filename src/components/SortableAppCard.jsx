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
  tourHighlight,
  tourShowDragHandle,
  tourFavoriteRef,
  tourInfoRef,
  tourDragHandleRef,
  tourRef,
  labels,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: app.id,
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const setCombinedRef = (node) => {
    setNodeRef(node);
    if (typeof tourRef === 'function') {
      tourRef(node);
    } else if (tourRef) {
      tourRef.current = node;
    }
  };

  return (
    <AppCard
      ref={setCombinedRef}
      app={app}
      isFavorite={isFavorite}
      onToggleFavorite={onToggleFavorite}
      showModeBadges={showModeBadges}
      compact={compact}
      tourHighlight={tourHighlight}
      tourShowDragHandle={tourShowDragHandle}
      tourFavoriteRef={tourFavoriteRef}
      tourInfoRef={tourInfoRef}
      tourDragHandleRef={tourDragHandleRef}
      labels={labels}
      dragHandleProps={disabled ? null : { ...attributes, ...listeners }}
      dragging={isDragging}
      style={style}
    />
  );
}
