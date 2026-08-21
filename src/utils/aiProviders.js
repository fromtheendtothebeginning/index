// aiProviders.js — AI 提供商注册表
// 模仿 AI SDK / opencode 的 provider 配置格式（id / baseURL / models）。
// 与后端 backend/aisettings.py 的 PROVIDERS 保持同步。

export const PROVIDERS = [
  {
    id: 'opencode-go',
    label: 'OpenCode Go',
    desc: 'opencode.ai 聚合订阅',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    docs: 'https://opencode.ai/docs/go/',
    models: [
      'deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-vision-exp',
      'glm-5.3', 'glm-5.2', 'glm-5.1',
      'kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6',
      'mimo-v2.5', 'mimo-v2.5-pro',
      'qwen3.8-max', 'qwen3.7-max', 'qwen3.7-plus', 'qwen3.6-plus',
      'grok-4.5', 'gpt-5.6-luna', 'muse-spark-1.2-contributor',
      'minimax-m3', 'minimax-m2.7',
      'hy3', 'ox-alpha-free',
    ],
    defaultModel: 'deepseek-v4-flash',
    thinking: true,
    thinkingLevels: [
      { value: 'off', label: 'Off' },
      { value: 'low', label: 'Low' },
      { value: 'high', label: 'High' },
      { value: 'max', label: 'Max' },
    ],
    modelThinkingLevels: {
      'minimax-': [
        { value: 'off', label: 'Off' },
        { value: 'high', label: 'On' },
      ],
      'qwen3.8-max': [
        { value: 'off', label: 'Off' },
        { value: 'high', label: 'On' },
      ],
      'qwen3.7-': [
        { value: 'off', label: 'Off' },
        { value: 'high', label: 'On' },
      ],
      'qwen3.6-plus': [
        { value: 'off', label: 'Off' },
        { value: 'high', label: 'On' },
      ],
      'grok-': [
        { value: 'minimal', label: 'Minimal' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ],
      'gpt-5.6-luna': [
        { value: 'minimal', label: 'Minimal' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ],
      'muse-spark-': [
        { value: 'minimal', label: 'Minimal' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ],
    },
    topk: false,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    desc: '深度求索官方',
    baseUrl: 'https://api.deepseek.com',
    docs: 'https://platform.deepseek.com/api_keys',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-vision-exp'],
    defaultModel: 'deepseek-v4-flash',
    thinking: true,
    thinkingLevels: [
      { value: 'off', label: 'Off' },
      { value: 'low', label: 'Low' },
      { value: 'high', label: 'High' },
      { value: 'max', label: 'Max' },
    ],
    topk: false,
  },
  {
    id: 'kimi',
    label: 'Kimi',
    desc: '月之暗面',
    baseUrl: 'https://api.moonshot.cn/v1',
    docs: 'https://platform.moonshot.cn/console/api-keys',
    models: ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k2.6', 'kimi-k2.5'],
    defaultModel: 'kimi-k3',
    thinking: true,
    thinkingLevels: [
      { value: 'off', label: 'Off' },
      { value: 'low', label: 'Low' },
      { value: 'high', label: 'High' },
      { value: 'max', label: 'Max' },
    ],
    topk: false,
  },
  {
    id: 'glm',
    label: 'GLM',
    desc: '智谱 AI',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    docs: 'https://open.bigmodel.cn/usercenter/apikeys',
    models: ['glm-5.3', 'glm-5.2', 'glm-5.1', 'glm-4.7', 'glm-4.7-flash', 'glm-4.6', 'glm-4.5-air'],
    defaultModel: 'glm-4.6',
    thinking: true,
    thinkingLevels: [
      { value: 'off', label: 'Off' },
      { value: 'high', label: 'On' },
    ],
    topk: false,
  },
  {
    id: 'qwen',
    label: 'Qwen',
    desc: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    docs: 'https://bailian.console.aliyun.com/?apiKey=1',
    models: ['qwen3.8-max', 'qwen3.7-max', 'qwen3.7-plus', 'qwen3.6-plus', 'qwen-max', 'qwen-plus', 'qwen-turbo'],
    defaultModel: 'qwen-max',
    thinking: true,
    thinkingLevels: [
      { value: 'off', label: 'Off' },
      { value: 'high', label: 'On' },
    ],
    topk: false,
  },
  {
    id: 'claude',
    label: 'Claude',
    desc: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    docs: 'https://console.anthropic.com/settings/keys',
    models: ['claude-opus-5', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    defaultModel: 'claude-sonnet-5',
    thinking: true,
    thinkingLevels: [
      { value: 'off', label: 'Off' },
      { value: 'high', label: 'On' },
    ],
    sampling: false,
    topk: false,
  },
  {
    id: 'gpt',
    label: 'GPT',
    desc: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    docs: 'https://platform.openai.com/api-keys',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o'],
    defaultModel: 'gpt-5-mini',
    thinking: true,
    thinkingLevels: [
      { value: 'minimal', label: 'Minimal' },
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ],
    topk: false,
  },
  {
    id: 'gemini',
    label: 'Gemini',
    desc: 'Google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    docs: 'https://aistudio.google.com/app/apikey',
    models: ['gemini-3.7-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'],
    defaultModel: 'gemini-2.5-flash',
    thinking: true,
    thinkingLevels: [
      { value: 'off', label: 'Off' },
      { value: 'high', label: 'On' },
    ],
    topk: false,
  },
  {
    id: 'custom',
    label: '自定义',
    desc: '任意 OpenAI 兼容服务',
    baseUrl: '',
    docs: '',
    models: [],
    defaultModel: '',
    thinking: true,
    thinkingLevels: [
      { value: 'off', label: 'Off' },
      { value: 'low', label: 'Low' },
      { value: 'high', label: 'High' },
      { value: 'max', label: 'Max' },
    ],
    topk: false,
  },
]

// 默认参数（新用户 / 切换提供商未选模型时）
export const AI_DEFAULTS = {
  model: '',
  thinkingLevel: 'medium',
  temperature: 0.7,
  topK: 40,
}

// 按提供商（+可选模型）返回思考深度选项（各厂商/模型文档差异化）
export function getThinkingLevels(providerId, model) {
  const p = getProvider(providerId)
  if (p && model) {
    const mapping = p.modelThinkingLevels || {}
    for (const prefix of Object.keys(mapping)) {
      if (model.startsWith(prefix)) return mapping[prefix]
    }
  }
  return (p && p.thinkingLevels) || [
    { value: 'off', label: 'Off' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'max', label: 'Max' },
  ]
}

// 判断某个档位是否在指定提供商/模型的可选范围内
export function isValidThinkingLevel(providerId, level, model) {
  return getThinkingLevels(providerId, model).some(t => t.value === level)
}

export function getProvider(id) {
  return PROVIDERS.find(p => p.id === id) || null
}
