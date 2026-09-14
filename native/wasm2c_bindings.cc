/*
 * Emscripten bindings that expose wabt's wasm2c pipeline to JavaScript.
 *
 * The exported surface is a tiny C ABI rather than embind: a single entry
 * point runs the conversion and stashes the result in a global, and the
 * getters below hand the pieces back one string at a time. That keeps the
 * generated C source out of any encoding layer, which matters because it can
 * contain arbitrary bytes from the module's names section.
 */

#include <cstdint>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include <emscripten/emscripten.h>

#include "wabt/apply-names.h"
#include "wabt/binary-reader-ir.h"
#include "wabt/binary-reader.h"
#include "wabt/binary-writer.h"
#include "wabt/c-writer.h"
#include "wabt/common.h"
#include "wabt/error-formatter.h"
#include "wabt/feature.h"
#include "wabt/generate-names.h"
#include "wabt/ir.h"
#include "wabt/stream.h"
#include "wabt/validator.h"
#include "wabt/wast-lexer.h"
#include "wabt/wast-parser.h"

using namespace wabt;

namespace {

struct OutputFile {
  std::string name;
  std::string text;
};

struct ConvertResult {
  bool ok = false;
  std::string error;
  std::vector<OutputFile> files;
  std::vector<uint8_t> wasm;
};

ConvertResult g_result;

// Mirrors wasm2c's own supported-feature list; anything outside it makes
// wasm2c bail out, so we reject it up front with a readable message instead.
bool IsSupportedByWasm2c(std::string_view flag) {
  static const char* kSupported[] = {
      "multi-memory",  "multi-value",   "sign-extension",
      "saturating-float-to-int",        "exceptions",
      "memory64",      "extended-const", "simd",
      "threads",       "tail-call",     "custom-page-sizes",
      "compact-imports"};
  for (const char* s : kSupported) {
    if (flag == s) {
      return true;
    }
  }
  return false;
}

// `spec` is a comma-separated list of feature flags to enable. Features not
// named are left disabled, so callers should send the full set they want
// rather than a delta.
Result ApplyFeatures(std::string_view spec, Features* features, std::string* error) {
  // Start from a blank slate so the UI toggles are authoritative.
#define WABT_FEATURE(variable, flag, default_, help) features->set_##variable##_enabled(false);
#include "wabt/feature.def"
#undef WABT_FEATURE

  size_t pos = 0;
  while (pos <= spec.size()) {
    size_t comma = spec.find(',', pos);
    std::string_view flag =
        spec.substr(pos, comma == std::string_view::npos ? std::string_view::npos
                                                         : comma - pos);
    if (!flag.empty()) {
      bool matched = false;
#define WABT_FEATURE(variable, flag_name, default_, help) \
  if (!matched && flag == flag_name) {                    \
    features->set_##variable##_enabled(true);             \
    matched = true;                                       \
  }
#include "wabt/feature.def"
#undef WABT_FEATURE
      if (!matched) {
        *error = "unknown feature: " + std::string(flag);
        return Result::Error;
      }
    }
    if (comma == std::string_view::npos) {
      break;
    }
    pos = comma + 1;
  }

  // Same gate the wasm2c tool applies: turning on a feature that is off by
  // default and outside wasm2c's supported subset is an error. Features that
  // are on by default are always fine, since wasm2c already handles them.
#define WABT_FEATURE(variable, flag, default_, help)                       \
  if (features->variable##_enabled() != default_ &&                        \
      features->variable##_enabled() && !IsSupportedByWasm2c(flag)) {      \
    *error = "wasm2c does not support the '" flag "' feature";             \
    return Result::Error;                                                  \
  }
#include "wabt/feature.def"
#undef WABT_FEATURE

  return Result::Ok;
}

// Turns the module IR into C. Assumes `module` has already been validated and
// had names generated/applied, matching what the wasm2c tool does.
Result WriteCFiles(const Module& module,
                   const std::string& module_name,
                   const Features& features,
                   unsigned num_outputs,
                   std::vector<OutputFile>* out) {
  const std::string header_name = module_name + ".h";
  const std::string header_impl_name = module_name + "-impl.h";
  const bool split = num_outputs > 1;

  std::vector<MemoryStream> c_streams(num_outputs);
  std::vector<Stream*> c_stream_ptrs;
  c_stream_ptrs.reserve(num_outputs);
  for (auto& s : c_streams) {
    c_stream_ptrs.push_back(&s);
  }
  MemoryStream h_stream;
  MemoryStream h_impl_stream;

  WriteCOptions options;
  options.module_name = module_name;
  options.features = features;

  // With a single output the declarations go into the lone .c file; with
  // several they need a shared -impl.h, exactly as the wasm2c tool arranges it.
  CHECK_RESULT(WriteC(std::move(c_stream_ptrs), &h_stream,
                      split ? &h_impl_stream : &c_streams[0],
                      header_name.c_str(), split ? header_impl_name.c_str() : "",
                      &module, options));

  auto take = [](MemoryStream& s) {
    const OutputBuffer& buf = s.output_buffer();
    return std::string(reinterpret_cast<const char*>(buf.data.data()),
                       buf.data.size());
  };

  for (unsigned i = 0; i < num_outputs; i++) {
    const std::string name =
        split ? module_name + "_" + std::to_string(i) + ".c" : module_name + ".c";
    out->push_back({name, take(c_streams[i])});
  }
  out->push_back({header_name, take(h_stream)});
  if (split) {
    out->push_back({header_impl_name, take(h_impl_stream)});
  }
  return Result::Ok;
}

}  // namespace

extern "C" {

/*
 * Converts `input` (WAT text, or a wasm binary when `is_binary` is set) into C.
 * Returns 1 on success and 0 on failure; either way the result is readable
 * through the getters below until the next call.
 */
EMSCRIPTEN_KEEPALIVE
int w2c_convert(const char* input,
                int input_len,
                int is_binary,
                const char* module_name,
                const char* features_csv,
                int num_outputs,
                int debug_names) {
  g_result = ConvertResult{};

  if (num_outputs < 1) {
    g_result.error = "number of output files must be positive";
    return 0;
  }

  Features features;
  std::string feature_error;
  if (Failed(ApplyFeatures(features_csv ? features_csv : "", &features,
                           &feature_error))) {
    g_result.error = feature_error;
    return 0;
  }

  std::string name = module_name && *module_name ? module_name : "";
  Errors errors;
  std::vector<uint8_t> binary;
  std::unique_ptr<LexerSourceLineFinder> line_finder;
  // Errors from the text stage carry text locations; binary-stage errors carry
  // offsets, and they format differently.
  Location::Type error_location_type =
      is_binary ? Location::Type::Binary : Location::Type::Text;

  if (is_binary) {
    binary.assign(reinterpret_cast<const uint8_t*>(input),
                  reinterpret_cast<const uint8_t*>(input) + input_len);
  } else {
    // Assemble the text first so that the C output is identical to what
    // `wat2wasm foo.wat && wasm2c foo.wasm` would produce.
    auto lexer = WastLexer::CreateBufferLexer("input.wat", input, input_len, &errors);
    std::unique_ptr<Module> text_module;
    WastParseOptions parse_options(features);
    Result result = ParseWatModule(lexer.get(), &text_module, &errors, &parse_options);
    if (Succeeded(result)) {
      result = ValidateModule(text_module.get(), &errors, ValidateOptions(features));
    }
    if (Succeeded(result)) {
      MemoryStream stream;
      WriteBinaryOptions write_options;
      write_options.features = features;
      write_options.write_debug_names = debug_names != 0;
      result = WriteBinaryModule(&stream, text_module.get(), write_options);
      if (Succeeded(result)) {
        binary = stream.output_buffer().data;
      }
    }
    if (Failed(result)) {
      line_finder = lexer->MakeLineFinder();
      g_result.error = FormatErrorsToString(errors, Location::Type::Text,
                                            line_finder.get());
      if (g_result.error.empty()) {
        g_result.error = "failed to parse WebAssembly text";
      }
      return 0;
    }
    errors.clear();
  }

  g_result.wasm = binary;

  Module module;
  const bool kStopOnFirstError = true;
  const bool kFailOnCustomSectionError = true;
  ReadBinaryOptions read_options(features, nullptr, /*read_debug_names=*/true,
                                 kStopOnFirstError, kFailOnCustomSectionError);
  Result result = ReadBinaryIr("input.wasm", binary.data(), binary.size(),
                               read_options, &errors, &module);
  if (Succeeded(result)) {
    result = ValidateModule(&module, &errors, ValidateOptions(features));
  }
  if (Succeeded(result)) {
    result = GenerateNames(&module);
  }
  if (Succeeded(result)) {
    // Best-effort, same as the wasm2c tool: a name that can't be applied is
    // simply skipped.
    ApplyNames(&module);
    if (name.empty()) {
      name = module.name.empty() ? "wasm" : module.name;
    }
    result = WriteCFiles(module, name, features, num_outputs, &g_result.files);
  }

  if (Failed(result)) {
    g_result.files.clear();
    g_result.error = FormatErrorsToString(errors, error_location_type,
                                          line_finder.get());
    if (g_result.error.empty()) {
      g_result.error = "wasm2c failed to convert the module";
    }
    return 0;
  }

  g_result.ok = true;
  return 1;
}

EMSCRIPTEN_KEEPALIVE
const char* w2c_error() {
  return g_result.error.c_str();
}

EMSCRIPTEN_KEEPALIVE
int w2c_file_count() {
  return static_cast<int>(g_result.files.size());
}

EMSCRIPTEN_KEEPALIVE
const char* w2c_file_name(int index) {
  if (index < 0 || index >= static_cast<int>(g_result.files.size())) {
    return "";
  }
  return g_result.files[index].name.c_str();
}

EMSCRIPTEN_KEEPALIVE
const char* w2c_file_text(int index) {
  if (index < 0 || index >= static_cast<int>(g_result.files.size())) {
    return "";
  }
  return g_result.files[index].text.c_str();
}

EMSCRIPTEN_KEEPALIVE
int w2c_file_size(int index) {
  if (index < 0 || index >= static_cast<int>(g_result.files.size())) {
    return 0;
  }
  return static_cast<int>(g_result.files[index].text.size());
}

EMSCRIPTEN_KEEPALIVE
const uint8_t* w2c_wasm_data() {
  return g_result.wasm.data();
}

EMSCRIPTEN_KEEPALIVE
int w2c_wasm_size() {
  return static_cast<int>(g_result.wasm.size());
}

// Every feature wabt knows about, one per line as
// `flag,default,enableable-in-wasm2c,help`, so the UI can build its toggles
// from the library rather than a hardcoded copy.
EMSCRIPTEN_KEEPALIVE
const char* w2c_all_features() {
  static const std::string kAll = []() {
    std::string s;
#define WABT_FEATURE(variable, flag, default_, help) \
  s += flag;                                         \
  s += ',';                                          \
  s += (default_ ? '1' : '0');                       \
  s += ',';                                          \
  s += ((IsSupportedByWasm2c(flag) || default_) ? '1' : '0');      \
  s += ',';                                          \
  s += help;                                         \
  s += '\n';
#include "wabt/feature.def"
#undef WABT_FEATURE
    return s;
  }();
  return kAll.c_str();
}

}  // extern "C"
