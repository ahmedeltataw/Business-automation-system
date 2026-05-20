/**
 * Agent Configuration
 *
 * Centralized runtime configuration for the entire automation system.
 * Covers browser stealth settings, session management, AI provider timeouts,
 * scoring thresholds, scheduler cron expressions, scraper parameters,
 * proposal templates, and notification settings.
 */

export const agentConfig = {
  browser: {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    timezoneId: 'Africa/Cairo',
    locale: 'ar-EG',
    geolocation: { latitude: 30.0444, longitude: 31.2357 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-infobars',
      '--disable-notifications',
      '--disable-popup-blocking',
    ],
    canvasNoise: { min: -1, max: 1 },
    humanDelay: { minMs: 300, maxMs: 1200 },
    bezierSteps: 50,
    mouseMoveStepsBase: 25,
    mouseMoveStepsRandom: 35,
    mouseMoveDelayMs: { min: 4, max: 8 },
    defaultMousePos: { x: 960, y: 540 },
  },

  sessionManager: {
    expiryHours: 20,
    pageTimeout: 30000,
    loggedOutSignals: ['login', 'sign in', 'تسجيل الدخول', 'log in', 'register'],
    platformUrls: {
      mostaql: 'https://mostaql.com',
      khamsat: 'https://khamsat.com',
      kafil: 'https://kafil.com',
      bahar: 'https://bahar.website',
      ureed: 'https://ureed.com',
    } as Record<string, string>,
  },

  ai: {
    gemini: {
      timeoutMs: 30000,
      retryAttempts: [1, 2, 3],
      retryWaits429: [5000, 15000],
    },
    groq: {
      timeoutMs: 20000,
      temperature: 0.7,
      maxTokens: 1500,
      models: [
        'llama-3.3-70b-versatile',
        'llama3-8b-8192',
        'llama-3.1-8b-instant',
        'llama-3.2-90b-vision-preview',
        'llama-3.2-11b-vision-preview',
      ],
      keyRotationEnabled: true,
    },
    qualifyChain: ['lead-scorer'],
    proposalChain: ['proposal-generator'],
    googleFallbackModels: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemma-4-31b-it'],
    litellm: {
      aliases: ['lead-scorer', 'proposal-generator', 'backup-agent'],
      cooldownMs: 60000,
      numRetries: 3,
    },
    cloudflare: {
      timeoutMs: 30000,
      models: [
        '@cf/meta/llama-3.1-8b-instruct',
        '@cf/meta/llama-3.3-70b-instruct',
        '@cf/qwen/qwen1.5-14b-chat-awq',
      ],
    },
  },

  scoring: {
    minRelevantScore: 3,
    highScoreThreshold: 4,
    proposalMinScore: 4,
  },

  pipeline: {
    batchSize: 200,
  },

  scheduler: {
    cronEvery15Min: '*/15 * * * *',
    cronMidnight: '0 0 * * *',
    lockTimeoutMinutes: 15,
  },

  scrapers: {
    navTimeout: 60000,
    humanDelay: { min: 800, max: 1500 },
    maxEnrichPages: 10,
    platforms: {
      mostaql: { baseUrl: 'https://mostaql.com', projectsPath: '/projects', currency: 'USD' },
      khamsat: { baseUrl: 'https://khamsat.com', projectsPath: '/community/requests', currency: 'USD' },
      kafil: { baseUrl: 'https://kafil.com', projectsPath: '/projects', currency: 'SAR' },
      bahar: { baseUrl: 'https://bahar.website', projectsPath: '/projects', currency: 'EGP' },
      ureed: { baseUrl: 'https://ureed.com', projectsPath: '/projects', currency: 'USD' },
    } as Record<string, { baseUrl: string; projectsPath: string; currency: string }>,
  },

  proposal: {
    wordCount: { min: 150, max: 300 },
    typeProfiles: {
      'UI/UX': {
        name: 'تصميم تجربة وواجهة المستخدم',
        tools: 'Figma (Wireframing, User Flows, Interactive Prototyping)',
        hook: 'تصميم واجهات مستخدم احترافية تركز على تجربة المستخدم وسهولة الاستخدام',
      },
      'Websites/Webapps': {
        name: 'تطوير المواقع والتطبيقات الويب',
        tools: 'React/Vite (Frontend), Laravel/PHP (Backend), CUBE CSS/BEM (Styling), Lighthouse > 90%',
        hook: 'تطوير مواقع ويب فائقة السرعة وعالية الأداء باستخدام أحدث التقنيات',
      },
      'Full-Stack': {
        name: 'التطوير المتكامل (Full-Stack)',
        tools: 'React/Vite + Laravel/PHP + Optimized Performance',
        hook: 'حلول تقنية متكاملة من الواجهات الأمامية حتى الخادم بأداء استثنائي',
      },
      'Mobile': {
        name: 'تطوير تطبيقات الجوال',
        tools: 'Flutter • Firebase • iOS • Android',
        hook: 'تطبيقات جوال عابرة للمنصات بأداء أصلي',
      },
    } as Record<string, { name: string; tools: string; hook: string }>,
  },

  notifications: {
    telegram: {
      parseMode: 'Markdown' as const,
    },
  },
};

export type AgentConfig = typeof agentConfig;
