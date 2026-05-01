// TPCE — Theme Page Content Engine
// Shared data & mock state

window.TPCE_DATA = {
  themePages: [
    { id: 'tp1', name: 'AI Tools Daily', niche: 'AI Tools', status: 'active', accent: '#F59E0B', posts: 142, followers: '48.2K' },
    { id: 'tp2', name: 'Side Hustle Lab', niche: 'Side Hustles', status: 'active', accent: '#10B981', posts: 89, followers: '22.1K' },
    { id: 'tp3', name: 'Crypto Signals', niche: 'Crypto', status: 'paused', accent: '#6366F1', posts: 31, followers: '9.4K' },
    { id: 'tp4', name: 'Fitness Unlocked', niche: 'Fitness', status: 'active', accent: '#EF4444', posts: 204, followers: '91.7K' },
  ],

  niches: [
    { id: 'n1', name: 'AI Tools', trendScore: 97, monetizationScore: 92, competition: 'High', growth: '+34%', emoji: '🤖' },
    { id: 'n2', name: 'Side Hustles', trendScore: 94, monetizationScore: 96, competition: 'Med', growth: '+28%', emoji: '💰' },
    { id: 'n3', name: 'Crypto & Web3', trendScore: 85, monetizationScore: 88, competition: 'High', growth: '+19%', emoji: '⛓️' },
    { id: 'n4', name: 'Fitness & Health', trendScore: 91, monetizationScore: 85, competition: 'High', growth: '+22%', emoji: '💪' },
    { id: 'n5', name: 'Personal Finance', trendScore: 89, monetizationScore: 93, competition: 'Med', growth: '+31%', emoji: '📊' },
    { id: 'n6', name: 'Mental Health', trendScore: 88, monetizationScore: 72, competition: 'Low', growth: '+41%', emoji: '🧠' },
    { id: 'n7', name: 'Productivity', trendScore: 86, monetizationScore: 80, competition: 'Med', growth: '+18%', emoji: '⚡' },
    { id: 'n8', name: 'Travel Hacks', trendScore: 83, monetizationScore: 78, competition: 'Med', growth: '+15%', emoji: '✈️' },
    { id: 'n9', name: 'Real Estate', trendScore: 80, monetizationScore: 94, competition: 'Low', growth: '+12%', emoji: '🏠' },
    { id: 'n10', name: 'Sustainable Living', trendScore: 79, monetizationScore: 70, competition: 'Low', growth: '+47%', emoji: '🌿' },
    { id: 'n11', name: 'Creator Economy', trendScore: 88, monetizationScore: 89, competition: 'Med', growth: '+26%', emoji: '🎬' },
    { id: 'n12', name: 'Tech News', trendScore: 82, monetizationScore: 75, competition: 'High', growth: '+11%', emoji: '💻' },
  ],

  topics: [
    { id: 't1', title: '7 AI tools that replace a full-time employee in 2025', source: 'Reddit', score: 94, tags: ['AI', 'Automation', 'Tools'], status: 'review', platform: 'reddit' },
    { id: 't2', title: 'ChatGPT-5 drops — here\'s what changed for content creators', source: 'Twitter/X', score: 91, tags: ['ChatGPT', 'AI', 'Update'], status: 'approved', platform: 'twitter' },
    { id: 't3', title: 'Make $5K/month with this AI side hustle nobody talks about', source: 'Google Trends', score: 88, tags: ['Income', 'AI', 'Hustle'], status: 'review', platform: 'trends' },
    { id: 't4', title: 'The AI tool that creates viral carousels in 60 seconds', source: 'RSS', score: 86, tags: ['Carousel', 'Viral', 'AI'], status: 'scheduled', platform: 'rss' },
    { id: 't5', title: 'Why most people fail with AI automation (and how to fix it)', source: 'Reddit', score: 83, tags: ['Automation', 'Strategy'], status: 'posted', platform: 'reddit' },
    { id: 't6', title: 'Top 5 AI image generators compared (honest review)', source: 'Twitter/X', score: 81, tags: ['Images', 'Tools', 'Review'], status: 'review', platform: 'twitter' },
    { id: 't7', title: 'This free AI tool just went viral — here\'s why', source: 'Google Trends', score: 79, tags: ['Viral', 'Free', 'AI'], status: 'approved', platform: 'trends' },
    { id: 't8', title: 'Build a $10K AI business with zero coding (step by step)', source: 'RSS', score: 77, tags: ['Business', 'NoCode', 'AI'], status: 'review', platform: 'rss' },
  ],

  metrics: {
    topics: 847,
    selected: 124,
    qaReady: 68,
    approved: 43,
    scheduled: 19,
    posted: 142,
  },

  analyticsData: {
    views: [12400, 18200, 15600, 22100, 19800, 28400, 31200, 26800, 34100, 29600, 38200, 41500],
    saves: [890, 1240, 1080, 1560, 1320, 1890, 2100, 1780, 2340, 1980, 2560, 2890],
    follows: [234, 389, 312, 456, 401, 589, 623, 512, 678, 590, 712, 834],
    months: ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May'],
    topPosts: [
      { title: '7 AI tools replacing employees', views: '124K', saves: '8.2K', type: 'Carousel' },
      { title: 'ChatGPT-5 honest review', views: '98K', saves: '6.1K', type: 'Reel' },
      { title: 'AI side hustle blueprint', views: '87K', saves: '5.4K', type: 'Carousel' },
      { title: 'Free tools vs paid tools', views: '71K', saves: '4.9K', type: 'Post' },
    ]
  },

  schedulerSlots: {
    '2026-05-01': [
      { id: 's1', title: 'AI tools replacing employees', time: '09:00', type: 'Carousel', status: 'posted' },
      { id: 's2', title: 'ChatGPT-5 update breakdown', time: '17:00', type: 'Reel', status: 'posted' },
    ],
    '2026-05-03': [
      { id: 's3', title: 'AI side hustle blueprint', time: '12:00', type: 'Carousel', status: 'scheduled' },
    ],
    '2026-05-05': [
      { id: 's4', title: 'Image generators comparison', time: '09:00', type: 'Post', status: 'scheduled' },
      { id: 's5', title: 'Build $10K AI business', time: '17:00', type: 'Carousel', status: 'scheduled' },
    ],
    '2026-05-07': [
      { id: 's6', title: 'Free AI tool went viral', time: '12:00', type: 'Reel', status: 'scheduled' },
    ],
    '2026-05-08': [
      { id: 's7', title: 'AI automation failures', time: '21:00', type: 'Post', status: 'scheduled' },
    ],
  }
};
