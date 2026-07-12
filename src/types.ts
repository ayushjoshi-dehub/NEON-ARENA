export type GameMode = "race" | "soccer" | "tennis" | "volley" | "car" | "tictactoe";

export interface NetworkPlayer {
  id: string;
  name: string;
  isHost: boolean;
}

export interface RoomState {
  roomId: string;
  playerId: string;
  playerName: string;
  players: NetworkPlayer[];
  gameMode: GameMode | null;
  readyStates: Record<string, boolean>;
  allReady: boolean;
  status: "idle" | "creating" | "joining" | "connected" | "playing" | "disconnected";
  error: string | null;
}

export interface ChatMessage {
  senderId: string;
  senderName: string;
  message: string;
  timestamp: number;
}

// 1. Obstacle Race Types
export interface RaceObstacle {
  id: string;
  x: number; // Percentage or pixels (0 to 1000+)
  type: "low_spike" | "high_barrier" | "battery"; // Jump over, slide under, or collect for points/boost
  collected?: boolean;
}

export interface RacePlayerState {
  x: number;
  y: number;
  isJumping: boolean;
  isDucking: boolean;
  score: number;
  speed: number;
  distance: number; // 0 to 100%
  finished: boolean;
  finishTime?: number;
  activePowerup?: "shield" | "boost" | null;
  powerupTimer?: number;
  stunTimer?: number;
}

// 2. Soccer Types
export interface SoccerBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export interface SoccerPlayerState {
  x: number;
  y: number;
  radius: number;
  score: number;
  speed: number;
}

// 3. Table Tennis Types
export interface TennisBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export interface TennisPaddle {
  y: number;
  width: number;
  height: number;
  score: number;
}
