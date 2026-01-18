const STORAGE_KEY = 'agentWidget.demoConfig';

export interface DemoConfig {
  endpoint: string;
  applicationId: string;
  cultureCode: string;
  currencyCode: string;
  uiLanguage: string;
  demoKey: string;
  imageBaseUrl: string;
}

const DEFAULT_CONFIG: DemoConfig = {
  endpoint: '',
  applicationId: '',
  cultureCode: 'en-US',
  currencyCode: 'USD',
  uiLanguage: '',
  demoKey: '',
  imageBaseUrl: '',
};

export function loadDemoConfig(): DemoConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<DemoConfig>;
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch {
    console.warn('Failed to load demo config from localStorage');
  }
  return { ...DEFAULT_CONFIG };
}

export function saveDemoConfig(config: DemoConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    console.warn('Failed to save demo config to localStorage');
  }
}
