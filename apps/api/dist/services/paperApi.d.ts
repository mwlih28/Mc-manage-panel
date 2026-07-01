export declare function fetchPaperVersions(): Promise<string[]>;
export interface PaperBuild {
    id: number;
    time: string;
    channel: string;
    commits: {
        sha: string;
        message: string;
        time: string;
    }[];
}
export declare function fetchPaperBuildDetails(version: string): Promise<PaperBuild[]>;
export declare function fetchPaperBuilds(version: string): Promise<number[]>;
//# sourceMappingURL=paperApi.d.ts.map