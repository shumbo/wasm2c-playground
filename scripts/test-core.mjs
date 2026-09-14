/*
 * Smoke test for src/core/wasm2c.js.
 *
 * Runs every bundled example through the WebAssembly build. When a native
 * wasm2c and wat2wasm are on PATH (or pointed at by WABT_BIN), the generated
 * C is diffed against theirs so we catch drift between the two pipelines.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const createWasm2c = (
  await import(pathToFileURL(join(root, 'src/core/wasm2c.js')).href)
).default;
const mod = await createWasm2c();

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function allocString(value) {
  const bytes = encoder.encode(value);
  const ptr = mod._malloc(bytes.length + 1);
  mod.HEAPU8.set(bytes, ptr);
  mod.HEAPU8[ptr + bytes.length] = 0;
  return ptr;
}

function readCString(ptr) {
  let end = ptr;
  while (mod.HEAPU8[end] !== 0) end++;
  return decoder.decode(mod.HEAPU8.subarray(ptr, end));
}

// wabt's defaults; matching them means the native cross-check needs no flags.
const DEFAULT_FEATURES = [
  'mutable-globals',
  'saturating-float-to-int',
  'sign-extension',
  'simd',
  'multi-value',
  'bulk-memory',
  'reference-types',
];

function convert(wat, { moduleName = 'module', features = DEFAULT_FEATURES, numOutputs = 1, debugNames = true } = {}) {
  const inputPtr = allocString(wat);
  const namePtr = allocString(moduleName);
  const featuresPtr = allocString(features.join(','));
  try {
    const ok = mod._w2c_convert(
      inputPtr,
      encoder.encode(wat).length,
      0,
      namePtr,
      featuresPtr,
      numOutputs,
      debugNames ? 1 : 0,
    );
    if (!ok) return { ok: false, error: readCString(mod._w2c_error()) };
    const files = [];
    for (let i = 0; i < mod._w2c_file_count(); i++) {
      const ptr = mod._w2c_file_text(i);
      files.push({
        name: readCString(mod._w2c_file_name(i)),
        text: decoder.decode(mod.HEAPU8.subarray(ptr, ptr + mod._w2c_file_size(i))),
      });
    }
    const wasmPtr = mod._w2c_wasm_data();
    const wasm = mod.HEAPU8.slice(wasmPtr, wasmPtr + mod._w2c_wasm_size());
    return { ok: true, files, wasm };
  } finally {
    mod._free(inputPtr);
    mod._free(namePtr);
    mod._free(featuresPtr);
  }
}

// --- locate a native wabt for cross-checking -------------------------------

const wabtBin = process.env.WABT_BIN ?? '';
function nativeTool(name) {
  const candidate = wabtBin ? join(wabtBin, name) : name;
  try {
    execFileSync(candidate, ['--version'], { stdio: 'ignore' });
    return candidate;
  } catch {
    return null;
  }
}
const wat2wasm = nativeTool('wat2wasm');
const nativeWasm2c = nativeTool('wasm2c');
const canCrossCheck = Boolean(wat2wasm && nativeWasm2c);

function nativeConvert(wat, moduleName) {
  const dir = mkdtempSync(join(tmpdir(), 'wasm2c-test-'));
  try {
    const watPath = join(dir, `${moduleName}.wat`);
    const wasmPath = join(dir, `${moduleName}.wasm`);
    const cPath = join(dir, `${moduleName}.c`);
    writeFileSync(watPath, wat);
    execFileSync(wat2wasm, [watPath, '--debug-names', '-o', wasmPath]);
    execFileSync(nativeWasm2c, [wasmPath, '-n', moduleName, '-o', cPath]);
    return {
      c: readFileSync(cPath, 'utf8'),
      h: readFileSync(join(dir, `${moduleName}.h`), 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- cases -----------------------------------------------------------------

const { EXAMPLES } = await import(
  pathToFileURL(join(root, 'src/examples.ts')).href
);

let failures = 0;
const check = (name, condition, detail = '') => {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
};

console.log(`wasm2c core smoke test${canCrossCheck ? ' (cross-checking against native wabt)' : ' (native wabt not found; skipping diffs)'}`);
console.log();

console.log('examples convert cleanly:');
for (const example of EXAMPLES) {
  const result = convert(example.wat);
  check(example.id, result.ok, result.ok ? '' : result.error.split('\n')[0]);
  if (!result.ok) continue;

  check(
    `${example.id}: emits module.c and module.h`,
    result.files.length === 2 &&
      result.files[0].name === 'module.c' &&
      result.files[1].name === 'module.h',
    result.files.map((f) => f.name).join(', '),
  );
  check(
    `${example.id}: wasm binary has a valid header`,
    result.wasm.length > 8 &&
      result.wasm[0] === 0x00 &&
      result.wasm[1] === 0x61 &&
      result.wasm[2] === 0x73 &&
      result.wasm[3] === 0x6d,
  );

  if (canCrossCheck) {
    const native = nativeConvert(example.wat, 'module');
    check(
      `${example.id}: .c matches native wasm2c`,
      native.c === result.files[0].text,
      firstDiff(native.c, result.files[0].text),
    );
    check(
      `${example.id}: .h matches native wasm2c`,
      native.h === result.files[1].text,
      firstDiff(native.h, result.files[1].text),
    );
  }
}

console.log();
console.log('options:');
{
  const r = convert(EXAMPLES[0].wat, { moduleName: 'demo' });
  check(
    'module name renames the outputs',
    r.ok && r.files[0].name === 'demo.c' && r.files[1].name === 'demo.h',
  );
  check('module name prefixes the symbols', r.ok && r.files[1].text.includes('w2c_demo'));
}
{
  const r = convert(EXAMPLES[1].wat, { numOutputs: 3 });
  check(
    'num-outputs splits into N .c files plus -impl.h',
    r.ok &&
      r.files.map((f) => f.name).join(',') ===
        'module_0.c,module_1.c,module_2.c,module.h,module-impl.h',
    r.ok ? r.files.map((f) => f.name).join(',') : r.error,
  );
}
{
  const withNames = convert(EXAMPLES[0].wat, { debugNames: true });
  const withoutNames = convert(EXAMPLES[0].wat, { debugNames: false });
  // Exported names survive either way; the names section is what carries the
  // parameter and local names through to the C.
  check(
    'debug names keep the WAT parameter names',
    withNames.ok && withNames.files[0].text.includes('var_lhs'),
  );
  check(
    'disabling debug names falls back to positional names',
    withoutNames.ok &&
      withoutNames.files[0].text.includes('var_p0') &&
      !withoutNames.files[0].text.includes('var_lhs'),
  );
}

console.log();
console.log('errors:');
{
  const r = convert('(module (func (result i32) i64.const 0))');
  check('type error is reported', !r.ok && /type mismatch/.test(r.error), r.ok ? 'converted anyway' : r.error.split('\n')[0]);
  check('error carries a source location', !r.ok && /input\.wat:\d+:\d+/.test(r.error));
}
{
  const r = convert('(module');
  check('syntax error is reported', !r.ok && r.error.length > 0);
}
{
  const r = convert('(module)', { features: ['bogus-feature'] });
  check('unknown feature is rejected', !r.ok && /unknown feature/.test(r.error), r.ok ? 'accepted' : r.error);
}
{
  const r = convert('(module)', { features: ['gc'] });
  check(
    'feature outside wasm2c support is rejected',
    !r.ok && /does not support/.test(r.error),
    r.ok ? 'accepted' : r.error,
  );
}
{
  const withoutSimd = DEFAULT_FEATURES.filter((f) => f !== 'simd');
  const r = convert('(module (func (export "f") (param v128)))', { features: withoutSimd });
  check('disabling a feature is enforced', !r.ok, r.ok ? 'accepted v128 without simd' : '');
}
{
  // The runner must survive a failure and keep working afterwards.
  const r = convert(EXAMPLES[0].wat);
  check('recovers after an error', r.ok);
}

console.log();
console.log('boilerplate detection:');
{
  const { parseTemplates, findBoilerplate, countBoilerplateLines } = await import(
    pathToFileURL(join(root, 'src/core/boilerplate.ts')).href
  );
  const templates = parseTemplates(readCString(mod._w2c_templates()));
  check('templates parse', templates.length === 6, templates.map((t) => t.name).join(','));
  check(
    'every template has text',
    templates.every((t) => t.text.length > 0),
  );

  // wasm2c writes each template verbatim, so the whole blob must be findable.
  for (const [label, wat, features] of [
    ['plain', EXAMPLES[0].wat, DEFAULT_FEATURES],
    ['simd', EXAMPLES[7].wat, DEFAULT_FEATURES],
    ['threads', '(module (memory 1 1 shared) (func (export "f") (param i32) (result i32) local.get 0 i32.atomic.load))', [...DEFAULT_FEATURES, 'threads']],
  ]) {
    const result = convert(wat, { features });
    if (!result.ok) {
      check(`${label}: converts`, false, result.error.split('\n')[0]);
      continue;
    }
    const source = result.files[0];
    const total = source.text.split('\n').length;
    const ranges = findBoilerplate(source.text, templates);
    const hidden = countBoilerplateLines(ranges);

    check(`${label}: finds the scaffolding`, hidden > 0, `${hidden} lines`);
    check(
      `${label}: scaffolding is most of the file`,
      hidden / total > 0.85,
      `${hidden}/${total}`,
    );
    check(
      `${label}: ranges stay inside the file`,
      ranges.every((r) => r.from >= 1 && r.to <= total && r.from <= r.to),
      JSON.stringify(ranges),
    );
    check(
      `${label}: ranges do not overlap`,
      ranges.every((r, i) => i === 0 || ranges[i - 1].to < r.from),
      JSON.stringify(ranges),
    );

    // What is left must be the module's own code, not scaffolding.
    const lines = source.text.split('\n');
    const kept = lines.filter(
      (_, i) => !ranges.some((r) => i + 1 >= r.from && i + 1 <= r.to),
    );
    check(
      `${label}: the remainder holds the module code`,
      kept.some((line) => line.includes('w2c_module')),
    );
    check(
      `${label}: the remainder drops the runtime macros`,
      !kept.some((line) => line.includes('#define MEM_ADDR')),
    );
  }

  const simdOff = convert(EXAMPLES[0].wat, { features: DEFAULT_FEATURES });
  const simdOn = convert(EXAMPLES[7].wat, { features: DEFAULT_FEATURES });
  const labelsFor = (r) => findBoilerplate(r.files[0].text, templates).map((x) => x.label);
  check(
    'SIMD helpers are only detected when emitted',
    !labelsFor(simdOff).includes('SIMD helpers') &&
      labelsFor(simdOn).includes('SIMD helpers'),
    `${labelsFor(simdOff)} vs ${labelsFor(simdOn)}`,
  );
}

console.log();
console.log('runtime sources and symbol lookup:');
{
  const { readdirSync, readFileSync } = await import('node:fs');
  const { buildSymbolIndex, wordAt, includeTarget } = await import(
    pathToFileURL(join(root, 'src/core/symbols.ts')).href
  );

  const runtimeDir = join(root, 'src/core/runtime');
  const runtime = readdirSync(runtimeDir).map((name) => ({
    name,
    text: readFileSync(join(runtimeDir, name), 'utf8'),
  }));

  check('runtime sources are vendored', runtime.length === 8, `${runtime.length} files`);
  check(
    'every runtime file keeps its licence header',
    runtime.every((f) => f.text.includes('Apache License')),
  );
  check(
    'the vendored copies match the submodule',
    runtime.every((f) => {
      try {
        return (
          readFileSync(join(root, 'third_party/wabt/wasm2c', f.name), 'utf8') === f.text
        );
      } catch {
        return true; // submodule not checked out; nothing to compare against
      }
    }),
  );

  const index = buildSymbolIndex(runtime);
  check('indexes a useful number of symbols', index.size > 100, `${index.size}`);

  // Every one of these is a type a reader meets in generated C with no way to
  // find it, which is the whole reason the index exists.
  const expected = {
    wasm_rt_funcref_table_t: 'wasm-rt.h',
    wasm_rt_externref_table_t: 'wasm-rt.h',
    wasm_rt_memory_t: 'wasm-rt.h',
    wasm_rt_trap_t: 'wasm-rt.h',
    wasm_rt_func_type_t: 'wasm-rt.h',
    wasm_rt_funcref_t: 'wasm-rt.h',
    wasm_rt_init: 'wasm-rt.h',
    wasm_rt_grow_memory: 'wasm-rt.h',
    wasm_rt_tag_t: 'wasm-rt-exceptions.h',
  };
  for (const [name, file] of Object.entries(expected)) {
    const hit = index.get(name);
    check(`${name} resolves into ${file}`, hit?.file === file, hit ? `${hit.file}:${hit.line}` : 'not found');
  }

  // A resolved location must actually name the symbol on that line.
  const byName = new Map(runtime.map((f) => [f.name, f.text.split('\n')]));
  check(
    'every location really contains its symbol',
    [...index.entries()].every(([name, loc]) =>
      (byName.get(loc.file)?.[loc.line - 1] ?? '').includes(name),
    ),
    [...index.entries()]
      .filter(([n, l]) => !(byName.get(l.file)?.[l.line - 1] ?? '').includes(n))
      .slice(0, 3)
      .map(([n, l]) => `${n} -> ${l.file}:${l.line}`)
      .join('; '),
  );

  // Generated symbols win over the runtime, and resolve inside the module.
  const generated = convert(EXAMPLES[4].wat).files;
  const genIndex = buildSymbolIndex(generated);
  check(
    'generated symbols resolve in the generated files',
    genIndex.get('w2c_module')?.file === 'module.h',
    JSON.stringify(genIndex.get('w2c_module')),
  );

  check('wordAt reads an identifier', wordAt('a wasm_rt_memory_t* m;', 5) === 'wasm_rt_memory_t');
  check('wordAt ignores whitespace', wordAt('   ', 1) === null);
  check('wordAt ignores numbers', wordAt('x + 12345', 6) === null);
  check('includeTarget reads a quoted include', includeTarget('#include "wasm-rt.h"') === 'wasm-rt.h');
  check('includeTarget ignores system includes', includeTarget('#include <stdint.h>') === null);
}

console.log();
console.log('feature table:');
{
  const table = readCString(mod._w2c_all_features())
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(','));
  check('lists every wabt feature', table.length >= 20, `${table.length} entries`);
  const simd = table.find((row) => row[0] === 'simd');
  check('marks simd as enableable', simd && simd[2] === '1');
  const gc = table.find((row) => row[0] === 'gc');
  check('marks gc as not enableable', gc && gc[2] === '0');
}

function firstDiff(a, b) {
  const al = a.split('\n');
  const bl = b.split('\n');
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] !== bl[i]) {
      return `line ${i + 1}:\n       native: ${JSON.stringify(al[i])}\n       wasm:   ${JSON.stringify(bl[i])}`;
    }
  }
  return '';
}

console.log();
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed');
