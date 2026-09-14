import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Diagnostic } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';

import { Wasm2cClient } from './core/client';
import {
  DEFAULT_OPTIONS,
  type ConvertResult,
  type ConvertSuccess,
  type FeatureInfo,
  type Wasm2cOptions,
} from './core/types';
import wabtVersion from './core/wabt-version.json';

import { CodeViewer, type FollowRequest, type JumpTarget } from './components/CodeViewer';
import { OptionsPanel } from './components/OptionsPanel';
import { Popover } from './components/Popover';
import { SplitPane } from './components/SplitPane';
import { WatEditor } from './components/WatEditor';
import { Book, Check, ChevronDown, Copy, Download, Focus, Link, Moon, Sliders, Sun, Warning } from './components/icons';

import { DEFAULT_EXAMPLE, EXAMPLES } from './examples';
import { firstErrorMessage, parseDiagnostics } from './lib/diagnostics';
import { downloadBytes, downloadText } from './lib/download';
import { countBoilerplateLines } from './core/boilerplate';
import { runtimeFilesFor } from './core/runtime';
import { buildSymbolIndex } from './core/symbols';
import type { LineRange } from './core/types';
import { countLines, formatBytes, formatDuration } from './lib/format';
import { loadDraft, saveDraft } from './lib/persist';
import { decodeState, encodeState } from './lib/share';
import { applyTheme, readTheme, type ThemeChoice } from './lib/theme';

const CONVERT_DEBOUNCE_MS = 250;
const DRAFT_SAVE_DEBOUNCE_MS = 500;
const FOLLOW_MISS_MS = 2200;

const MODIFIER_LABEL =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? '\u2318'
    : 'Ctrl';

interface Tab {
  name: string;
  text: string;
  boilerplate: LineRange[];
  kind: 'generated' | 'runtime';
  summary?: string;
}
const FOCUS_KEY = 'wasm2c-playground:focus';

function readFocusPreference(): boolean {
  try {
    return localStorage.getItem(FOCUS_KEY) !== 'false';
  } catch {
    return true;
  }
}

type Status =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'fatal'; message: string };

export default function App() {
  // A shared link outranks the saved draft, but it decodes asynchronously, so
  // only seed from storage when there is no fragment to wait for. Otherwise
  // the draft would flash on screen before the shared module replaced it.
  const [initialDraft] = useState(() =>
    window.location.hash.length > 1 ? null : loadDraft(),
  );
  const [wat, setWat] = useState(() => initialDraft?.wat ?? DEFAULT_EXAMPLE.wat);
  const [options, setOptions] = useState<Wasm2cOptions>(
    () => initialDraft?.options ?? DEFAULT_OPTIONS,
  );
  const [features, setFeatures] = useState<FeatureInfo[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [result, setResult] = useState<ConvertResult | null>(null);
  // Kept so a transient error mid-edit doesn't blank out the C you were
  // reading; the pane dims it and says it's stale instead.
  const [lastGood, setLastGood] = useState<ConvertSuccess | null>(null);
  const [converting, setConverting] = useState(false);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [jumpTo, setJumpTo] = useState<JumpTarget | null>(null);
  const [followMiss, setFollowMiss] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  // Almost every line wasm2c emits is fixed runtime scaffolding, so the
  // module's own code is the useful default view.
  const [focusModule, setFocusModule] = useState(readFocusPreference);

  const client = useRef<Wasm2cClient | null>(null);
  // Guards against an older conversion landing after a newer one.
  const generation = useRef(0);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(FOCUS_KEY, String(focusModule));
    } catch {
      // Private browsing; the preference just won't persist.
    }
  }, [focusModule]);

  // Restore a shared link before the first conversion runs, so the URL wins
  // over the default example and the saved draft.
  const [restored, setRestored] = useState(false);

  const applyFragment = useCallback(async (fragment: string) => {
    const state = await decodeState(fragment);
    if (state) {
      setWat(state.wat);
      setOptions(state.options);
    }
  }, []);

  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    if (!fragment) {
      setRestored(true);
      return;
    }
    let cancelled = false;
    applyFragment(fragment).finally(() => {
      if (!cancelled) {
        setRestored(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [applyFragment]);

  // Pasting a share link into an already-open tab only changes the fragment,
  // which is a same-document navigation -- nothing remounts, so the link has
  // to be picked up here.
  useEffect(() => {
    const onHashChange = () => {
      const fragment = window.location.hash.slice(1);
      if (fragment) {
        void applyFragment(fragment);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [applyFragment]);

  useEffect(() => {
    const instance = new Wasm2cClient();
    client.current = instance;
    instance
      .init()
      .then((list) => {
        setFeatures(list);
        setStatus({ kind: 'ready' });
      })
      .catch((error: Error) => {
        setStatus({ kind: 'fatal', message: error.message });
      });
    return () => {
      instance.dispose();
      client.current = null;
    };
  }, []);

  // Gated on `restored` so the default example can't overwrite the saved
  // draft in the moment before a shared fragment finishes decoding.
  useEffect(() => {
    if (!restored) {
      return;
    }
    const timer = setTimeout(
      () => saveDraft({ wat, options }),
      DRAFT_SAVE_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [wat, options, restored]);

  useEffect(() => {
    if (status.kind !== 'ready' || !restored) {
      return;
    }
    const instance = client.current;
    if (!instance) {
      return;
    }
    const id = ++generation.current;
    setConverting(true);
    const timer = setTimeout(() => {
      instance
        .convert(wat, options)
        .then((next) => {
          if (generation.current === id) {
            setResult(next);
            if (next.ok) {
              setLastGood(next);
            }
            setConverting(false);
          }
        })
        .catch((error: Error) => {
          if (generation.current === id) {
            setStatus({ kind: 'fatal', message: error.message });
            setConverting(false);
          }
        });
    }, CONVERT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [wat, options, status.kind, restored]);

  const shown = result?.ok ? result : lastGood;
  const stale = Boolean(result && !result.ok && lastGood);
  const generated = shown?.files ?? [];

  // wabt's runtime sources sit alongside the generated files: wasm2c writes
  // code against this interface but never emits it, so without them the C
  // refers to types that are defined nowhere you can look.
  const runtime = useMemo(() => runtimeFilesFor(options.features), [options.features]);

  const tabs: Tab[] = useMemo(
    () => [
      ...generated.map((file) => ({ ...file, kind: 'generated' as const })),
      ...runtime.map((file) => ({
        name: file.name,
        text: file.text,
        boilerplate: [] as LineRange[],
        kind: 'runtime' as const,
        summary: file.summary,
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, runtime],
  );

  // Tracked by name rather than index so renaming the module (module.c ->
  // demo.c) falls back to the first generated file instead of holding an
  // index that now points at something else.
  const current =
    (activeName ? tabs.find((tab) => tab.name === activeName) : undefined) ??
    tabs.find((tab) => tab.kind === 'generated');
  const hiddenLines = current ? countBoilerplateLines(current.boilerplate) : 0;

  // The runtime is fixed, so index it once; only the generated files change as
  // you type, and their symbols take precedence over the runtime's.
  const runtimeIndex = useMemo(
    () => buildSymbolIndex(runtime.map((f) => ({ name: f.name, text: f.text }))),
    [runtime],
  );
  const generatedIndex = useMemo(() => buildSymbolIndex(generated), [shown]);

  const openTab = useCallback((name: string) => {
    setActiveName(name);
    setJumpTo(null);
  }, []);

  const handleFollow = useCallback(
    (request: FollowRequest) => {
      if (request.kind === 'include') {
        if (tabs.some((tab) => tab.name === request.value)) {
          openTab(request.value);
        } else {
          setFollowMiss(request.value);
        }
        return;
      }
      const hit = generatedIndex.get(request.value) ?? runtimeIndex.get(request.value);
      if (!hit) {
        setFollowMiss(request.value);
        return;
      }
      setActiveName(hit.file);
      // The nonce lets the same line be revisited; the line alone would not
      // change and the reveal would not re-run.
      setJumpTo({ line: hit.line, nonce: Date.now() });
    },
    [tabs, generatedIndex, runtimeIndex, openTab],
  );

  useEffect(() => {
    if (!followMiss) {
      return;
    }
    const timer = setTimeout(() => setFollowMiss(null), FOLLOW_MISS_MS);
    return () => clearTimeout(timer);
  }, [followMiss]);

  const diagnostics: Diagnostic[] = useMemo(() => {
    if (!result || result.ok) {
      return [];
    }
    return parseDiagnostics(result.error, EditorState.create({ doc: wat }).doc);
  }, [result, wat]);

  const loadExample = useCallback((id: string) => {
    const example = EXAMPLES.find((item) => item.id === id);
    if (example) {
      setWat(example.wat);
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M3 4h18v3.2H3zM3 10.4h11.5v3.2H3zM3 16.8h18V20H3z"
                fill="currentColor"
                opacity="0.9"
              />
            </svg>
          </span>
          <span className="brand__text">
            <strong>wasm2c</strong> playground
          </span>
        </div>

        <div className="topbar__spacer" />

        <Popover
          align="left"
          title="Examples"
          label={
            <>
              <Book />
              <span>Examples</span>
              <ChevronDown />
            </>
          }
        >
          {(close) => (
            <ul className="menu">
              {EXAMPLES.map((example) => (
                <li key={example.id}>
                  <button
                    type="button"
                    className="menu__item"
                    onClick={() => {
                      loadExample(example.id);
                      close();
                    }}
                  >
                    <span className="menu__title">{example.title}</span>
                    <span className="menu__description">{example.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Popover>

        <Popover
          title="wasm2c options"
          label={
            <>
              <Sliders />
              <span>Options</span>
              <ChevronDown />
            </>
          }
          badge={optionsBadge(options)}
        >
          {() => (
            <OptionsPanel options={options} features={features} onChange={setOptions} />
          )}
        </Popover>

        <ShareButton wat={wat} options={options} />

        <button
          type="button"
          className="button button--icon"
          title={`Theme: ${theme}`}
          aria-label={`Theme: ${theme}. Click to change.`}
          onClick={() =>
            setTheme((value) =>
              value === 'system' ? 'light' : value === 'light' ? 'dark' : 'system',
            )
          }
        >
          {theme === 'dark' ? <Moon /> : theme === 'light' ? <Sun /> : <Sun />}
          {theme === 'system' && <span className="button__dot" aria-hidden="true" />}
        </button>
      </header>

      {status.kind === 'fatal' ? (
        <div className="fatal">
          <Warning />
          <div>
            <h2>Couldn't start wasm2c</h2>
            <p>{status.message}</p>
            <p className="fatal__hint">
              The playground needs WebAssembly and module workers. Reloading the
              page usually clears a transient failure.
            </p>
          </div>
        </div>
      ) : (
        <SplitPane
          storageKey="wasm2c-playground:split"
          left={
            <section className="pane">
              <div className="pane__header">
                <h2 className="pane__title">{options.moduleName || 'module'}.wat</h2>
                <span className="pane__meta">
                  {countLines(wat)} lines · {formatBytes(new Blob([wat]).size)}
                </span>
              </div>
              <WatEditor value={wat} diagnostics={diagnostics} onChange={setWat} />
            </section>
          }
          right={
            <section className="pane">
              <div className="pane__header pane__header--tabs">
                <div className="tabs" role="tablist" aria-label="Output files">
                  {tabs.map((tab, index) => (
                    <Fragment key={tab.name}>
                      {tab.kind === 'runtime' &&
                        tabs[index - 1]?.kind === 'generated' && (
                          <span className="tabs__divider" aria-hidden="true" />
                        )}
                      <button
                        type="button"
                        role="tab"
                        aria-selected={tab.name === current?.name}
                        title={tab.summary}
                        className={`tab tab--${tab.kind}${
                          tab.name === current?.name ? ' tab--active' : ''
                        }`}
                        onClick={() => openTab(tab.name)}
                      >
                        {tab.name}
                      </button>
                    </Fragment>
                  ))}
                  {tabs.length === 0 && <span className="tab tab--placeholder">output</span>}
                </div>
                <div className="pane__actions">
                  {followMiss ? (
                    <span className="pane__miss" role="status">
                      no definition for <code>{followMiss}</code>
                    </span>
                  ) : (
                    <span className="pane__hint">{MODIFIER_LABEL}-click to jump</span>
                  )}
                  {stale && <span className="pane__stale">stale</span>}
                  <button
                    type="button"
                    className={`button button--icon${focusModule ? ' button--active' : ''}`}
                    aria-pressed={focusModule}
                    title={
                      hiddenLines > 0
                        ? `${focusModule ? 'Show' : 'Hide'} ${hiddenLines} lines of wasm2c scaffolding`
                        : 'Hide wasm2c scaffolding'
                    }
                    aria-label="Hide wasm2c scaffolding"
                    onClick={() => setFocusModule((value) => !value)}
                  >
                    <Focus />
                  </button>
                  <CopyButton text={current?.text ?? ''} disabled={!current} />
                  <button
                    type="button"
                    className="button button--icon"
                    title={current ? `Download ${current.name}` : 'Download'}
                    aria-label={current ? `Download ${current.name}` : 'Download'}
                    disabled={!current}
                    onClick={() => current && downloadText(current.name, current.text)}
                  >
                    <Download />
                  </button>
                </div>
              </div>

              {result && !result.ok && (
                <div className="errors" role="alert">
                  <div className="errors__head">
                    <Warning />
                    <span>{firstErrorMessage(result.error)}</span>
                  </div>
                  <pre className="errors__body">{result.error}</pre>
                </div>
              )}

              {current ? (
                <div className={`output${stale ? ' output--stale' : ''}`}>
                  <CodeViewer
                    value={current.text}
                    boilerplate={current.boilerplate}
                    focus={focusModule}
                    resetKey={current.name}
                    jumpTo={jumpTo}
                    onFollow={handleFollow}
                  />
                </div>
              ) : (
                <div className="placeholder">
                  {status.kind === 'loading' ? 'Loading wasm2c…' : 'Waiting for a module…'}
                </div>
              )}
            </section>
          }
        />
      )}

      <footer className="statusbar">
        <StatusText
          status={status}
          converting={converting}
          result={result}
          focusModule={focusModule}
        />
        <div className="statusbar__spacer" />
        {shown && (
          <button
            type="button"
            className="statusbar__action"
            onClick={() =>
              downloadBytes(`${options.moduleName || 'module'}.wasm`, shown.wasm)
            }
          >
            <Download />
            {formatBytes(shown.wasm.length)} .wasm
          </button>
        )}
        <a
          className="statusbar__link"
          href="https://github.com/WebAssembly/wabt"
          target="_blank"
          rel="noreferrer noopener"
        >
          wabt {wabtVersion.describe}
        </a>
      </footer>
    </div>
  );
}

function StatusText({
  status,
  converting,
  result,
  focusModule,
}: {
  status: Status;
  converting: boolean;
  result: ConvertResult | null;
  focusModule: boolean;
}) {
  if (status.kind === 'loading') {
    return <span className="statusbar__state statusbar__state--busy">Loading wasm2c…</span>;
  }
  if (status.kind === 'fatal') {
    return <span className="statusbar__state statusbar__state--error">Failed to start</span>;
  }
  if (converting || !result) {
    return <span className="statusbar__state statusbar__state--busy">Converting…</span>;
  }
  if (!result.ok) {
    return (
      <span className="statusbar__state statusbar__state--error">
        {firstErrorMessage(result.error)}
      </span>
    );
  }
  const total = result.files.reduce((sum, file) => sum + file.text.length, 0);
  const lines = result.files.reduce((sum, file) => sum + countLines(file.text), 0);
  const scaffolding = result.files.reduce(
    (sum, file) => sum + countBoilerplateLines(file.boilerplate),
    0,
  );
  return (
    <span className="statusbar__state statusbar__state--ok">
      {result.files.length} file{result.files.length === 1 ? '' : 's'} ·{' '}
      {focusModule && scaffolding > 0
        ? `${lines - scaffolding} module lines (${scaffolding} scaffolding hidden)`
        : `${lines} lines`}{' '}
      · {formatBytes(total)} · {formatDuration(result.durationMs)}
    </span>
  );
}

function CopyButton({ text, disabled }: { text: string; disabled: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className="button button--icon"
      title="Copy to clipboard"
      aria-label="Copy to clipboard"
      disabled={disabled}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          // Clipboard permission denied; leave the button unchanged.
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
    </button>
  );
}

function ShareButton({ wat, options }: { wat: string; options: Wasm2cOptions }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className="button"
      title="Copy a link to this module"
      onClick={async () => {
        const fragment = await encodeState({ wat, options });
        const url = `${window.location.origin}${window.location.pathname}#${fragment}`;
        history.replaceState(null, '', `#${fragment}`);
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
        } catch {
          // The URL bar now holds the link even if the clipboard refused.
        }
      }}
    >
      {copied ? <Check /> : <Link />}
      <span>{copied ? 'Copied' : 'Share'}</span>
    </button>
  );
}

/** A short marker in the toolbar when the options differ from wabt's defaults. */
function optionsBadge(options: Wasm2cOptions): string | null {
  let changes = 0;
  if (options.moduleName !== DEFAULT_OPTIONS.moduleName) changes++;
  if (options.numOutputs !== DEFAULT_OPTIONS.numOutputs) changes++;
  if (options.debugNames !== DEFAULT_OPTIONS.debugNames) changes++;
  const sorted = [...options.features].sort().join();
  if (sorted !== [...DEFAULT_OPTIONS.features].sort().join()) changes++;
  return changes > 0 ? String(changes) : null;
}
