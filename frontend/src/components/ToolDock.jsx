import {
  Eye,
  EyeOff,
  Sun,
  Radio,
  Compass,
  Layers,
  Sliders,
  Gauge
} from 'lucide-react';

const ToolDock = ({
  activeTool,
  onToolChange,
  showSolarFlux,
  onShowSolarFluxChange,
  showDTELink,
  onShowDTELinkChange,
  showGrid,
  onShowGridChange,
  showHorizonMask,
  onShowHorizonMaskChange,
  showInterface,
  onToggleInterface,
  cameraSensitivity,
  onCameraSensitivityChange
}) => {
  const tools = [
    { icon: Sun, label: 'Solar Lighting', id: 'solar-lighting', active: showSolarFlux },
    { icon: Radio, label: 'RF Line-of-Sight', id: 'rf-los', active: showDTELink },
    { icon: Compass, label: 'Azimuth Grid', id: 'azimuth-grid', active: showGrid },
    { icon: Layers, label: 'Topography Layer', id: 'topography-layer', active: showHorizonMask },
    { icon: Sliders, label: 'Canvas Settings', id: 'canvas-settings' },
    { icon: Gauge, label: 'Sensitivity', id: 'sensitivity' },
    { icon: showInterface ? Eye : EyeOff, label: showInterface ? 'Hide interface' : 'Show interface', id: 'interface-toggle', active: showInterface }
  ];

  const handleToolClick = (toolId) => {
    onToolChange(toolId);

    switch (toolId) {
      case 'solar-lighting':
        onShowSolarFluxChange(!showSolarFlux);
        break;
      case 'interface-toggle':
        onToggleInterface();
        break;
      case 'sensitivity':
        onToolChange(activeTool === 'sensitivity' ? 'view-modes' : toolId);
        break;
      case 'rf-los':
        onShowDTELinkChange(!showDTELink);
        break;
      case 'azimuth-grid':
        onShowGridChange(!showGrid);
        break;
      case 'topography-layer':
        onShowHorizonMaskChange(!showHorizonMask);
        break;
      case 'canvas-settings':
        onToolChange(activeTool === 'canvas-settings' ? 'view-modes' : toolId);
        break;
      default:
        break;
    }
  };

  const handleToggleSetting = (setting) => {
    switch (setting) {
      case 'solar-flux':
        onShowSolarFluxChange(!showSolarFlux);
        break;
      case 'dte-link':
        onShowDTELinkChange(!showDTELink);
        break;
      case 'grid':
        onShowGridChange(!showGrid);
        break;
      case 'horizon-mask':
        onShowHorizonMaskChange(!showHorizonMask);
        break;
      default:
        break;
    }
  };

  return (
    <div className="tool-dock">
      <div className="tool-dock-actions" aria-label="Scene tools">
        {tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            onClick={() => handleToolClick(tool.id)}
            className={`tool-dock-button${activeTool === tool.id ? ' is-active' : ''}`}
            aria-label={tool.label}
            aria-pressed={tool.active ?? activeTool === tool.id}
            title={tool.label}
          >
            <tool.icon aria-hidden="true" />
            {tool.active && (
              <span className="tool-dock-indicator" aria-hidden="true" />
            )}
          </button>
        ))}
      </div>

      {activeTool === 'canvas-settings' && (
        <div className="tool-dock-settings" aria-label="Canvas settings">
          <div className="tool-dock-settings-header">
            <h3>Canvas Settings</h3>
            <button
              type="button"
              className="tool-dock-close"
              onClick={() => onToolChange('view-modes')}
              aria-label="Close canvas settings"
            >
              ×
            </button>
          </div>

          <div className="tool-dock-settings-list">
            <div className="tool-dock-setting">
              <span>Solar Illumination</span>
              <button
                type="button"
                onClick={() => handleToggleSetting('solar-flux')}
                className={`tool-dock-toggle${showSolarFlux ? ' is-on' : ''}`}
                aria-pressed={showSolarFlux}
              >
                {showSolarFlux ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className="tool-dock-setting">
              <span>RF Line-of-Sight</span>
              <button
                type="button"
                onClick={() => handleToggleSetting('dte-link')}
                className={`tool-dock-toggle${showDTELink ? ' is-on' : ''}`}
                aria-pressed={showDTELink}
              >
                {showDTELink ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className="tool-dock-setting">
              <span>Azimuth Grid</span>
              <button
                type="button"
                onClick={() => handleToggleSetting('grid')}
                className={`tool-dock-toggle${showGrid ? ' is-on' : ''}`}
                aria-pressed={showGrid}
              >
                {showGrid ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className="tool-dock-setting">
              <span>Topography Layer</span>
              <button
                type="button"
                onClick={() => handleToggleSetting('horizon-mask')}
                className={`tool-dock-toggle${showHorizonMask ? ' is-on' : ''}`}
                aria-pressed={showHorizonMask}
              >
                {showHorizonMask ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
        </div>
      )}
      {activeTool === 'sensitivity' && (
        <div className="tool-dock-settings sensitivity-settings" aria-label="Camera sensitivity">
          <div className="tool-dock-settings-header">
            <h3>Sensitivity</h3>
            <button type="button" className="tool-dock-close" onClick={() => onToolChange('view-modes')} aria-label="Close sensitivity settings">×</button>
          </div>
          <label className="sensitivity-control">
            <span>{cameraSensitivity.toFixed(1)}× speed / ramp</span>
            <input
              type="range"
              min="0.5"
              max="2.5"
              step="0.1"
              value={cameraSensitivity}
              onChange={(event) => onCameraSensitivityChange(Number(event.target.value))}
              aria-label="Camera movement sensitivity"
            />
          </label>
        </div>
      )}
    </div>
  );
};

export default ToolDock;