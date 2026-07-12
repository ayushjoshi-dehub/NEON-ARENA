import React, { useEffect, useState, useRef } from "react";
import { RotateCcw, Volume2, VolumeX, LogOut, Award, RefreshCw, Info } from "lucide-react";

interface TicTacToeProps {
  isOnline: boolean;
  isHost: boolean;
  socket: WebSocket | null;
  p1Name: string;
  p2Name: string;
  onQuit: () => void;
}

export default function TicTacToeGame({ isOnline, isHost, socket, p1Name, p2Name, onQuit }: TicTacToeProps) {
  // Board state: Array of 9 strings (empty, "X", "O")
  const [board, setBoard] = useState<Array<string>>(["", "", "", "", "", "", "", "", ""]);
  
  // Who is currently active: "X" (Player 1) or "O" (Player 2)
  const [currentTurn, setCurrentTurn] = useState<"X" | "O">("X");
  
  const [winner, setWinner] = useState<"X" | "O" | "draw" | null>(null);
  const [scoreX, setScoreX] = useState(0);
  const [scoreO, setScoreO] = useState(0);

  const [muted, setMuted] = useState(true);
  
  // Turn timer (seconds left for current player)
  const [timeLeft, setTimeLeft] = useState(15);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Confetti particles reference
  const particlesRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; color: string; size: number; alpha: number }>>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Audio synthesizer helper
  const playSound = (type: "markX" | "markO" | "win" | "draw" | "click" | "timeout") => {
    if (muted) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === "markX") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(329.63, ctx.currentTime); // E4
        osc.frequency.exponentialRampToValueAtTime(523.25, ctx.currentTime + 0.15); // C5
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      } else if (type === "markO") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(392.00, ctx.currentTime); // G4
        osc.frequency.exponentialRampToValueAtTime(261.63, ctx.currentTime + 0.15); // C4
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      } else if (type === "win") {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
        osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1); // E5
        osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.2); // G5
        osc.frequency.setValueAtTime(1046.50, ctx.currentTime + 0.3); // C6
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.6);
        osc.start();
        osc.stop(ctx.currentTime + 0.6);
      } else if (type === "draw") {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(220.00, ctx.currentTime); // A3
        osc.frequency.setValueAtTime(196.00, ctx.currentTime + 0.15); // G3
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } else if (type === "timeout") {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(150, ctx.currentTime);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.4);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
      } else if (type === "click") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.05);
        osc.start();
        osc.stop(ctx.currentTime + 0.05);
      }
    } catch (e) {
      // Audio context fail gracefully
    }
  };

  const spawnWinParticles = () => {
    const colors = ["#06b6d4", "#c084fc", "#eab308", "#10b981", "#ef4444"];
    for (let i = 0; i < 50; i++) {
      particlesRef.current.push({
        x: Math.random() * 320,
        y: Math.random() * 320,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 8 - 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() * 5 + 3,
        alpha: 1,
      });
    }
  };

  // Particle updates loop
  useEffect(() => {
    let animFrame: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const updateParticles = () => {
      ctx.clearRect(0, 0, 320, 320);
      const parts = particlesRef.current;

      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.12; // gravity
        p.alpha -= 0.012;

        if (p.alpha <= 0 || p.x < 0 || p.x > 320 || p.y > 320) {
          parts.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      animFrame = requestAnimationFrame(updateParticles);
    };

    animFrame = requestAnimationFrame(updateParticles);
    return () => cancelAnimationFrame(animFrame);
  }, [winner]);

  // Handle Online message triggers
  useEffect(() => {
    if (!isOnline || !socket) return;

    const handleMessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "game:sync") {
          const payload = msg.payload;

          if (payload.action === "ttt_move") {
            const index = payload.index;
            const marker = payload.marker;
            
            setBoard((prev) => {
              const nb = [...prev];
              nb[index] = marker;
              checkWin(nb, marker);
              return nb;
            });

            // toggle turn and reset clock
            const nextMarker = marker === "X" ? "O" : "X";
            setCurrentTurn(nextMarker);
            setTimeLeft(15);
            playSound(marker === "X" ? "markX" : "markO");

          } else if (payload.action === "ttt_restart") {
            resetLocalBoard();
          }
        }
      } catch (err) {
        console.error("Error matching tictactoe sync message:", err);
      }
    };

    socket.addEventListener("message", handleMessage);
    return () => {
      socket.removeEventListener("message", handleMessage);
    };
  }, [isOnline, isHost, socket]);

  // Turn time countdown loop
  useEffect(() => {
    if (winner) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          // Timeout! Toggle turn or auto-select a random square
          playSound("timeout");
          autoMakeRandomMove();
          return 15;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [currentTurn, board, winner]);

  const autoMakeRandomMove = () => {
    // Collect all open spaces
    const available = board.map((val, idx) => (val === "" ? idx : null)).filter((v) => v !== null) as number[];
    if (available.length === 0) return;

    // Pick a random index
    const randomIdx = available[Math.floor(Math.random() * available.length)];
    
    // Check if it's our turn to broadcast, or in local mode
    if (isOnline) {
      const isOurTurn = (currentTurn === "X" && isHost) || (currentTurn === "O" && !isHost);
      if (!isOurTurn) return; // Only the active online player can write their auto move
    }

    handleSquareClick(randomIdx, true);
  };

  const checkWin = (tempBoard: Array<string>, lastMarker: "X" | "O") => {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
      [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
      [0, 4, 8], [2, 4, 6]             // diagonals
    ];

    for (const line of lines) {
      const [a, b, c] = line;
      if (tempBoard[a] && tempBoard[a] === tempBoard[b] && tempBoard[a] === tempBoard[c]) {
        setWinner(lastMarker);
        if (lastMarker === "X") {
          setScoreX((s) => s + 1);
        } else {
          setScoreO((s) => s + 1);
        }
        playSound("win");
        spawnWinParticles();
        return true;
      }
    }

    // Draw check
    if (tempBoard.every((v) => v !== "")) {
      setWinner("draw");
      playSound("draw");
      return true;
    }

    return false;
  };

  const handleSquareClick = (index: number, isAuto = false) => {
    if (board[index] !== "" || winner) return;

    // In online mode, host is X, guest is O
    if (isOnline && !isAuto) {
      const isOurTurn = (currentTurn === "X" && isHost) || (currentTurn === "O" && !isHost);
      if (!isOurTurn) return; // ignore clicking on other player's turn
    }

    const marker = currentTurn;
    const newBoard = [...board];
    newBoard[index] = marker;
    setBoard(newBoard);

    // Play tone
    playSound(marker === "X" ? "markX" : "markO");

    // Broadcast move
    if (isOnline && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "game:sync",
          payload: {
            action: "ttt_move",
            index,
            marker,
          },
        })
      );
    }

    const wonOrEnded = checkWin(newBoard, marker);
    if (!wonOrEnded) {
      setCurrentTurn(marker === "X" ? "O" : "X");
      setTimeLeft(15);
    }
  };

  const resetLocalBoard = () => {
    setBoard(["", "", "", "", "", "", "", "", ""]);
    setCurrentTurn("X");
    setWinner(null);
    setTimeLeft(15);
    particlesRef.current = [];
  };

  const triggerRestart = () => {
    resetLocalBoard();
    if (isOnline && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "game:sync",
          payload: {
            action: "ttt_restart",
          },
        })
      );
    }
  };

  return (
    <div className="flex flex-col items-center bg-black p-4 rounded-2xl border border-zinc-900 shadow-2xl relative max-w-md w-full" id="tictactoe-cabinet">
      
      {/* Top Header */}
      <div className="w-full flex justify-between items-center bg-zinc-950/60 px-4 py-2.5 rounded-t-xl border-b border-zinc-900 mb-4">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-extrabold text-[10px] text-emerald-400 font-mono uppercase tracking-widest">
            🟢 NEON BLITZ TIC-TAC-TOE
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setMuted(!muted)}
            className="p-1 bg-zinc-900 hover:bg-zinc-800 rounded border border-zinc-800 transition"
            title={muted ? "Unmute sound" : "Mute sound"}
          >
            {muted ? <VolumeX className="w-3.5 h-3.5 text-zinc-500" /> : <Volume2 className="w-3.5 h-3.5 text-zinc-300" />}
          </button>
          
          <button
            onClick={onQuit}
            className="text-[10px] bg-zinc-900 hover:bg-red-950/30 text-zinc-400 hover:text-red-400 px-2 py-1 rounded border border-zinc-800 hover:border-red-900/40 transition font-mono font-bold"
          >
            LEAVE
          </button>
        </div>
      </div>

      {/* Cyber Scoreboard display */}
      <div className="grid grid-cols-3 gap-2 w-full bg-zinc-950/60 p-3 rounded-xl border border-zinc-900/50 text-center mb-4">
        <div>
          <span className="text-[10px] text-cyan-400 block font-bold font-mono tracking-wider">{p1Name.toUpperCase()} (X)</span>
          <span className="text-2xl font-mono font-bold text-white mt-1 block">{scoreX}</span>
        </div>
        <div className="flex flex-col justify-center items-center border-l border-r border-zinc-900">
          <span className="text-[9px] text-zinc-500 font-mono block">TURN TIMER</span>
          <span className={`text-lg font-mono font-bold mt-0.5 ${timeLeft <= 4 ? "text-red-500 animate-ping" : "text-yellow-400"}`}>
            {timeLeft}s
          </span>
        </div>
        <div>
          <span className="text-[10px] text-purple-400 block font-bold font-mono tracking-wider">{p2Name.toUpperCase()} (O)</span>
          <span className="text-2xl font-mono font-bold text-white mt-1 block">{scoreO}</span>
        </div>
      </div>

      {/* Current Turn Notification Bar */}
      <div className="text-xs font-mono mb-4 text-center">
        {!winner ? (
          <span className="text-zinc-400">
            Current turn:{" "}
            <span className={currentTurn === "X" ? "text-cyan-400 font-bold" : "text-purple-400 font-bold"}>
              {currentTurn === "X" ? p1Name : p2Name} ({currentTurn})
            </span>
          </span>
        ) : winner === "draw" ? (
          <span className="text-yellow-400 font-bold animate-pulse">🤝 MATCH ENDED IN A DRAW!</span>
        ) : (
          <span className="text-emerald-400 font-bold animate-pulse">
            🎉 {winner === "X" ? p1Name : p2Name} WINS THE MATCH!
          </span>
        )}
      </div>

      {/* The 3x3 Tic-Tac-Toe Grid Arena */}
      <div className="relative w-[280px] h-[280px] bg-zinc-950 rounded-xl border border-zinc-900 flex flex-col justify-between p-2">
        
        {/* Canvas for Win particles overlay */}
        <canvas
          ref={canvasRef}
          width={320}
          height={320}
          className="absolute inset-0 w-full h-full pointer-events-none z-10"
        />

        {/* 3x3 Grid elements */}
        <div className="grid grid-cols-3 gap-2 w-full h-full">
          {board.map((cell, index) => {
            const isOurSquareActive = isOnline
              ? (currentTurn === "X" && isHost) || (currentTurn === "O" && !isHost)
              : true;

            return (
              <button
                key={index}
                onClick={() => handleSquareClick(index)}
                disabled={!!winner || cell !== ""}
                className={`w-full aspect-square rounded-lg flex items-center justify-center relative font-mono text-4xl font-extrabold transition-all duration-150 border
                  ${
                    cell === ""
                      ? `bg-zinc-900/40 border-zinc-800/80 hover:bg-zinc-900 hover:border-zinc-700 cursor-pointer ${
                          isOurSquareActive ? "hover:scale-[1.03]" : ""
                        }`
                      : cell === "X"
                      ? "bg-cyan-950/20 border-cyan-800 text-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.15)]"
                      : "bg-purple-950/20 border-purple-800 text-purple-400 shadow-[0_0_12px_rgba(192,132,252,0.15)]"
                  }
                `}
              >
                {cell === "X" && (
                  <span className="animate-scale-up text-cyan-400 select-none">✕</span>
                )}
                {cell === "O" && (
                  <span className="animate-scale-up text-purple-400 select-none">◯</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Lobby Control Actions */}
      <div className="w-full flex gap-3 mt-4">
        {(!isOnline || isHost) && (
          <button
            onClick={triggerRestart}
            className="flex-1 flex items-center justify-center gap-1.5 bg-zinc-900 hover:bg-zinc-800 text-white font-mono font-bold text-xs py-2.5 px-4 rounded-lg border border-zinc-800 hover:border-zinc-700 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            RESET BOARD
          </button>
        )}
        {isOnline && !isHost && (
          <div className="flex-1 text-center py-2.5 text-[10px] text-zinc-500 font-mono italic bg-zinc-950 rounded-lg border border-zinc-900">
            Waiting for Host to reset board...
          </div>
        )}
      </div>

      <div className="mt-3.5 text-center text-[9px] text-zinc-600 font-mono flex items-center gap-1">
        <Info className="w-3 h-3 text-zinc-700" />
        Turn timers are set to 15 seconds. If a player runs out of time, a random square is marked!
      </div>
    </div>
  );
}
