import { Server } from '@prisma/client';
interface WingsServerConfig {
    uuid: string;
    suspended: boolean;
    environment: Record<string, string>;
    invocation: string;
    image: string;
    installScript?: string;
    scriptContainer?: string;
    build: {
        memory_limit: number;
        swap: number;
        disk_space: number;
        io_weight: number;
        cpu_limit: number;
        oom_disabled: boolean;
    };
    mounts: unknown[];
    egg: {
        id: string;
        file_denylist: string[];
    };
    container: {
        image: string;
        requires_rebuild: boolean;
    };
}
export declare function sendPowerAction(server: Server & {
    node: {
        fqdn: string;
        daemonPort: number;
        scheme: string;
        token: string;
    };
}, action: 'start' | 'stop' | 'restart' | 'kill'): Promise<void>;
export declare function sendCommand(server: Server & {
    node: {
        fqdn: string;
        daemonPort: number;
        scheme: string;
        token: string;
    };
}, command: string): Promise<void>;
export declare function getServerResources(server: Server & {
    node: {
        fqdn: string;
        daemonPort: number;
        scheme: string;
        token: string;
    };
}): Promise<{
    memory_bytes: number;
    memory_limit_bytes: number;
    cpu_absolute: number;
    disk_bytes: number;
    network_rx_bytes: number;
    network_tx_bytes: number;
    uptime: number;
    state: string;
}>;
type ServerWithEgg = Server & {
    egg: {
        startup: string;
        dockerImage: string;
        scriptInstall?: string | null;
        scriptContainer?: string | null;
    };
};
export declare function buildWingsConfig(server: ServerWithEgg): WingsServerConfig;
export declare function createServerOnNode(server: ServerWithEgg & {
    node: {
        fqdn: string;
        daemonPort: number;
        scheme: string;
        token: string;
    };
}): Promise<void>;
export declare function deleteServerFromNode(server: Server & {
    node: {
        fqdn: string;
        daemonPort: number;
        scheme: string;
        token: string;
    };
}): Promise<void>;
export declare function checkNodeHealth(fqdn: string, port: number, scheme: string, token: string): Promise<boolean>;
export declare function getNodeServers(nodeId: string): Promise<WingsServerConfig[]>;
export {};
//# sourceMappingURL=wingsClient.d.ts.map