/**
 * Format a date string into "Feb 21, 2026" format.
 * @param {string} dateString - ISO date string
 * @returns {string}
 */
export function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format a date string into "3:00 PM" format.
 * @param {string} dateString - ISO date string
 * @returns {string}
 */
export function formatTime(dateString) {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format a date string into "Feb 21, 2026 at 3:00 PM" format.
 * @param {string} dateString - ISO date string
 * @returns {string}
 */
export function formatDateTime(dateString) {
  return `${formatDate(dateString)} at ${formatTime(dateString)}`;
}

/**
 * Format a date string into a relative time description.
 * Returns "just now", "X minutes ago", "X hours ago", "yesterday",
 * "X days ago", or the formatted date for older dates.
 * @param {string} dateString - ISO date string
 * @returns {string}
 */
export function formatRelativeTime(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return 'just now';
  }
  if (diffMinutes < 60) {
    return diffMinutes === 1 ? '1 minute ago' : `${diffMinutes} minutes ago`;
  }
  if (diffHours < 24) {
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
  }
  if (diffDays === 1) {
    return 'yesterday';
  }
  if (diffDays < 7) {
    return `${diffDays} days ago`;
  }

  return formatDate(dateString);
}

/**
 * Truncate a text string to a given maximum length, appending "..." if truncated.
 * @param {string} text - The text to truncate
 * @param {number} maxLength - Maximum character length (default 50)
 * @returns {string}
 */
export function truncate(text, maxLength = 50) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

export function isToday(dateString) {
  if (!dateString) return false;
  const date = new Date(dateString);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
}

export function isTomorrow(dateString) {
  if (!dateString) return false;
  const date = new Date(dateString);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate();
}

export function isOverdue(dateString) {
  if (!dateString) return false;
  const date = new Date(dateString);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return date < now;
}

export function isThisWeek(dateString) {
  if (!dateString) return false;
  const date = new Date(dateString);
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);
  return date >= startOfWeek && date < endOfWeek;
}

export function formatDueDate(dateString) {
  if (!dateString) return '';
  if (isToday(dateString)) return 'Today';
  if (isTomorrow(dateString)) return 'Tomorrow';
  if (isOverdue(dateString)) return 'Overdue';
  return formatDate(dateString);
}

export function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function groupTodosByDate(todos) {
  const groups = { overdue: [], today: [], tomorrow: [], thisWeek: [], later: [], noDate: [] };
  todos.forEach((todo) => {
    if (!todo.due_date) {
      groups.noDate.push(todo);
    } else if (isOverdue(todo.due_date) && todo.status !== 'completed') {
      groups.overdue.push(todo);
    } else if (isToday(todo.due_date)) {
      groups.today.push(todo);
    } else if (isTomorrow(todo.due_date)) {
      groups.tomorrow.push(todo);
    } else if (isThisWeek(todo.due_date)) {
      groups.thisWeek.push(todo);
    } else {
      groups.later.push(todo);
    }
  });
  return groups;
}
