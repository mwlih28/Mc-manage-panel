export declare function sendThankYouEmail(to: string, name: string, serverIp: string): Promise<boolean>;
export declare function sendOwnerNotification(name: string, email: string, serverIp: string, domain: string): Promise<boolean>;
export declare function sendPasswordResetEmail(to: string, resetUrl: string, appName?: string): Promise<boolean>;
export declare function sendUpdateNotification(to: string, version: string, changelogUrl?: string): Promise<boolean>;
//# sourceMappingURL=emailService.d.ts.map