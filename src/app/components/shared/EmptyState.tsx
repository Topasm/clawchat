interface EmptyStateProps {
  icon: string;
  message: string;
}

export default function EmptyState({ icon, message }: EmptyStateProps) {
  return (
    <div className="cc-empty">
      <div className="cc-empty__icon">{icon}</div>
      <div className="cc-empty__message">{message}</div>
    </div>
  );
}
