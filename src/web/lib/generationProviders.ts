export interface ModelOption {
  id:          string;
  label:       string;
  description: string;
}

export interface ImageProviderDef {
  id:        string;
  name:      string;
  icon:      string;
  keyName:   string;
  models:    ModelOption[];
  docsUrl:   string;
  docsLabel: string;
  note?:     string;
  logoRank:  number; // 1 = best for logos
}

// Ordered by logo/brand generation quality (logoRank 1 = best)
export const IMAGE_PROVIDER_DEFS: ImageProviderDef[] = [
  {
    id: 'fal', name: 'fal.ai (Ideogram / Flux)', icon: '⚡',
    keyName: 'FAL_API_KEY', logoRank: 1,
    models: [
      { id: 'fal-ai/ideogram/v2',       label: 'Ideogram v2',       description: 'Best for logos — precise text, clean graphics' },
      { id: 'fal-ai/ideogram/v2/turbo', label: 'Ideogram v2 Turbo', description: 'Faster Ideogram' },
      { id: 'fal-ai/flux/pro',          label: 'Flux 1.1 Pro',      description: 'Excellent quality/cost ratio' },
      { id: 'fal-ai/flux/schnell',      label: 'Flux Schnell',      description: 'Very fast · ~$0.003/image' },
    ],
    docsUrl: 'https://fal.ai/dashboard/keys', docsLabel: 'fal.ai Dashboard →',
    note: 'One key unlocks Ideogram + Flux + Kling video',
  },
  {
    id: 'openai', name: 'OpenAI DALL-E', icon: '🟢',
    keyName: 'LLM_API_KEY', logoRank: 2,
    models: [
      { id: 'dall-e-3', label: 'DALL-E 3', description: 'Strong composition, reliable text · ~$0.04/image' },
      { id: 'dall-e-2', label: 'DALL-E 2', description: 'Faster, cheaper · ~$0.02/image' },
    ],
    docsUrl: 'https://platform.openai.com/api-keys', docsLabel: 'OpenAI API Keys →',
    note: 'Uses your existing LLM_API_KEY',
  },
  {
    id: 'google', name: 'Google Gemini (Image)', icon: '🔵',
    keyName: 'GOOGLE_AI_API_KEY', logoRank: 3,
    models: [
      { id: 'gemini-2.0-flash-preview-image-generation', label: 'Gemini 2.0 Flash (Image)', description: 'AI Studio key · free tier · fast' },
      { id: 'gemini-2.0-flash-exp',                      label: 'Gemini 2.0 Flash Exp',     description: 'Experimental · higher quality' },
    ],
    docsUrl: 'https://aistudio.google.com/app/apikey', docsLabel: 'Google AI Studio →',
    note: 'Uses your Google AI Studio key — works with free tier',
  },
  {
    id: 'stability', name: 'Stability AI', icon: '🎨',
    keyName: 'STABILITY_API_KEY', logoRank: 4,
    models: [
      { id: 'stable-diffusion-3-5-large', label: 'SD 3.5 Large', description: 'Best quality · 8B model' },
      { id: 'stable-diffusion-3-medium',  label: 'SD 3 Medium',  description: 'Balanced quality/speed' },
    ],
    docsUrl: 'https://platform.stability.ai/account/keys', docsLabel: 'Stability AI Keys →',
  },
  {
    id: 'replicate', name: 'Replicate', icon: '🔄',
    keyName: 'REPLICATE_API_TOKEN', logoRank: 5,
    models: [
      { id: 'black-forest-labs/flux-1.1-pro', label: 'Flux 1.1 Pro', description: 'Via Replicate · pay per run' },
      { id: 'ideogram-ai/ideogram-v2',        label: 'Ideogram v2',  description: 'Text-heavy designs' },
    ],
    docsUrl: 'https://replicate.com/account/api-tokens', docsLabel: 'Replicate Tokens →',
  },
];
