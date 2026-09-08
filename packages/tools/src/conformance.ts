/**
 * @vaaniresolve/tools — compile-time conformance gate.
 *
 * Type-check only. Proves the authoritative contract (./api) exactly matches
 * the exported values and types of data.js + registry.js. Value exports are
 * compared via a real namespace import (typeof, keyof); type exports via
 * named type imports. Dropping an export from either side fails to compile.
 */

import * as Actual from './index.js';
import * as Declared from './api';
import type {
  ToolExecutionContext as DeclaredCtx,
  ToolOverrides as DeclaredOverrides,
  Executor as DeclaredExecutor,
  Order as DeclaredOrder,
} from './api';
import type {
  ToolExecutionContext as ImplCtx,
  ToolOverrides as ImplOverrides,
  Executor as ImplExecutor,
  Order as ImplOrder,
} from './index.js';

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/* Value name-set equality — a missing OR extra value export fails here. */
type _valueKeys = Expect<
  Equal<
    keyof typeof Actual,
    | 'CUSTOMERS'
    | 'PRODUCTS'
    | 'ORDERS'
    | 'DEFAULT_CUSTOMER'
    | 'TOOL_DEFINITIONS'
    | 'getMutationLog'
    | 'validateArgs'
    | 'executeTool'
  >
>;

/* Value equality. */
type _Customers = Expect<Equal<typeof Declared.CUSTOMERS, typeof Actual.CUSTOMERS>>;
type _Products = Expect<Equal<typeof Declared.PRODUCTS, typeof Actual.PRODUCTS>>;
type _Orders = Expect<Equal<typeof Declared.ORDERS, typeof Actual.ORDERS>>;
type _DefaultCustomer = Expect<Equal<typeof Declared.DEFAULT_CUSTOMER, typeof Actual.DEFAULT_CUSTOMER>>;
type _ToolDefs = Expect<Equal<typeof Declared.TOOL_DEFINITIONS, typeof Actual.TOOL_DEFINITIONS>>;
type _GetLog = Expect<Equal<typeof Declared.getMutationLog, typeof Actual.getMutationLog>>;
type _Validate = Expect<Equal<typeof Declared.validateArgs, typeof Actual.validateArgs>>;
type _Exec = Expect<Equal<typeof Declared.executeTool, typeof Actual.executeTool>>;

/* Type equality. */
type _Ctx = Expect<Equal<DeclaredCtx, ImplCtx>>;
type _Overrides = Expect<Equal<DeclaredOverrides, ImplOverrides>>;
type _Executor = Expect<Equal<DeclaredExecutor, ImplExecutor>>;
type _OrderT = Expect<Equal<DeclaredOrder, ImplOrder>>;