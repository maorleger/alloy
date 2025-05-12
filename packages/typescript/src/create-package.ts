import {
  Binder,
  getSymbolCreatorSymbol,
  OutputSymbolFlags,
  Refkey,
  refkey,
  SymbolCreator,
} from "@alloy-js/core";

import {
  createTSMemberScope,
  createTSModuleScope,
  createTSPackageScope,
  createTSSymbol,
  TSModuleScope,
  TSOutputSymbol,
} from "./symbols/index.js";

export interface PackageDescriptor {
  [path: string]: ModuleSymbolsDescriptor;
}

export type NamedModuleDescriptor =
  | string
  | {
      name: string;
      staticMembers?: Array<NamedModuleDescriptor>;
      instanceMembers?: Array<NamedModuleDescriptor>;
    };

export interface ModuleSymbolsDescriptor {
  default?: string;
  named?: readonly NamedModuleDescriptor[];
}

function createNamedSymbol(
  binder: Binder,
  moduleScope: TSModuleScope,
  name: string,
  key: Refkey,
  flags?: OutputSymbolFlags,
) {
  const sym = createTSSymbol({
    binder,
    name,
    scope: moduleScope,
    refkey: key,
    export: true,
    default: false,
    flags,
  });
  moduleScope.exportedSymbols.set(key, sym);
  return sym;
}

function createInstanceMembers(
  binder: Binder,
  sym: TSOutputSymbol,
  instanceMembers: NamedModuleDescriptor[],
  keys: Record<string, any>,
) {
  const memberScope = createTSMemberScope(binder, sym.scope, sym);

  for (const member of instanceMembers) {
    const memberName = typeof member === "string" ? member : member.name;

    // Create a refkey directly if it doesn't exist yet
    if (!keys[memberName]) {
      keys[memberName] = refkey();
    }

    const memberKey = keys[memberName];

    let memberFlags = OutputSymbolFlags.InstanceMember;
    if (typeof member === "object" && member.instanceMembers?.length) {
      memberFlags |= OutputSymbolFlags.InstanceMemberContainer;
    }
    if (typeof member === "object" && member.staticMembers?.length) {
      memberFlags |= OutputSymbolFlags.StaticMemberContainer;
    }

    const memberSym = createTSSymbol({
      name: memberName,
      scope: memberScope,
      refkey: memberKey,
      export: false,
      default: false,
      flags: memberFlags,
    });

    if (typeof member === "object" && member.staticMembers) {
      // Recursively handle nested static members
      createStaticMembers(
        binder,
        memberSym,
        member.staticMembers,
        keys[memberName],
      );
    }
    if (typeof member === "object" && member.instanceMembers) {
      // Recursively handle nested instance members
      createInstanceMembers(
        binder,
        memberSym,
        member.instanceMembers,
        keys[memberName],
      );
    }
  }
}

function createStaticMembers(
  binder: Binder,
  namespaceSym: TSOutputSymbol,
  staticMembers: NamedModuleDescriptor[],
  keys: Record<string, any>,
) {
  const memberScope = createTSMemberScope(binder, undefined, namespaceSym);

  for (const member of staticMembers) {
    const memberName = typeof member === "string" ? member : member.name;

    // Create a refkey directly if it doesn't exist yet
    if (!keys[memberName]) {
      keys[memberName] = refkey();
    }

    const memberKey = keys[memberName];

    let memberFlags = OutputSymbolFlags.StaticMember;
    if (typeof member === "object" && member.instanceMembers?.length) {
      memberFlags |= OutputSymbolFlags.InstanceMemberContainer;
    }
    if (typeof member === "object" && member.staticMembers?.length) {
      memberFlags |= OutputSymbolFlags.StaticMemberContainer;
    }

    const memberSym = createTSSymbol({
      name: memberName,
      scope: memberScope,
      refkey: memberKey,
      export: false,
      default: false,
      flags: memberFlags,
    });

    if (typeof member === "object" && member.staticMembers) {
      // Recursively handle nested static members
      createStaticMembers(
        binder,
        memberSym,
        member.staticMembers,
        (keys[memberName] = keys[memberName] || {}),
      );
    }
    if (typeof member === "object" && member.instanceMembers) {
      // Recursively handle instance members
      createInstanceMembers(
        binder,
        memberSym,
        member.instanceMembers,
        (keys[memberName] = keys[memberName] || {}),
      );
    }
  }
}

function createSymbols(
  binder: Binder,
  props: CreatePackageProps<PackageDescriptor>,
  refkeys: Record<string, any>,
) {
  const pkgScope = createTSPackageScope(
    binder,
    undefined,
    props.name,
    props.version,
    `node_modules/${props.name}`,
    props.builtin,
  );

  for (const [path, symbols] of Object.entries(props.descriptor)) {
    const keys = path === "." ? refkeys : refkeys[path];
    const moduleScope = createTSModuleScope(binder, pkgScope, path);
    pkgScope.exportedSymbols.set(path, moduleScope);

    if (symbols.default) {
      const key = keys.default;
      const sym = createTSSymbol({
        name: symbols.default,
        scope: moduleScope,
        refkey: key,
        export: true,
        default: true,
      });
      moduleScope.exportedSymbols.set(key, sym);
    }

    for (const exportedName of symbols.named ?? []) {
      const namedRef =
        typeof exportedName === "string" ?
          { name: exportedName }
        : exportedName;
      const { name, staticMembers, instanceMembers } = namedRef;
      const key = keys[name];

      let flags = OutputSymbolFlags.None;
      if (staticMembers && staticMembers.length > 0) {
        flags |= OutputSymbolFlags.StaticMemberContainer;
      }
      if (instanceMembers && instanceMembers.length > 0) {
        flags |= OutputSymbolFlags.InstanceMemberContainer;
      }
      if (flags & OutputSymbolFlags.InstanceMemberContainer) {
        flags |= OutputSymbolFlags.MemberContainer;
      }

      const namespaceSym = createNamedSymbol(
        binder,
        moduleScope,
        name,
        key,
        flags,
      );

      if (staticMembers && staticMembers.length > 0) {
        createStaticMembers(
          binder,
          namespaceSym,
          staticMembers,
          keys[name], // pass nested keys
        );
      }
      if (instanceMembers && instanceMembers.length > 0) {
        createInstanceMembers(
          binder,
          namespaceSym,
          instanceMembers,
          keys[name], // pass nested keys
        );
      }
    }
  }
}

// Recursive helper type to extract named exports as objects with static members
export type NamedObjectExports<T extends ModuleSymbolsDescriptor> = {
  [N in Extract<
    T["named"] extends readonly any[] ? T["named"][number] : never,
    { name: string }
  >["name"]]: Refkey &
    (Extract<
      T["named"] extends readonly any[] ?
        Extract<T["named"][number], { name: N; staticMembers: any }>
      : never,
      { staticMembers: readonly any[] }
    > extends (
      { staticMembers: infer SM extends readonly NamedModuleDescriptor[] }
    ) ?
      NamedExportsFromDescriptors<SM>
    : {});
};

// Helper type to recursively extract exports from descriptors
export type NamedExportsFromDescriptors<
  T extends readonly NamedModuleDescriptor[],
> = {
  [N in Extract<T[number], string>]: Refkey;
} & {
  [N in Extract<T[number], { name: string }>["name"]]: Refkey &
    (Extract<
      T[number],
      { name: N; staticMembers?: readonly NamedModuleDescriptor[] }
    > extends (
      { staticMembers: infer SM extends readonly NamedModuleDescriptor[] }
    ) ?
      NamedExportsFromDescriptors<SM>
    : {});
};

// Helper type to extract named exports as strings
export type NamedStringExports<T extends ModuleSymbolsDescriptor> = {
  [N in Extract<
    T["named"] extends readonly any[] ? T["named"][number] : never,
    string
  >]: Refkey;
};

// Helper type to handle default exports
export type DefaultExport<T extends ModuleSymbolsDescriptor> =
  T extends { default: string } ? { default: Refkey } : {};

// Combine all exports for a module
export type ModuleExports<T extends ModuleSymbolsDescriptor> =
  NamedStringExports<T> & NamedObjectExports<T> & DefaultExport<T>;

// Main simplified type
export type PackageRefkeys<T extends PackageDescriptor> = {
  [K in keyof T as K extends "." ? never : K]: ModuleExports<T[K]>;
} & ModuleExports<T["."]>;

export interface CreatePackageProps<T extends PackageDescriptor> {
  name: string;
  version: string;
  descriptor: T;
  builtin?: boolean;
}
export function createPackage<const T extends PackageDescriptor>(
  props: CreatePackageProps<T>,
): PackageRefkeys<T> & SymbolCreator {
  const refkeys: any = {
    [getSymbolCreatorSymbol()](binder: Binder) {
      createSymbols(binder, props, refkeys);
    },
  };

  for (const [path, symbols] of Object.entries(props.descriptor)) {
    const keys = path === "." ? refkeys : ((refkeys[path] = {}), refkeys[path]);

    if (symbols.default) {
      keys.default = refkey(props.descriptor, path, "default");
    }

    for (const named of symbols.named ?? []) {
      const namedRef = typeof named === "string" ? { name: named } : named;
      const { name, staticMembers } = namedRef;

      keys[name] = refkey();

      if (staticMembers && staticMembers.length > 0) {
        // Directly attach symbol creator without initializing nested keys
        keys[name][getSymbolCreatorSymbol()] = (
          binder: Binder,
          parentSym: TSOutputSymbol,
        ) => {
          createStaticMembers(binder, parentSym, staticMembers, keys[name]);
        };
      }
    }
  }

  return refkeys;
}
