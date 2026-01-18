import React, { useState, useCallback, useMemo } from 'react';
import { AgentWidget, type CartSnapshot, type ProductSelectedPayload } from '../widget';
import { loadDemoConfig, saveDemoConfig, type DemoConfig } from './config';
import { fetchDemoToken, clearCachedToken } from './tokenClient';

export const DemoPage: React.FC = () => {
  const [config, setConfig] = useState<DemoConfig>(loadDemoConfig);
  const [widgetKey, setWidgetKey] = useState(0);
  const [isWidgetEnabled, setIsWidgetEnabled] = useState(false);
  const [currentCart, setCurrentCart] = useState<{ cartId: string; itemCount?: number } | null>(null);
  const [lastSelectedProduct, setLastSelectedProduct] = useState<{ productId: string; title: string } | null>(null);

  const handleConfigChange = useCallback(
    (field: keyof DemoConfig, value: string) => {
      setConfig((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const handleSave = useCallback(() => {
    saveDemoConfig(config);
    clearCachedToken();
    setWidgetKey((k) => k + 1);
    if (config.endpoint && config.applicationId) {
      setIsWidgetEnabled(true);
    }
  }, [config]);

  const getContext = useCallback(() => {
    return {
      cultureCode: config.cultureCode,
      currencyCode: config.currencyCode,
      page: 'demo',
      timestamp: new Date().toISOString(),
    };
  }, [config.cultureCode, config.currencyCode]);

  const getAuthToken = useCallback(async () => {
    return fetchDemoToken(config.endpoint, config.applicationId, config.demoKey || undefined);
  }, [config.endpoint, config.applicationId, config.demoKey]);

  const isConfigValid = useMemo(() => {
    return config.endpoint.trim() !== '' && config.applicationId.trim() !== '';
  }, [config.endpoint, config.applicationId]);

  const handleCartChanged = useCallback((cart: CartSnapshot) => {
    setCurrentCart({ cartId: cart.cartId, itemCount: cart.itemCount });
  }, []);

  const handleProductSelected = useCallback((payload: ProductSelectedPayload) => {
    setLastSelectedProduct({ productId: payload.productId, title: payload.title });
    console.log('Navigate to PDP for', payload);
  }, []);

  return (
    <div className="demo-page">
      <header className="demo-header">
        <h1>Commerce Shop Agent Demo</h1>
        <p>Partner-friendly playground for testing the AgentWidget</p>
      </header>

      <main className="demo-content">
        <div className="demo-config-panel">
          <h2>Configuration</h2>

          <div className="demo-instructions-box">
            <h3>How to run:</h3>
            <ol>
              <li>Start the Agent BFF server</li>
              <li>Start this widget dev server (<code>npm run dev</code>)</li>
              <li>Fill in the endpoint and applicationId below</li>
              <li>Click "Save &amp; Open Widget"</li>
              <li>Use the chat button in the bottom-right corner</li>
            </ol>
          </div>

          <div className="demo-config-form">
            <div className="demo-config-field">
              <label htmlFor="endpoint">Endpoint URL</label>
              <input
                id="endpoint"
                type="text"
                value={config.endpoint}
                onChange={(e) => handleConfigChange('endpoint', e.target.value)}
                placeholder="https://your-bff.example.com"
              />
              <span className="demo-config-hint">
                Base URL of your Agent BFF (e.g., https://api.example.com)
              </span>
            </div>

            <div className="demo-config-field">
              <label htmlFor="applicationId">Application ID</label>
              <input
                id="applicationId"
                type="text"
                value={config.applicationId}
                onChange={(e) =>
                  handleConfigChange('applicationId', e.target.value)
                }
                placeholder="your-app-id"
              />
              <span className="demo-config-hint">
                Your application identifier from the BFF configuration
              </span>
            </div>

            <div className="demo-config-row">
              <div className="demo-config-field">
                <label htmlFor="cultureCode">Culture Code</label>
                <input
                  id="cultureCode"
                  type="text"
                  value={config.cultureCode}
                  onChange={(e) =>
                    handleConfigChange('cultureCode', e.target.value)
                  }
                  placeholder="en-US"
                />
              </div>

              <div className="demo-config-field">
                <label htmlFor="currencyCode">Currency Code</label>
                <input
                  id="currencyCode"
                  type="text"
                  value={config.currencyCode}
                  onChange={(e) =>
                    handleConfigChange('currencyCode', e.target.value)
                  }
                  placeholder="USD"
                />
              </div>
            </div>

            <div className="demo-config-field">
              <label htmlFor="uiLanguage">UI Language (optional)</label>
              <input
                id="uiLanguage"
                type="text"
                value={config.uiLanguage}
                onChange={(e) =>
                  handleConfigChange('uiLanguage', e.target.value)
                }
                placeholder="sv or en"
              />
              <span className="demo-config-hint">
                Override the widget UI language. Supported: "sv" (Swedish), "en" (English). 
                If empty, language is derived from Culture Code.
              </span>
            </div>

            <div className="demo-config-field">
              <label htmlFor="demoKey">Demo Key (optional)</label>
              <input
                id="demoKey"
                type="text"
                value={config.demoKey}
                onChange={(e) => handleConfigChange('demoKey', e.target.value)}
                placeholder="Optional X-Demo-Key header value"
              />
              <span className="demo-config-hint">
                If your BFF requires an X-Demo-Key header for token requests
              </span>
            </div>

            <div className="demo-config-field">
              <label htmlFor="imageBaseUrl">Image Base URL (optional)</label>
              <input
                id="imageBaseUrl"
                type="text"
                value={config.imageBaseUrl}
                onChange={(e) =>
                  handleConfigChange('imageBaseUrl', e.target.value)
                }
                placeholder="https://media.cdn-norce.tech/{applicationId}/"
              />
              <span className="demo-config-hint">
                Base URL for product images. Relative image URLs will be resolved against this.
              </span>
            </div>

            <button
              className="demo-config-save-btn"
              onClick={handleSave}
              disabled={!isConfigValid}
            >
              Save &amp; Open Widget
            </button>

            {!isConfigValid && (
              <p className="demo-config-warning">
                Please fill in both Endpoint URL and Application ID
              </p>
            )}

            {isWidgetEnabled && (
              <div className="demo-cart-status">
                <h3>Cart Status</h3>
                <p>
                  <strong>Cart ID:</strong>{' '}
                  {currentCart?.cartId ?? 'None'}
                </p>
                {currentCart?.itemCount !== undefined && (
                  <p>
                    <strong>Items:</strong> {currentCart.itemCount}
                  </p>
                )}
              </div>
            )}

            {isWidgetEnabled && (
              <div className="demo-cart-status">
                <h3>Product Selection</h3>
                <p>
                  <strong>Last selected productId:</strong>{' '}
                  {lastSelectedProduct?.productId ?? 'None'}
                </p>
                {lastSelectedProduct?.title && (
                  <p>
                    <strong>Title:</strong> {lastSelectedProduct.title}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="demo-footer">
        <p>Powered by Vite + React + TypeScript</p>
      </footer>

      {isWidgetEnabled && isConfigValid && (
        <AgentWidget
          key={widgetKey}
          endpoint={config.endpoint}
          applicationId={config.applicationId}
          getContext={getContext}
          getAuthToken={getAuthToken}
          title="Shop Assistant"
          imageBaseUrl={config.imageBaseUrl || undefined}
          cultureCode={config.cultureCode || undefined}
          uiLanguage={config.uiLanguage || undefined}
          onCartChanged={handleCartChanged}
          onProductSelected={handleProductSelected}
        />
      )}
    </div>
  );
};
