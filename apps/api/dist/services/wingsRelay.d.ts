import { Socket } from 'socket.io-client';
import { Server as SocketServer } from 'socket.io';
interface NodeInfo {
    id: string;
    fqdn: string;
    daemonPort: number;
    scheme: string;
    token: string;
}
export interface ConsoleLine {
    type: 'output' | 'input' | 'status';
    data: string;
    timestamp: number;
}
export declare const consoleBuffer: Map<string, ConsoleLine[]>;
export interface StatsEntry {
    cpuAbsolute: number;
    memoryBytes: number;
    memoryLimitBytes: number;
    diskBytes: number;
    timestamp: number;
}
export declare const statsBuffer: Map<string, StatsEntry[]>;
export declare function pushConsoleBuffer(uuid: string, line: ConsoleLine): void;
export declare function getOrConnectWings(node: NodeInfo, io: SocketServer): Socket;
export declare function subscribeServerOnWings(nodeId: string, serverUuid: string): void;
export declare function sendCommandToWings(nodeId: string, serverUuid: string, command: string): void;
export declare function sendPowerToWings(nodeId: string, serverUuid: string, action: string): void;
export declare function disconnectNode(nodeId: string): void;
export {};
//# sourceMappingURL=wingsRelay.d.ts.map