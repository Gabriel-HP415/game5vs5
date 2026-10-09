// Type declaration shim for colyseus.js 0.15.x.
//
// The upstream package ships types at `lib/index.d.ts` but its
// `package.json` `exports` field doesn't expose them. We re-declare
// the public surface we use so consumers get proper types.
declare module "colyseus.js" {
  export class Client {
    constructor(endpoint: string | { url: string });
    joinOrCreate<T = any>(roomName: string, options?: any): Promise<Room<T>>;
    create<T = any>(roomName: string, options?: any): Promise<Room<T>>;
    join<T = any>(roomName: string, options?: any): Promise<Room<T>>;
    joinById<T = any>(roomId: string, options?: any): Promise<Room<T>>;
    getAvailableRooms(roomName: string, options?: any): Promise<any[]>;
  }
  export class Room<State = any> {
    roomId: string;
    sessionId: string;
    state: State;
    name: string;
    send(type: string | number, message?: any): void;
    onMessage(type: "*", callback: (type: string | number, message: any) => void): void;
    onMessage(type: string | number, callback: (message: any) => void): void;
    onStateChange(callback: (state: State) => void): void;
    onLeave(callback: (code: number, reason?: string) => void): void;
    onError(callback: (code: number, message?: string) => void): void;
    leave(consented?: boolean): void;
  }
  export class SchemaSerializer {}
  export function registerSerializer(): void;
}
