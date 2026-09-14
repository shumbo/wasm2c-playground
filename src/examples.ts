export interface Example {
  id: string;
  title: string;
  description: string;
  wat: string;
}

export const EXAMPLES: Example[] = [
  {
    id: 'add',
    title: 'Add',
    description: 'Two i32 parameters, one result',
    wat: `(module
  (func $add (export "add") (param $lhs i32) (param $rhs i32) (result i32)
    local.get $lhs
    local.get $rhs
    i32.add))
`,
  },
  {
    id: 'fac',
    title: 'Factorial',
    description: 'Recursion and a conditional',
    wat: `(module
  (func $fac (export "fac") (param $n i64) (result i64)
    local.get $n
    i64.const 1
    i64.lt_s
    if (result i64)
      i64.const 1
    else
      local.get $n
      local.get $n
      i64.const 1
      i64.sub
      call $fac
      i64.mul
    end))
`,
  },
  {
    id: 'loop',
    title: 'Loop',
    description: 'A counting loop with br_if',
    wat: `(module
  (func $sum_to (export "sum_to") (param $n i32) (result i32)
    (local $i i32)
    (local $acc i32)
    (loop $continue
      local.get $acc
      local.get $i
      i32.add
      local.set $acc

      local.get $i
      i32.const 1
      i32.add
      local.tee $i

      local.get $n
      i32.le_s
      br_if $continue)
    local.get $acc))
`,
  },
  {
    id: 'memory',
    title: 'Memory',
    description: 'Linear memory, a data segment, and loads',
    wat: `(module
  (memory (export "memory") 1)
  (data (i32.const 0) "hello, wasm2c")

  (func $byte_at (export "byte_at") (param $offset i32) (result i32)
    local.get $offset
    i32.load8_u)

  (func $store (export "store") (param $offset i32) (param $value i32)
    local.get $offset
    local.get $value
    i32.store))
`,
  },
  {
    id: 'table',
    title: 'Table and call_indirect',
    description: 'An indirect call through a function table',
    wat: `(module
  (type $binop (func (param i32 i32) (result i32)))

  (table 2 funcref)
  (elem (i32.const 0) $add $mul)

  (func $add (type $binop)
    local.get 0
    local.get 1
    i32.add)

  (func $mul (type $binop)
    local.get 0
    local.get 1
    i32.mul)

  (func (export "apply") (param $op i32) (param $a i32) (param $b i32) (result i32)
    local.get $a
    local.get $b
    local.get $op
    call_indirect (type $binop)))
`,
  },
  {
    id: 'imports',
    title: 'Imports',
    description: 'Host functions and an imported global',
    wat: `(module
  (import "env" "log" (func $log (param i32)))
  (import "env" "base" (global $base i32))

  (func (export "log_offset") (param $offset i32)
    global.get $base
    local.get $offset
    i32.add
    call $log))
`,
  },
  {
    id: 'float',
    title: 'Floating point',
    description: 'f64 math, including a trapping conversion',
    wat: `(module
  (func (export "hypot") (param $x f64) (param $y f64) (result f64)
    local.get $x
    local.get $x
    f64.mul
    local.get $y
    local.get $y
    f64.mul
    f64.add
    f64.sqrt)

  (func (export "truncate") (param $x f64) (result i32)
    local.get $x
    i32.trunc_f64_s))
`,
  },
  {
    id: 'simd',
    title: 'SIMD',
    description: 'A v128 lane-wise add (needs the simd feature)',
    wat: `(module
  (memory 1)
  (func (export "add_lanes") (param $a i32) (param $b i32) (param $out i32)
    local.get $out
    local.get $a
    v128.load
    local.get $b
    v128.load
    i32x4.add
    v128.store))
`,
  },
];

export const DEFAULT_EXAMPLE = EXAMPLES[0];
