export interface CurseForgeWorldSummary {
    id: number;
    name: string;
    summary: string;
    logoUrl: string | null;
    downloadCount: number;
    websiteUrl: string;
}
export declare function isCurseForgeConfigured(): Promise<boolean>;
export declare function searchWorlds(query: string, index?: number, pageSize?: number): Promise<{
    results: CurseForgeWorldSummary[];
    totalCount: number;
}>;
export interface CurseForgeWorldFile {
    id: number;
    fileName: string;
    displayName: string;
    fileDate: string;
    fileLength: number;
    downloadUrl: string | null;
    gameVersions: string[];
}
export declare function getWorldFiles(modId: number): Promise<CurseForgeWorldFile[]>;
//# sourceMappingURL=curseforgeApi.d.ts.map