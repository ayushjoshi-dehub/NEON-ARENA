
import React, { useState } from "react";
import Lobby from "./components/Lobby";
import RaceGame from "./components/RaceGame";
import SoccerGame from "./components/SoccerGame";
import TennisGame from "./components/TennisGame";
import VolleyballGame from "./components/VolleyballGame";
import CarRacingGame from "./components/CarRacingGame";
import TicTacToeGame from "./components/TicTacToeGame";
import { GameMode } from "./types";
import { Gamepad2, Info, Github } from "lucide-react";

export default function App() {
  const [appState, setAppState] = useState<"lobby" | "playing">("lobby");
  const [selectedGame, setSelectedGame] = useState<GameMode | null>(null);

  // Connection metadata
  const [isOnline, setIsOnline] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [p1Name, setP1Name] = useState("Player 1");
  const [p2Name, setP2Name] = useState("Player 2");

  // Callback to launch local gameplay
  const handleStartLocalGame = (p1: string, p2: string, mode: GameMode) => {
    setP1Name(p1 || "Player 1");
    setP2Name(p2 || "Player 2");
    setSelectedGame(mode);
    setIsOnline(false);
    setIsHost(true);
    setAppState("playing");
  };

  // Callback to launch online peer-to-peer gameplay via WebSockets
  const handleStartOnlineGame = (
    ws: WebSocket,
    roomId: string,
    playerId: string,
    p1: string,
    p2: string,
    isRoomHost: boolean,
    mode: GameMode
  ) => {
    setSocket(ws);
    setP1Name(p1 || "Player 1");
    setP2Name(p2 || "Player 2");
    setSelectedGame(mode);
    setIsOnline(true);
    setIsHost(isRoomHost);
    setAppState("playing");
  };

  // Return from playing to main lobby
  const handleQuitGame = () => {
    setAppState("lobby");
    // Note: We intentionally do NOT close the socket here so that players stay connected
    // inside their active WebSocket room and can choose a different game mode or start again!
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col justify-between font-sans selection:bg-cyan-500 selection:text-black">
      {/* Top Navigation Bar */}
      <header className="border-b border-zinc-900 bg-black/40 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3.5 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-gradient-to-br from-cyan-500 to-purple-500 rounded-lg">
              <Gamepad2 className="w-5 h-5 text-black" />
            </div>
            <div>
              <span className="font-extrabold tracking-widest text-sm font-mono block">
                NEON ARCADE
              </span>
              <span className="text-[10px] text-zinc-500 font-mono">MULTIPLAYER SPORTS GATEWAY</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] text-zinc-400 font-mono bg-zinc-900 px-2.5 py-1 rounded-full border border-zinc-800">
              <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-pulse" />
              STATUS: SYNC ENGINE ONLINE
            </span>
          </div>
        </div>
      </header>

      {/* Main Content Box (Responsive stage container) */}
      <main className="flex-1 flex items-center justify-center py-6 md:py-10 px-4">
        {appState === "lobby" ? (
          <Lobby onStartLocalGame={handleStartLocalGame} onStartOnlineGame={handleStartOnlineGame} />
        ) : (
          <div className="w-full flex justify-center items-center animate-fade-in" id="active-sports-canvas">
            {selectedGame === "race" && (
              <RaceGame
                isOnline={isOnline}
                isHost={isHost}
                socket={socket}
                p1Name={p1Name}
                p2Name={p2Name}
                onQuit={handleQuitGame}
              />
            )}

            {selectedGame === "soccer" && (
              <SoccerGame
                isOnline={isOnline}
                isHost={isHost}
                socket={socket}
                p1Name={p1Name}
                p2Name={p2Name}
                onQuit={handleQuitGame}
              />
            )}

            {selectedGame === "tennis" && (
              <TennisGame
                isOnline={isOnline}
                isHost={isHost}
                socket={socket}
                p1Name={p1Name}
                p2Name={p2Name}
                onQuit={handleQuitGame}
              />
            )}

            {selectedGame === "volley" && (
              <VolleyballGame
                isOnline={isOnline}
                isHost={isHost}
                socket={socket}
                p1Name={p1Name}
                p2Name={p2Name}
                onQuit={handleQuitGame}
              />
            )}

            {selectedGame === "car" && (
              <CarRacingGame
                isOnline={isOnline}
                isHost={isHost}
                socket={socket}
                p1Name={p1Name}
                p2Name={p2Name}
                onQuit={handleQuitGame}
              />
            )}

            {selectedGame === "tictactoe" && (
              <TicTacToeGame
                isOnline={isOnline}
                isHost={isHost}
                socket={socket}
                p1Name={p1Name}
                p2Name={p2Name}
                onQuit={handleQuitGame}
              />
            )}
          </div>
        )}
      </main>

      {/* Retro Footnote */}
      <footer className="border-t border-zinc-900 py-4 bg-black/60">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-3 text-center md:text-left">
          <p className="text-[10px] text-zinc-500 font-mono">
            Designed with absolute zero-lag WebSockets & split-screen layouts. Perfect for same-screen keys or peer-to-peer codes.
          </p>
          <div className="flex items-center gap-4">
            <span className="text-[10px] text-zinc-600 font-mono">
              © 2026 NEON ARCADE CORE V3.0
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
