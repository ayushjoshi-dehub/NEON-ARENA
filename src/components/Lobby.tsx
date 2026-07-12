import React, { useState, useEffect } from "react";
import { GameMode, RoomState, NetworkPlayer, ChatMessage } from "../types";
import { Play, Plus, Key, Users, Sparkles, AlertCircle, RefreshCw, Volume2, Gamepad2, ArrowLeft } from "lucide-react";

interface LobbyProps {
  onStartLocalGame: (p1: string, p2: string, mode: GameMode) => void;
  onStartOnlineGame: (
    socket: WebSocket,
    roomId: string,
    playerId: string,
    p1Name: string,
    p2Name: string,
    isHost: boolean,
    mode: GameMode
  ) => void;
}

export default function Lobby({ onStartLocalGame, onStartOnlineGame }: LobbyProps) {
  // Navigation mode: "main" | "local_setup" | "online_lobby" | "join_setup" | "host_setup"
  const [navMode, setNavMode] = useState<"main" | "local_setup" | "online_lobby" | "join_setup">("main");

  // Local Game Setup state
  const [localP1, setLocalP1] = useState("Player 1");
  const [localP2, setLocalP2] = useState("Player 2");
  const [localGameMode, setLocalGameMode] = useState<GameMode>("race");

  // Online Connection / Nickname state
  const [nickname, setNickname] = useState("");
  const [roomIdInput, setRoomIdInput] = useState("");
  const [socket, setSocket] = useState<WebSocket | null>(null);

  // Active Online Room details
  const [room, setRoom] = useState<RoomState>({
    roomId: "",
    playerId: "",
    playerName: "",
    players: [],
    gameMode: null,
    readyStates: {},
    allReady: false,
    status: "idle",
    error: null,
  });

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  // Resolve current host WebSocket protocol dynamically
  const getWebSocketUrl = () => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws`;
  };

  // Close socket on unmount
  useEffect(() => {
    return () => {
      if (socket) {
        socket.close();
      }
    };
  }, [socket]);

  // Connect to WS and send initial event
  const connectAndSend = (
    actionType: "create" | "join",
    targetRoomCode?: string,
    userNick?: string
  ) => {
    const wsUrl = getWebSocketUrl();
    const finalNick = (userNick || nickname || (actionType === "create" ? "Host" : "Guest")).trim();
    
    // Set loading state
    setRoom((prev) => ({
      ...prev,
      status: actionType === "create" ? "creating" : "joining",
      error: null,
    }));

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setSocket(ws);
      if (actionType === "create") {
        ws.send(
          JSON.stringify({
            type: "room:create",
            payload: { playerName: finalNick },
          })
        );
      } else {
        ws.send(
          JSON.stringify({
            type: "room:join",
            payload: {
              roomId: (targetRoomCode || roomIdInput).toUpperCase().trim(),
              playerName: finalNick,
            },
          })
        );
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const { type, payload } = msg;

        switch (type) {
          case "room:created": {
            setRoom({
              roomId: payload.roomId,
              playerId: payload.playerId,
              playerName: payload.playerName,
              players: payload.players,
              gameMode: null,
              readyStates: { [payload.playerId]: false },
              allReady: false,
              status: "connected",
              error: null,
            });
            setNavMode("online_lobby");
            break;
          }

          case "room:joined": {
            setRoom({
              roomId: payload.roomId,
              playerId: payload.playerId,
              playerName: payload.playerName,
              players: payload.players,
              gameMode: payload.gameMode,
              readyStates: payload.readyStates,
              allReady: false,
              status: "connected",
              error: null,
            });
            setNavMode("online_lobby");
            break;
          }

          case "room:peer_joined": {
            setRoom((prev) => ({
              ...prev,
              players: payload.players,
              readyStates: payload.readyStates,
            }));
            break;
          }

          case "room:peer_left": {
            setRoom((prev) => ({
              ...prev,
              players: payload.players,
              readyStates: payload.readyStates,
            }));
            break;
          }

          case "room:error": {
            setRoom((prev) => ({
              ...prev,
              status: "idle",
              error: payload.message,
            }));
            ws.close();
            setSocket(null);
            break;
          }

          case "game:selected": {
            setRoom((prev) => ({
              ...prev,
              gameMode: payload.gameMode,
              readyStates: payload.readyStates,
              allReady: false,
            }));
            break;
          }

          case "game:ready_update": {
            setRoom((prev) => ({
              ...prev,
              readyStates: payload.readyStates,
              allReady: payload.allReady,
            }));
            break;
          }

          case "game:start": {
            // Trigger actual game starting on the parent component!
            const isHost = room.players.find((p) => p.id === room.playerId)?.isHost || false;
            const p1 = room.players.find((p) => p.isHost)?.name || "Player 1";
            const p2 = room.players.find((p) => !p.isHost)?.name || "Player 2";
            
            // Invoke callback to parent component
            onStartOnlineGame(ws, room.roomId, room.playerId, p1, p2, isHost, payload.gameMode);
            break;
          }

          case "chat:message": {
            setChatMessages((prev) => [...prev, payload]);
            break;
          }
        }
      } catch (err) {
        console.error("Error processing websocket message:", err);
      }
    };

    ws.onclose = () => {
      setSocket(null);
      setRoom((prev) => ({
        ...prev,
        status: "disconnected",
      }));
    };

    ws.onerror = () => {
      setRoom((prev) => ({
        ...prev,
        status: "idle",
        error: "WebSocket connection failed. Ensure server is online.",
      }));
    };
  };

  // Host triggers game mode selection
  const handleSelectGameMode = (mode: GameMode) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "game:select",
          payload: { gameMode: mode },
        })
      );
    }
  };

  // Player toggles ready state
  const handleToggleReady = () => {
    const isCurrentlyReady = !!room.readyStates[room.playerId];
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "game:ready",
          payload: { ready: !isCurrentlyReady },
        })
      );
    }
  };

  // Send Chat banter
  const handleSendChat = (messageText: string) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "chat:send",
          payload: { message: messageText },
        })
      );
    }
  };

  const handleDisconnect = () => {
    if (socket) {
      socket.close();
    }
    setSocket(null);
    setRoom({
      roomId: "",
      playerId: "",
      playerName: "",
      players: [],
      gameMode: null,
      readyStates: {},
      allReady: false,
      status: "idle",
      error: null,
    });
    setChatMessages([]);
    setNavMode("main");
  };

  // Helper check
  const isHostPlayer = room.players.find((p) => p.id === room.playerId)?.isHost || false;
  const otherPlayer = room.players.find((p) => p.id !== room.playerId);

  return (
    <div className="flex flex-col items-center justify-center p-4 min-h-[600px] bg-zinc-950 text-white w-full max-w-4xl mx-auto rounded-3xl border border-zinc-900 shadow-2xl relative overflow-hidden" id="arcade-cabinet-lobby">
      {/* Background Cyber Glow Grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f293710_1px,transparent_1px),linear-gradient(to_bottom,#1f293710_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] pointer-events-none" />

      {/* VIEW: MAIN MENUs */}
      {navMode === "main" && (
        <div className="text-center max-w-lg z-10 py-10 px-6">
          <Gamepad2 className="w-16 h-16 text-cyan-400 mx-auto animate-pulse mb-4" />
          <h1 className="text-4xl md:text-5xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-purple-400 to-rose-400 mb-2">
            NEON ARENA
          </h1>
          <p className="text-xs md:text-sm text-zinc-400 font-mono tracking-wider uppercase mb-8">
            Fast-Paced 2-Player Arcade Multiverse
          </p>

          <div className="flex flex-col gap-4 w-full">
            <button
              id="btn-play-local"
              onClick={() => setNavMode("local_setup")}
              className="group relative flex items-center justify-center gap-3 px-6 py-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-cyan-500 rounded-xl transition-all duration-300 hover:scale-[1.02] shadow-lg overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <Users className="w-5 h-5 text-cyan-400 group-hover:rotate-12 transition-transform" />
              <div className="text-left">
                <span className="block font-bold text-white text-base">PLAY LOCALLY</span>
                <span className="block text-[10px] text-zinc-400 font-sans">Shared keyboard, split screens</span>
              </div>
            </button>

            <button
              id="btn-play-online"
              onClick={() => {
                setNickname("");
                setNavMode("join_setup");
              }}
              className="group relative flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-purple-900/40 to-indigo-900/40 hover:from-purple-900/60 hover:to-indigo-900/60 border border-purple-800/80 hover:border-purple-400 rounded-xl transition-all duration-300 hover:scale-[1.02] shadow-lg overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-purple-500/15 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <Sparkles className="w-5 h-5 text-purple-400 group-hover:animate-spin transition-transform" />
              <div className="text-left">
                <span className="block font-bold text-white text-base">ONLINE MULTIPLAYER</span>
                <span className="block text-[10px] text-zinc-400 font-sans">Real-time room session IDs</span>
              </div>
            </button>
          </div>

          <div className="mt-12 p-3 bg-zinc-950 rounded-lg border border-zinc-900 inline-flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 bg-green-500 rounded-full animate-ping" />
            <span className="text-[10px] text-zinc-400 font-mono uppercase">Vapor Engine Server Ready</span>
          </div>
        </div>
      )}

      {/* VIEW: LOCAL PLAYERS SETUP */}
      {navMode === "local_setup" && (
        <div className="w-full max-w-md z-10 px-4">
          <button
            onClick={() => setNavMode("main")}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white mb-6 transition"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Main
          </button>

          <h2 className="text-2xl font-bold text-cyan-400 mb-6 font-mono tracking-wider">
            LOCAL TOURNAMENT REGISTRATION
          </h2>

          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-xs text-zinc-400 uppercase font-mono mb-1.5">Player 1 Name (Left)</label>
              <input
                id="local-p1-name"
                type="text"
                value={localP1}
                onChange={(e) => setLocalP1(e.target.value.substring(0, 12))}
                maxLength={12}
                className="w-full bg-zinc-900 border border-zinc-800 focus:border-cyan-500 focus:outline-none rounded-lg px-4 py-2.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 uppercase font-mono mb-1.5">Player 2 Name (Right)</label>
              <input
                id="local-p2-name"
                type="text"
                value={localP2}
                onChange={(e) => setLocalP2(e.target.value.substring(0, 12))}
                maxLength={12}
                className="w-full bg-zinc-900 border border-zinc-800 focus:border-purple-500 focus:outline-none rounded-lg px-4 py-2.5 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs text-zinc-400 uppercase font-mono mb-2">Select Arena Sport</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <button
                  id="select-mode-race"
                  onClick={() => setLocalGameMode("race")}
                  className={`py-2 px-3 rounded-lg border text-xs font-mono transition ${
                    localGameMode === "race"
                      ? "bg-cyan-950 border-cyan-400 text-cyan-300"
                      : "bg-zinc-900 border-zinc-800 hover:border-zinc-700 text-zinc-400"
                  }`}
                >
                  🏃 Speedway
                </button>
                <button
                  id="select-mode-soccer"
                  onClick={() => setLocalGameMode("soccer")}
                  className={`py-2 px-3 rounded-lg border text-xs font-mono transition ${
                    localGameMode === "soccer"
                      ? "bg-green-950 border-green-500 text-green-300"
                      : "bg-zinc-900 border-zinc-800 hover:border-zinc-700 text-zinc-400"
                  }`}
                >
                  ⚽ Football
                </button>
                <button
                  id="select-mode-tennis"
                  onClick={() => setLocalGameMode("tennis")}
                  className={`py-2 px-3 rounded-lg border text-xs font-mono transition ${
                    localGameMode === "tennis"
                      ? "bg-rose-950 border-rose-500 text-rose-300"
                      : "bg-zinc-900 border-zinc-800 hover:border-zinc-700 text-zinc-400"
                  }`}
                >
                  🏓 Pong
                </button>
                <button
                  id="select-mode-volley"
                  onClick={() => setLocalGameMode("volley")}
                  className={`py-2 px-3 rounded-lg border text-xs font-mono transition ${
                    localGameMode === "volley"
                      ? "bg-indigo-950 border-indigo-500 text-indigo-300"
                      : "bg-zinc-900 border-zinc-800 hover:border-zinc-700 text-zinc-400"
                  }`}
                >
                  🏐 Volleyball
                </button>
                <button
                  id="select-mode-car"
                  onClick={() => setLocalGameMode("car")}
                  className={`py-2 px-3 rounded-lg border text-xs font-mono transition ${
                    localGameMode === "car"
                      ? "bg-emerald-950 border-emerald-500 text-emerald-300"
                      : "bg-zinc-900 border-zinc-800 hover:border-zinc-700 text-zinc-400"
                  }`}
                >
                  🏎️ Car Racing
                </button>
                <button
                  id="select-mode-tictactoe"
                  onClick={() => setLocalGameMode("tictactoe")}
                  className={`py-2 px-3 rounded-lg border text-xs font-mono transition ${
                    localGameMode === "tictactoe"
                      ? "bg-amber-950 border-amber-500 text-amber-300"
                      : "bg-zinc-900 border-zinc-800 hover:border-zinc-700 text-zinc-400"
                  }`}
                >
                  ✕ Tic-Tac-Toe
                </button>
              </div>
            </div>
          </div>

          <button
            id="btn-start-local"
            onClick={() => onStartLocalGame(localP1, localP2, localGameMode)}
            className="w-full flex items-center justify-center gap-2 py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-bold tracking-wider rounded-xl hover:scale-105 active:scale-95 transition"
          >
            <Play className="w-5 h-5 fill-current" />
            ENTER NEON ARENA
          </button>
        </div>
      )}

      {/* VIEW: ONLINE MULTIPLAYER SETUP */}
      {navMode === "join_setup" && (
        <div className="w-full max-w-md z-10 px-4">
          <button
            onClick={() => setNavMode("main")}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white mb-6 transition"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Main
          </button>

          <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-indigo-400 mb-6 font-mono tracking-wider">
            GRID COORDINATES LOBBY
          </h2>

          {room.error && (
            <div className="mb-4 p-3 bg-red-950/40 border border-red-900 text-red-200 rounded-lg text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{room.error}</span>
            </div>
          )}

          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-xs text-zinc-400 uppercase font-mono mb-1.5">Your Cyber Nickname</label>
              <input
                id="online-nickname"
                type="text"
                placeholder="Enter nickname..."
                value={nickname}
                onChange={(e) => setNickname(e.target.value.substring(0, 12))}
                maxLength={12}
                className="w-full bg-zinc-900 border border-zinc-800 focus:border-purple-500 focus:outline-none rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600"
              />
            </div>

            <div className="border-t border-zinc-900 pt-4 mt-2">
              <div className="grid grid-cols-2 gap-4">
                {/* HOST Option */}
                <button
                  id="btn-create-session"
                  onClick={() => connectAndSend("create")}
                  disabled={room.status === "creating"}
                  className="flex flex-col items-center justify-center p-4 bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 hover:border-cyan-500 rounded-xl transition group text-center"
                >
                  <Plus className="w-6 h-6 text-cyan-400 mb-2 group-hover:scale-110 transition" />
                  <span className="block text-xs font-bold font-mono">HOST NEW ROOM</span>
                  <span className="block text-[8px] text-zinc-500 mt-0.5">Creates a Room ID</span>
                </button>

                {/* JOIN Option */}
                <div className="flex flex-col p-3 bg-zinc-900 border border-zinc-800 rounded-xl justify-between">
                  <span className="block text-[10px] text-zinc-400 font-bold font-mono uppercase text-center mb-1.5">JOIN BY ROOM ID</span>
                  <input
                    id="join-room-id"
                    type="text"
                    placeholder="ABCD"
                    value={roomIdInput}
                    onChange={(e) => setRoomIdInput(e.target.value.substring(0, 4).toUpperCase())}
                    className="w-full bg-zinc-950 border border-zinc-800 text-center font-mono font-bold text-white text-sm py-1.5 rounded-lg focus:outline-none focus:border-purple-500 tracking-wider mb-2 placeholder-zinc-700"
                  />
                  <button
                    id="btn-join-session"
                    onClick={() => connectAndSend("join")}
                    disabled={!roomIdInput.trim() || room.status === "joining"}
                    className="w-full py-1.5 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs rounded-lg transition"
                  >
                    JOIN ROOM
                  </button>
                </div>
              </div>
            </div>
          </div>

          {(room.status === "creating" || room.status === "joining") && (
            <div className="flex items-center justify-center gap-2 text-xs text-zinc-400 font-mono py-2">
              <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
              <span>Connecting Grid Server...</span>
            </div>
          )}
        </div>
      )}

      {/* VIEW: ONLINE MULTIPLAYER LOBBY (WAITING SCREEN) */}
      {navMode === "online_lobby" && (
        <div className="w-full z-10 grid grid-cols-1 md:grid-cols-3 gap-6 p-4">
          {/* Column 1 & 2: Room Lobby Info */}
          <div className="md:col-span-2 flex flex-col justify-between">
            <div>
              {/* Back out button */}
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-1 text-xs text-zinc-500 hover:text-white mb-4 transition"
              >
                <ArrowLeft className="w-4 h-4" /> Leave Lobby
              </button>

              <div className="flex items-center gap-3 mb-4">
                <span className="px-3 py-1 bg-cyan-950 text-cyan-300 font-mono text-xs rounded-full border border-cyan-800">
                  ROOM ID: <span className="font-bold text-white">{room.roomId}</span>
                </span>
                <span className="text-[10px] text-zinc-500 font-mono">
                  Share this ID for online match
                </span>
              </div>

              <h2 className="text-2xl font-bold tracking-tight mb-6">
                CYBER DOCKING ARENA
              </h2>

              {/* Connected Players Status */}
              <div className="space-y-3 mb-6">
                <h3 className="text-xs text-zinc-400 uppercase font-mono">Registered Combatants</h3>
                <div className="grid grid-cols-2 gap-3">
                  {/* Player 1 Details */}
                  {room.players.map((p) => {
                    const isMe = p.id === room.playerId;
                    const isReady = !!room.readyStates[p.id];
                    return (
                      <div
                        key={p.id}
                        className={`p-3 rounded-xl border flex flex-col justify-between h-[80px] ${
                          p.isHost
                            ? "bg-cyan-950/20 border-cyan-800/40"
                            : "bg-purple-950/20 border-purple-800/40"
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <span className="font-bold text-sm block truncate pr-2">
                            {p.name} {isMe && <span className="text-[9px] text-zinc-500">(You)</span>}
                          </span>
                          <span className="text-[9px] text-zinc-500 uppercase font-mono">
                            {p.isHost ? "Host 👑" : "Challenger"}
                          </span>
                        </div>
                        <div className="flex justify-between items-center mt-2">
                          <span className={`text-[10px] font-mono font-bold ${isReady ? "text-green-400" : "text-yellow-400 animate-pulse"}`}>
                            ● {isReady ? "READY" : "NOT READY"}
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  {/* Empty Slot */}
                  {room.players.length < 2 && (
                    <div className="p-3 bg-zinc-900/40 border border-dashed border-zinc-800 rounded-xl flex flex-col justify-center items-center h-[80px] text-zinc-500 text-xs text-center">
                      <RefreshCw className="w-4 h-4 animate-spin text-purple-500 mb-1" />
                      <span>Waiting for Challenger...</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Game selection - Only Host Controls */}
              <div className="bg-zinc-900/50 border border-zinc-900 rounded-xl p-4 mb-4">
                <h3 className="text-xs text-zinc-400 uppercase font-mono mb-3">
                  {isHostPlayer ? "👑 select game type (Host Control)" : "🛡️ SELECTED GAME TYPE"}
                </h3>
                
                {isHostPlayer ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <button
                      id="lobby-mode-race"
                      onClick={() => handleSelectGameMode("race")}
                      className={`py-2 px-3 rounded-lg border text-xs font-mono transition ${
                        room.gameMode === "race"
                          ? "bg-cyan-950 border-cyan-400 text-cyan-300 font-bold"
                          : "bg-zinc-950 border-zinc-900 hover:border-zinc-800 text-zinc-400"
                      }`}
                    >
                      🏃 Speedway
                    </button>
                    <button
                      id="lobby-mode-soccer"
                      onClick={() => handleSelectGameMode("soccer")}
                      className={`py-2 px-3 rounded-lg border text-xs font-mono transition ${
                        room.gameMode === "soccer"
                          ? "bg-green-950 border-green-500 text-green-300 font-bold"
                          : "bg-zinc-950 border-zinc-900 hover:border-zinc-800 text-zinc-400"
                      }`}
                    >
                      ⚽ Football
                    </button>
                    <button
                      id="lobby-mode-tennis"
                      onClick={() => handleSelectGameMode("tennis")}
                      className={`py-2 px-3 rounded-lg border text-xs font-mono transition ${
                        room.gameMode === "tennis"
                          ? "bg-rose-950 border-rose-500 text-rose-300 font-bold"
                          : "bg-zinc-950 border-zinc-900 hover:border-zinc-800 text-zinc-400"
                      }`}
                    >
                      🏓 Pong
                    </button>
                    <button
                      id="lobby-mode-volley"
                      onClick={() => handleSelectGameMode("volley")}
                      className={`py-2 px-3 rounded-lg border text-xs font-mono transition ${
                        room.gameMode === "volley"
                          ? "bg-indigo-950 border-indigo-500 text-indigo-300 font-bold"
                          : "bg-zinc-950 border-zinc-900 hover:border-zinc-800 text-zinc-400"
                      }`}
                    >
                      🏐 Volley
                    </button>
                    <button
                      id="lobby-mode-car"
                      onClick={() => handleSelectGameMode("car")}
                      className={`py-2 px-3 rounded-lg border text-xs font-mono transition ${
                        room.gameMode === "car"
                          ? "bg-emerald-950 border-emerald-500 text-emerald-300 font-bold"
                          : "bg-zinc-950 border-zinc-900 hover:border-zinc-800 text-zinc-400"
                      }`}
                    >
                      🏎️ Racing
                    </button>
                    <button
                      id="lobby-mode-tictactoe"
                      onClick={() => handleSelectGameMode("tictactoe")}
                      className={`py-2 px-3 rounded-lg border text-xs font-mono transition ${
                        room.gameMode === "tictactoe"
                          ? "bg-amber-950 border-amber-500 text-amber-300 font-bold"
                          : "bg-zinc-950 border-zinc-900 hover:border-zinc-800 text-zinc-400"
                      }`}
                    >
                      ✕ TicTacToe
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-2 border border-zinc-800 bg-zinc-950 rounded-lg">
                    <span className="text-sm font-bold font-mono text-cyan-300 uppercase">
                      {room.gameMode
                        ? `🎮 ${
                            room.gameMode === "race"
                              ? "NEON SPEEDWAY"
                              : room.gameMode === "soccer"
                              ? "ARCADE FOOTBALL"
                              : room.gameMode === "tennis"
                              ? "HYPER TABLE TENNIS"
                              : room.gameMode === "volley"
                              ? "CYBER VOLLEYBALL"
                              : room.gameMode === "car"
                              ? "CYBER HIGHWAY CAR RACING"
                              : "NEON BLITZ TIC-TAC-TOE"
                          }`
                        : "⌛ Waiting for host selection..."}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Action Ready / Start Button */}
            <div className="mt-4">
              {room.players.length < 2 ? (
                <div className="w-full text-center text-xs text-zinc-500 font-mono py-2 italic border border-zinc-900 rounded-lg">
                  Lobby requires 2 players to start a synchronization.
                </div>
              ) : (
                <button
                  id="btn-online-ready"
                  onClick={handleToggleReady}
                  disabled={!room.gameMode}
                  className={`w-full py-3.5 rounded-xl font-bold tracking-widest text-sm transition-all duration-200 hover:scale-[1.01] ${
                    !room.gameMode
                      ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                      : room.readyStates[room.playerId]
                      ? "bg-green-600 hover:bg-green-500 text-white shadow-green-950/50 shadow-md"
                      : "bg-yellow-500 hover:bg-yellow-400 text-black shadow-lg"
                  }`}
                >
                  {!room.gameMode
                    ? "WAITING FOR GAME MODE..."
                    : room.readyStates[room.playerId]
                    ? "YOU ARE READY! (WAITING)"
                    : "TAP TO DECLARE READY"}
                </button>
              )}
            </div>
          </div>

          {/* Column 3: Live Chat Banter */}
          <div>
            <Chat messages={chatMessages} onSendMessage={handleSendChat} myPlayerId={room.playerId} />
          </div>
        </div>
      )}
    </div>
  );
}

// Subcomponent: Chat
import Chat from "./Chat";
