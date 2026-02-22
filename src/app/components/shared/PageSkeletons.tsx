import Skeleton from './Skeleton';

export function TodayPageSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Greeting bar */}
      <div>
        <Skeleton variant="text" width="60%" height={24} />
        <Skeleton variant="text" width="40%" height={14} className="cc-skeleton--mt8" />
      </div>
      {/* Progress bar */}
      <Skeleton variant="rectangular" width="100%" height={56} />
      {/* Task card skeletons */}
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} variant="rectangular" width="100%" height={52} />
      ))}
    </div>
  );
}

export function ChatListSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
          <Skeleton variant="circular" width={36} height={36} />
          <div style={{ flex: 1 }}>
            <Skeleton variant="text" width="70%" height={14} />
            <Skeleton variant="text" width="45%" height={12} className="cc-skeleton--mt8" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChatPageSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 16px' }}>
      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Skeleton variant="circular" width={32} height={32} />
        <Skeleton variant="text" width="30%" height={16} />
      </div>
      {/* Message bubbles */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            justifyContent: i % 2 === 0 ? 'flex-start' : 'flex-end',
          }}
        >
          <Skeleton
            variant="rectangular"
            width={i % 2 === 0 ? '55%' : '40%'}
            height={i % 3 === 0 ? 56 : 36}
          />
        </div>
      ))}
    </div>
  );
}

export function BriefingSkeleton() {
  return (
    <div className="cc-briefing-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Skeleton variant="circular" width={20} height={20} />
        <Skeleton variant="text" width={120} height={14} />
      </div>
      <Skeleton variant="text" width="90%" height={13} />
      <Skeleton variant="text" width="75%" height={13} className="cc-skeleton--mt8" />
      <Skeleton variant="text" width="60%" height={13} className="cc-skeleton--mt8" />
    </div>
  );
}
