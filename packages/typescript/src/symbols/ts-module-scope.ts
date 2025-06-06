import { Binder, OutputScope, Refkey, refkey } from "@alloy-js/core";
import {
  createTSSymbol,
  TSOutputSymbol,
  TSSymbolFlags,
} from "./ts-output-symbol.js";

export interface ImportedSymbol {
  local: TSOutputSymbol;
  target: TSOutputSymbol;
}
export type ImportRecords = Map<TSModuleScope, Set<ImportedSymbol>>;

export interface AddImportOptions {
  type?: boolean;
}

export interface TSModuleScope extends OutputScope {
  kind: "module";
  exportedSymbols: Map<Refkey, TSOutputSymbol>;
  /**
   * A mapping of foreign symbols to module-local symbols
   */
  importedSymbols: Map<TSOutputSymbol, TSOutputSymbol>;
  importedModules: ImportRecords;
  addImport(
    symbol: TSOutputSymbol,
    module: TSModuleScope,
    options?: AddImportOptions,
  ): TSOutputSymbol;
}

export function createTSModuleScope(
  binder: Binder,
  parent: OutputScope,
  path: string,
): TSModuleScope {
  return binder.createScope<TSModuleScope>({
    kind: "module",
    name: path,
    parent,
    exportedSymbols: new Map(),
    importedSymbols: new Map(),
    importedModules: new Map(),
    addImport(this: TSModuleScope, targetSymbol, targetModule, options) {
      const existing = this.importedSymbols.get(targetSymbol);
      if (existing) {
        if (!options?.type && existing.tsFlags & TSSymbolFlags.TypeSymbol) {
          existing.tsFlags &= ~TSSymbolFlags.TypeSymbol;
        }
        return existing;
      }

      if (targetModule.kind !== "module") {
        throw new Error("Cannot import symbol that isn't in module scope");
      }

      if (!this.importedModules.has(targetModule)) {
        this.importedModules.set(targetModule, new Set());
      }

      const localSymbol = createTSSymbol({
        binder,
        scope: this,
        name: targetSymbol.name,
        refkey: refkey({}),
        tsFlags: TSSymbolFlags.LocalImportSymbol,
      });
      if (options?.type) {
        localSymbol.tsFlags |= TSSymbolFlags.TypeSymbol;
      }

      this.importedSymbols.set(targetSymbol, localSymbol);
      this.importedModules.get(targetModule)!.add({
        local: localSymbol,
        target: targetSymbol,
      });

      return localSymbol;
    },
  });
}
