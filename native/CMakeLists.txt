cmake_minimum_required(VERSION 3.16)
project(wasm2c-playground-core CXX C)

if (NOT EMSCRIPTEN)
  message(FATAL_ERROR "This target is Emscripten-only; configure with `emcmake cmake`.")
endif ()

# Path to a wabt checkout. Defaults to the vendored submodule.
set(WABT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../third_party/wabt"
    CACHE PATH "Path to the wabt source tree")
get_filename_component(WABT_DIR "${WABT_DIR}" ABSOLUTE)

if (NOT EXISTS "${WABT_DIR}/CMakeLists.txt")
  message(FATAL_ERROR
    "wabt sources not found at ${WABT_DIR}. "
    "Run `git submodule update --init --recursive`, or pass -DWABT_DIR=<path>.")
endif ()

# We only need the wabt static library, not its tools, tests, or libwasm.
set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(BUILD_LIBWASM OFF CACHE BOOL "" FORCE)
set(BUILD_FUZZ_TOOLS OFF CACHE BOOL "" FORCE)
set(WITH_WASI OFF CACHE BOOL "" FORCE)
set(WITH_EXCEPTIONS OFF CACHE BOOL "" FORCE)
set(WABT_INSTALL_RULES OFF CACHE BOOL "" FORCE)
# PicoSHA2 is vendored with wabt; OpenSSL is not available under Emscripten.
set(USE_INTERNAL_SHA256 ON CACHE BOOL "" FORCE)

add_subdirectory("${WABT_DIR}" "${CMAKE_CURRENT_BINARY_DIR}/wabt" EXCLUDE_FROM_ALL)

add_executable(wasm2c wasm2c_bindings.cc)
target_link_libraries(wasm2c PRIVATE wabt)
target_compile_features(wasm2c PRIVATE cxx_std_17)

set(WASM2C_LINK_FLAGS
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sEXPORT_NAME=createWasm2c
  -sENVIRONMENT=web,worker,node
  -sALLOW_MEMORY_GROWTH=1
  -sINITIAL_MEMORY=33554432
  -sSTACK_SIZE=1048576
  -sFILESYSTEM=0
  -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,UTF8ToString,stringToUTF8,lengthBytesUTF8,HEAPU8
  -sEXPORTED_FUNCTIONS=_malloc,_free
  --no-entry
  -Oz
  --closure=0
)
string(REPLACE ";" " " WASM2C_LINK_FLAGS_STR "${WASM2C_LINK_FLAGS}")

set_target_properties(wasm2c PROPERTIES
  OUTPUT_NAME "wasm2c"
  SUFFIX ".js"
  LINK_FLAGS "${WASM2C_LINK_FLAGS_STR}"
)
