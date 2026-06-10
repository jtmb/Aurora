// @aurora/shared - Utility Functions
// Shared utilities used across all services

/**
 * Format a date string to readable format (ISO)
 */
export function formatDate(date) {
  if (!date) return '';
  
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  
  return d.toISOString();
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(ms) {
  if (!ms && ms !== 0) return '';
  
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor((ms / (1000 * 60 * 60)));
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Truncate text to specified length with ellipsis
 */
export function truncateText(text, maxLength = 50) {
  if (!text || text.length <= maxLength) return text;
  
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Generate a short random string for IDs/tokens
 */
export function generateRandomString(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  
  return result;
}

/**
 * Parse ISO date string to Date object
 */
export function parseISODate(isoString) {
  if (!isoString) return null;
  
  const d = new Date(isoString);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Generate OpenAI-compatible request ID (for correlation)
 */
export function generateRequestId() {
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff(
  fn,
  options = {}
) {
  const {
    maxRetries = 3,
    initialDelayMs = 100,
    maxDelayMs = 5000
  } = options;

  let delay = initialDelayMs;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      
      console.log(`Retry ${i + 1}/${maxRetries} after ${delay}ms`);
      await sleep(delay);
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }

  throw new Error('All retries exhausted');
}