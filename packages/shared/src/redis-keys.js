// @aurora/shared — Redis key patterns and TTL constants
// Centralized key naming ensures consistency across all services.

export const KEYS = {
  // Users
  USER_BY_EMAIL: (email) => `user:email:${email}`,
  USER_BY_ID: (userId) => `user:id:${userId}`,
  
  // Sessions (with TTL)
  SESSION: (token) => `session:${token}`,
  
  // API Keys
  API_KEY: (keyId) => `apikey:${keyId}`,
  USER_API_KEYS: (userId) => `user:apikeys:${userId}`,
  
  // Chats
  CHAT: (chatId) => `chat:${chatId}`,
  CHAT_MESSAGES: (chatId) => `chat:messages:${chatId}`,
  USER_CHATS: (userId) => `user:chats:${userId}`,
  
  // Caches
  PROVIDER_MODELS: (provider) => `cache:models:${provider}`,
};

export const TTL = {
  SESSION: 30 * 24 * 60 * 60,        // 30 days
  API_KEY: 7 * 24 * 60 * 60,          // 7 days (keys re-fetched from localStorage)
  PROVIDER_MODELS: 60 * 60,            // 1 hour
  RATE_LIMIT: 60,                      // 1 minute
  TOKEN_GRACE: 5 * 60,                // 5 minutes (smooth token rotation)
};
