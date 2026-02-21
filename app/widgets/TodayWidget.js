import React from 'react';
import { FlexWidget, TextWidget, ListWidget } from 'react-native-android-widget';

function TaskItem({ title, completed }) {
  return (
    <FlexWidget
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 4,
        paddingHorizontal: 8,
      }}
    >
      <TextWidget
        text={completed ? '\u2611' : '\u2610'}
        style={{ fontSize: 16, width: 24 }}
      />
      <TextWidget
        text={title}
        style={{
          fontSize: 14,
          color: completed ? '#999999' : '#212121',
          flex: 1,
          textDecorationLine: completed ? 'line-through' : 'none',
        }}
        maxLines={1}
      />
    </FlexWidget>
  );
}

export default function TodayWidget({ greeting, taskCount, tasks, nextEvent }) {
  return (
    <FlexWidget
      style={{
        flex: 1,
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 16,
      }}
      clickAction="OPEN_APP"
    >
      {/* Header */}
      <TextWidget
        text={greeting || 'Good morning'}
        style={{ fontSize: 18, fontWeight: 'bold', color: '#212121' }}
      />
      <TextWidget
        text={`${taskCount || 0} tasks for today`}
        style={{ fontSize: 13, color: '#757575', marginTop: 2, marginBottom: 12 }}
      />

      {/* Task List */}
      {tasks && tasks.length > 0 ? (
        <ListWidget style={{ flex: 1 }}>
          {tasks.slice(0, 5).map((task, index) => (
            <TaskItem
              key={task.id || index}
              title={task.title}
              completed={task.status === 'completed'}
            />
          ))}
        </ListWidget>
      ) : (
        <TextWidget
          text="No tasks for today"
          style={{ fontSize: 14, color: '#BDBDBD', paddingVertical: 8 }}
        />
      )}

      {/* Next Event */}
      {nextEvent && (
        <FlexWidget
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: 8,
            paddingTop: 8,
            borderTopWidth: 1,
            borderTopColor: '#E0E0E0',
          }}
        >
          <TextWidget
            text="\uD83D\uDCC5"
            style={{ fontSize: 14, marginRight: 6 }}
          />
          <TextWidget
            text={`${nextEvent.title}${nextEvent.time ? ' \u00B7 ' + nextEvent.time : ''}`}
            style={{ fontSize: 13, color: '#3478F6', flex: 1 }}
            maxLines={1}
          />
        </FlexWidget>
      )}
    </FlexWidget>
  );
}
