// @aurora/web - Shared utility functions
// cn() utility for merging Tailwind CSS classes (shadcn/ui pattern)

import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind CSS classes with intelligent conflict resolution.
 * Used by shadcn/ui components and throughout the application.
 * 
 * @param {...string|Object|Array} inputs - Class names, objects, or arrays
 * @returns {string} Merged class string
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * Format a date relative to now (e.g., "2 hours ago")
 * @param {Date|string} date 
 * @returns {string}
 */
export function formatRelativeTime(date) {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return then.toLocaleDateString();
}

/**
 * Truncate text to a given length with ellipsis
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
export function truncateText(text, maxLength = 100) {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + '...';
}

/**
 * Generate a unique chat ID
 * @returns {string}
 */
export function generateChatId() {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
