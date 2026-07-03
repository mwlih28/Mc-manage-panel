// Shared shape both the CurseForge and Modrinth resolvers normalize into,
// so the install route doesn't need to know which source a pack came from.
export interface ResolvedMod {
  url: string;
  path: string; // relative to server root, e.g. "mods/fabric-api.jar"
}

export interface ResolvedOverride {
  path: string; // relative to server root
  contentBase64: string;
}

export type ModLoaderType = 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'unknown';

export interface ResolvedModpack {
  mods: ResolvedMod[];
  overrides: ResolvedOverride[];
  loader: {
    type: ModLoaderType;
    minecraftVersion: string;
    loaderVersion?: string;
  };
}
