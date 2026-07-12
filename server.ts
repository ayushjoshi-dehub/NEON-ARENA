import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Player {
  id: string;
  name: string;
  ws: WebSocket;
  isHost: boolean;
}

interface Room {
  id: string;
  players: Player[];
  gameMode: "race" | "soccer" | "tennis" | "volley" | "car" | "tictactoe" | null;
  readyStates: Record<string, boolean>;
}

// Global server state
const rooms = new Map<string, Room>();
// Map of WebSocket to player details
const wsToPlayer = new Map<WebSocket, { roomId: string; playerId: string }>();

function generateRoomId(): string {
  const chars = "ABCDEFGHIJKLMNPQRSTUVWXYZ123456789"; // Omitted 'O' and '0' for readability
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  if (rooms.has(code)) {
    return generateRoomId(); // Recurse on collision
  }
  return code;
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = 3000;

  // 1. HTTP API Routes (Optional status checks)
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", activeRooms: rooms.size });
  });

  // 2. WebSocket Server attached to the same HTTP server
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const { pathname } = new URL(request.url || "", `http://${request.headers.host}`);
    if (pathname === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws: WebSocket) => {
    const playerId = `p_${Math.random().toString(36).substring(2, 9)}`;

    ws.on("message", (message: string) => {
      try {
        const data = JSON.parse(message);
        const { type, payload } = data;

        switch (type) {
          case "room:create": {
            const { playerName } = payload || {};
            const roomId = generateRoomId();
            
            const newRoom: Room = {
              id: roomId,
              players: [
                {
                  id: playerId,
                  name: playerName || "Player 1",
                  ws,
                  isHost: true,
                },
              ],
              gameMode: null,
              readyStates: { [playerId]: false },
            };

            rooms.set(roomId, newRoom);
            wsToPlayer.set(ws, { roomId, playerId });

            ws.send(
              JSON.stringify({
                type: "room:created",
                payload: {
                  roomId,
                  playerId,
                  playerName: playerName || "Player 1",
                  players: [{ id: playerId, name: playerName || "Player 1", isHost: true }],
                },
              })
            );
            console.log(`Room ${roomId} created by Player ${playerId}`);
            break;
          }

          case "room:join": {
            const { roomId, playerName } = payload || {};
            const targetRoomId = (roomId || "").toUpperCase().trim();
            const room = rooms.get(targetRoomId);

            if (!room) {
              ws.send(
                JSON.stringify({
                  type: "room:error",
                  payload: { message: `Room ${targetRoomId} not found.` },
                })
              );
              return;
            }

            if (room.players.length >= 2) {
              ws.send(
                JSON.stringify({
                  type: "room:error",
                  payload: { message: `Room ${targetRoomId} is full.` },
                })
              );
              return;
            }

            const name = playerName || `Player 2`;
            const newPlayer: Player = {
              id: playerId,
              name,
              ws,
              isHost: false,
            };

            room.players.push(newPlayer);
            room.readyStates[playerId] = false;
            wsToPlayer.set(ws, { roomId: targetRoomId, playerId });

            // Notify joiner
            ws.send(
              JSON.stringify({
                type: "room:joined",
                payload: {
                  roomId: targetRoomId,
                  playerId,
                  playerName: name,
                  gameMode: room.gameMode,
                  players: room.players.map((p) => ({ id: p.id, name: p.name, isHost: p.isHost })),
                  readyStates: room.readyStates,
                },
              })
            );

            // Notify host (other player)
            const host = room.players.find((p) => p.id !== playerId);
            if (host) {
              host.ws.send(
                JSON.stringify({
                  type: "room:peer_joined",
                  payload: {
                    peerId: playerId,
                    peerName: name,
                    players: room.players.map((p) => ({ id: p.id, name: p.name, isHost: p.isHost })),
                    readyStates: room.readyStates,
                  },
                })
              );
            }
            console.log(`Player ${playerId} joined Room ${targetRoomId}`);
            break;
          }

          case "game:select": {
            const playerInfo = wsToPlayer.get(ws);
            if (!playerInfo) return;
            const { roomId, playerId: pId } = playerInfo;
            const room = rooms.get(roomId);
            if (!room) return;

            // Only host can select game mode
            const player = room.players.find((p) => p.id === pId);
            if (!player || !player.isHost) return;

            const { gameMode } = payload || {};
            room.gameMode = gameMode;
            
            // Reset ready states on game change
            room.players.forEach((p) => {
              room.readyStates[p.id] = false;
            });

            // Broadcast to all players
            room.players.forEach((p) => {
              p.ws.send(
                JSON.stringify({
                  type: "game:selected",
                  payload: {
                    gameMode,
                    readyStates: room.readyStates,
                  },
                })
              );
            });
            break;
          }

          case "game:ready": {
            const playerInfo = wsToPlayer.get(ws);
            if (!playerInfo) return;
            const { roomId, playerId: pId } = playerInfo;
            const room = rooms.get(roomId);
            if (!room) return;

            const { ready } = payload || {};
            room.readyStates[pId] = !!ready;

            // Check if both players are ready
            const allReady = room.players.length === 2 && room.players.every((p) => room.readyStates[p.id]);

            // Broadcast ready states
            room.players.forEach((p) => {
              p.ws.send(
                JSON.stringify({
                  type: "game:ready_update",
                  payload: {
                    readyStates: room.readyStates,
                    allReady,
                  },
                })
              );
            });

            if (allReady && room.gameMode) {
              // Automatically start the game!
              room.players.forEach((p) => {
                p.ws.send(
                  JSON.stringify({
                    type: "game:start",
                    payload: {
                      gameMode: room.gameMode,
                    },
                  })
                );
              });
              console.log(`Game ${room.gameMode} starting in Room ${roomId}`);
            }
            break;
          }

          case "game:sync": {
            // Relays the state directly to the opponent
            const playerInfo = wsToPlayer.get(ws);
            if (!playerInfo) return;
            const { roomId, playerId: pId } = playerInfo;
            const room = rooms.get(roomId);
            if (!room) return;

            // Find other player
            const opponent = room.players.find((p) => p.id !== pId);
            if (opponent && opponent.ws.readyState === WebSocket.OPEN) {
              opponent.ws.send(
                JSON.stringify({
                  type: "game:sync",
                  payload,
                })
              );
            }
            break;
          }

          case "chat:send": {
            const playerInfo = wsToPlayer.get(ws);
            if (!playerInfo) return;
            const { roomId, playerId: pId } = playerInfo;
            const room = rooms.get(roomId);
            if (!room) return;

            const sender = room.players.find((p) => p.id === pId);
            if (!sender) return;

            const { message: chatMsg } = payload || {};
            room.players.forEach((p) => {
              p.ws.send(
                JSON.stringify({
                  type: "chat:message",
                  payload: {
                    senderId: pId,
                    senderName: sender.name,
                    message: chatMsg,
                    timestamp: Date.now(),
                  },
                })
              );
            });
            break;
          }

          default:
            console.log("Unhandled WebSocket message type:", type);
        }
      } catch (err) {
        console.error("Error parsing/handling WebSocket message:", err);
      }
    });

    ws.on("close", () => {
      const playerInfo = wsToPlayer.get(ws);
      if (!playerInfo) return;

      const { roomId, playerId: pId } = playerInfo;
      wsToPlayer.delete(ws);

      const room = rooms.get(roomId);
      if (!room) return;

      // Remove player
      room.players = room.players.filter((p) => p.id !== pId);
      delete room.readyStates[pId];

      if (room.players.length === 0) {
        rooms.delete(roomId);
        console.log(`Room ${roomId} destroyed (no players left)`);
      } else {
        // Elect new host if needed
        if (room.players.length > 0 && !room.players.some((p) => p.isHost)) {
          room.players[0].isHost = true;
        }

        // Notify remaining player
        room.players.forEach((p) => {
          p.ws.send(
            JSON.stringify({
              type: "room:peer_left",
              payload: {
                peerId: pId,
                players: room.players.map((pl) => ({ id: pl.id, name: pl.name, isHost: pl.isHost })),
                readyStates: room.readyStates,
              },
            })
          );
        });
        console.log(`Player ${pId} left Room ${roomId}. Notification sent to remaining players.`);
      }
    });
  });

  // 3. Vite middleware / Static serving
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
