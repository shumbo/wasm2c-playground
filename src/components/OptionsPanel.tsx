import type { FeatureInfo, Wasm2cOptions } from '../core/types';
import { DEFAULT_OPTIONS, MAX_OUTPUTS } from '../core/types';

interface OptionsPanelProps {
  options: Wasm2cOptions;
  features: FeatureInfo[];
  onChange(next: Wasm2cOptions): void;
}

export function OptionsPanel({ options, features, onChange }: OptionsPanelProps) {
  const set = <K extends keyof Wasm2cOptions>(key: K, value: Wasm2cOptions[K]) =>
    onChange({ ...options, [key]: value });

  const toggleFeature = (flag: string, enabled: boolean) => {
    const next = enabled
      ? [...options.features, flag]
      : options.features.filter((value) => value !== flag);
    set('features', next);
  };

  const enableable = features.filter((feature) => feature.canEnable);
  const unavailable = features.filter((feature) => !feature.canEnable);

  return (
    <div className="options">
      <div className="options__row">
        <label className="field">
          <span className="field__label">Module name</span>
          <input
            className="field__input"
            type="text"
            value={options.moduleName}
            spellCheck={false}
            placeholder="module"
            onChange={(event) => set('moduleName', event.target.value)}
          />
          <span className="field__hint">
            Prefixes every generated symbol, as <code>wasm2c -n</code> does.
          </span>
        </label>

        <label className="field field--narrow">
          <span className="field__label">Output files</span>
          <input
            className="field__input"
            type="number"
            min={1}
            max={MAX_OUTPUTS}
            value={options.numOutputs}
            onChange={(event) => {
              const value = Number(event.target.value);
              set('numOutputs', Number.isFinite(value) ? Math.min(Math.max(value, 1), MAX_OUTPUTS) : 1);
            }}
          />
          <span className="field__hint">
            More than one splits the functions and adds <code>-impl.h</code>.
          </span>
        </label>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={options.debugNames}
          onChange={(event) => set('debugNames', event.target.checked)}
        />
        <span>
          <span className="check__label">Keep debug names</span>
          <span className="check__hint">
            Writes a names section so parameters and locals keep their WAT names
            in the C.
          </span>
        </span>
      </label>

      <div className="options__section">
        <div className="options__heading">
          <span>Features</span>
          <button
            type="button"
            className="link-button"
            onClick={() => set('features', DEFAULT_OPTIONS.features)}
            disabled={sameSet(options.features, DEFAULT_OPTIONS.features)}
          >
            Reset to wabt defaults
          </button>
        </div>
        <div className="feature-grid">
          {enableable.map((feature) => (
            <label className="check check--compact" key={feature.flag} title={feature.help}>
              <input
                type="checkbox"
                checked={options.features.includes(feature.flag)}
                onChange={(event) => toggleFeature(feature.flag, event.target.checked)}
              />
              <span className="check__label">{feature.flag}</span>
            </label>
          ))}
        </div>
        {unavailable.length > 0 && (
          <p className="options__note">
            Not available in wasm2c: {unavailable.map((f) => f.flag).join(', ')}.
          </p>
        )}
      </div>
    </div>
  );
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}
