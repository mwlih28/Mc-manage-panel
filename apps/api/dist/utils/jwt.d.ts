import { JwtPayload } from '../types';
export declare function generateAccessToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string;
export declare function generateRefreshToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string;
export declare function verifyAccessToken(token: string): JwtPayload;
export declare function verifyRefreshToken(token: string): JwtPayload;
export declare function generateTokenPair(payload: Omit<JwtPayload, 'iat' | 'exp'>): {
    accessToken: string;
    refreshToken: string;
};
//# sourceMappingURL=jwt.d.ts.map