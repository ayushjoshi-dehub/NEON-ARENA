import React, { useEffect, useRef, useState } from "react";
import { TennisBall, TennisPaddle } from "../types";
import { RotateCcw, Volume2, VolumeX, LogOut, Award } from "lucide-react";

interface TennisGameProps {
  isOnline: boolean;
  isHost: boolean;
  socket: WebSocket | null;
  p1Name: string;
  p2Name: string;
  onQuit: () => void;
}

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 450;
const PADDLE_WIDTH = 12;
const PADDLE_HEIGHT = 80;
const BALL_RADIUS = 10;
const BASE_BALL_SPEED = 5;

export default function TennisGame({ isOnline, isHost, socket, p1Name, p2Name, onQuit }: TennisGameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Sound effects state
  const [muted, setMuted] = useState(true);

  // Main game scores
  const [p1Score, setP1Score] = useState(0);
  const [p2Score, setP2Score] = useState(0);
  const [winner, setWinner] = useState<string | null>(null);
  const [gameState, setGameState] = useState<"countdown" | "playing" | "finished">("countdown");
  const [countdown, setCountdown] = useState(3);

  // References for live physics rendering loop
  const p1PaddleRef = useRef<TennisPaddle>({
    y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2,
    width: PADDLE_WIDTH,
    height: PADDLE_HEIGHT,
    score: 0,
  });

  const p2PaddleRef = useRef<TennisPaddle>({
    y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2,
    width: PADDLE_WIDTH,
    height: PADDLE_HEIGHT,
    score: 0,
  });

  const ballRef = useRef<TennisBall>({
    x: CANVAS_WIDTH / 2,
    y: CANVAS_HEIGHT / 2,
    vx: BASE_BALL_SPEED,
    vy: BASE_BALL_SPEED / 2,
    radius: BALL_RADIUS,
  });

  const particlesRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; color: string; size: number; alpha: number }>>([]);
  const keysRef = useRef<Record<string, boolean>>({});

  // Audio synthethizer helper
  const playSound = (type: "bounce" | "score" | "start" | "win") => {
    if (muted) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === "bounce") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(320, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.08);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
      } else if (type === "score") {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(220, ctx.currentTime);
        osc.frequency.setValueAtTime(110, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } else if (type === "start") {
        osc.type = "square";
        osc.frequency.setValueAtTime(280, ctx.currentTime);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
      } else if (type === "win") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(261.6, ctx.currentTime); // C
        osc.frequency.setValueAtTime(329.6, ctx.currentTime + 0.1); // E
        osc.frequency.setValueAtTime(392.0, ctx.currentTime + 0.2); // G
        osc.frequency.setValueAtTime(523.3, ctx.currentTime + 0.3); // High C
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      }
    } catch (e) {}
  };

  const spawnParticles = (x: number, y: number, color: string, count = 8) => {
    for (let i = 0; i < count; i++) {
      particlesRef.current.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 5,
        vy: (Math.random() - 0.5) * 5,
        color,
        size: Math.random() * 3 + 1.5,
        alpha: 1,
      });
    }
  };

  // Setup initial countdown
  useEffect(() => {
    let cdInterval: NodeJS.Timeout;
    if (gameState === "countdown") {
      cdInterval = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(cdInterval);
            setGameState("playing");
            playSound("start");
            return 0;
          }
          playSound("start");
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(cdInterval);
  }, [gameState]);

  // Online network state handler
  useEffect(() => {
    if (!isOnline || !socket) return;

    const handleMessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "game:sync") {
          const payload = msg.payload;

          if (payload.action === "p2:input") {
            // Host receives Guest's paddle position
            if (isHost) {
              p2PaddleRef.current.y = payload.y;
            }
          } else if (payload.action === "host:state") {
            // Guest receives state authoritative update from Host
            if (!isHost) {
              p1PaddleRef.current.y = payload.p1.y;
              p2PaddleRef.current.y = payload.p2.y;
              ballRef.current.x = payload.ball.x;
              ballRef.current.y = payload.ball.y;
              ballRef.current.vx = payload.ball.vx;
              ballRef.current.vy = payload.ball.vy;
              
              setP1Score(payload.scores.p1);
              setP2Score(payload.scores.p2);

              if (payload.event === "score") {
                playSound("score");
                spawnParticles(payload.ball.x, payload.ball.y, "#ef4444", 20);
              } else if (payload.event === "resume") {
                setCountdown(2);
                setGameState("countdown");
              } else if (payload.event === "finished") {
                setWinner(payload.winner);
                setGameState("finished");
                playSound("win");
              }
            }
          } else if (payload.action === "reset") {
            resetLocalState();
          }
        }
      } catch (err) {
        console.error("Error reading network sync message:", err);
      }
    };

    socket.addEventListener("message", handleMessage);
    return () => {
      socket.removeEventListener("message", handleMessage);
    };
  }, [isOnline, isHost, socket]);

  // Handle key inputs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = true;
      keysRef.current[e.key] = true;

      if (["ArrowUp", "ArrowDown", " "].includes(e.key)) {
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = false;
      keysRef.current[e.key] = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const resetLocalState = () => {
    p1PaddleRef.current = { y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2, width: PADDLE_WIDTH, height: PADDLE_HEIGHT, score: 0 };
    p2PaddleRef.current = { y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2, width: PADDLE_WIDTH, height: PADDLE_HEIGHT, score: 0 };
    ballRef.current = { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2, vx: BASE_BALL_SPEED, vy: BASE_BALL_SPEED / 2, radius: BALL_RADIUS };
    setP1Score(0);
    setP2Score(0);
    setCountdown(3);
    setGameState("countdown");
    setWinner(null);
    particlesRef.current = [];
  };

  const handleRestart = () => {
    resetLocalState();
    if (isOnline && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "game:sync",
          payload: { action: "reset" },
        })
      );
    }
  };

  const handleScoreScored = (scorer: "P1" | "P2") => {
    playSound("score");

    let currentP1 = p1Score;
    let currentP2 = p2Score;

    if (scorer === "P1") {
      currentP1 = p1Score + 1;
      setP1Score(currentP1);
      p1PaddleRef.current.score = currentP1;
      spawnParticles(CANVAS_WIDTH - 20, ballRef.current.y, "#06b6d4", 15);
    } else {
      currentP2 = p2Score + 1;
      setP2Score(currentP2);
      p2PaddleRef.current.score = currentP2;
      spawnParticles(20, ballRef.current.y, "#c084fc", 15);
    }

    if (currentP1 >= 7 || currentP2 >= 7) {
      const finalWinner = currentP1 >= 7 ? p1Name : p2Name;
      setWinner(finalWinner);
      setGameState("finished");
      playSound("win");

      if (isOnline && isHost && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "game:sync",
            payload: {
              action: "host:state",
              p1: p1PaddleRef.current,
              p2: p2PaddleRef.current,
              ball: ballRef.current,
              scores: { p1: currentP1, p2: currentP2 },
              event: "finished",
              winner: finalWinner,
            },
          })
        );
      }
      return;
    }

    // Reset ball with direction toward the loser
    const shootDir = scorer === "P1" ? -1 : 1;
    ballRef.current = {
      x: CANVAS_WIDTH / 2,
      y: CANVAS_HEIGHT / 2,
      vx: shootDir * BASE_BALL_SPEED,
      vy: (Math.random() - 0.5) * 5,
      radius: BALL_RADIUS,
    };

    setCountdown(2);
    setGameState("countdown");

    if (isOnline && isHost && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "game:sync",
          payload: {
            action: "host:state",
            p1: p1PaddleRef.current,
            p2: p2PaddleRef.current,
            ball: ballRef.current,
            scores: { p1: currentP1, p2: currentP2 },
            event: "resume",
          },
        })
      );
    }
  };

  // Main interactive physics engine
  useEffect(() => {
    let animFrame: number;

    const runEngine = () => {
      const p1 = p1PaddleRef.current;
      const p2 = p2PaddleRef.current;
      const ball = ballRef.current;

      // 1. UPDATE PADDLE 1 (WASD - Local or Host)
      if (!isOnline || isHost) {
        let speed = 6;
        if (keysRef.current["w"] || keysRef.current["W"]) p1.y -= speed;
        if (keysRef.current["s"] || keysRef.current["S"]) p1.y += speed;
        // Keep in bounds
        p1.y = Math.max(10, Math.min(CANVAS_HEIGHT - p1.height - 10, p1.y));
      }

      // 2. UPDATE PADDLE 2 (Arrows - Local or Guest)
      if (!isOnline || !isHost) {
        let speed = 6;
        if (keysRef.current["arrowup"]) p2.y -= speed;
        if (keysRef.current["arrowdown"]) p2.y += speed;
        p2.y = Math.max(10, Math.min(CANVAS_HEIGHT - p2.height - 10, p2.y));

        // Guest sends paddle Y coordinate to Host
        if (isOnline && !isHost && socket && socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              type: "game:sync",
              payload: {
                action: "p2:input",
                y: p2.y,
              },
            })
          );
        }
      }

      // 3. BALL SIMULATION (ONLY IN HOST OR LOCAL MODE)
      if (gameState === "playing" && (!isOnline || isHost)) {
        ball.x += ball.vx;
        ball.y += ball.vy;

        // Bounces off top / bottom wall
        if (ball.y <= ball.radius + 5) {
          ball.y = ball.radius + 5;
          ball.vy = -ball.vy;
          playSound("bounce");
          spawnParticles(ball.x, ball.y, "#94a3b8", 4);
        } else if (ball.y >= CANVAS_HEIGHT - ball.radius - 5) {
          ball.y = CANVAS_HEIGHT - ball.radius - 5;
          ball.vy = -ball.vy;
          playSound("bounce");
          spawnParticles(ball.x, ball.y, "#94a3b8", 4);
        }

        // Hit Left Paddle (P1)
        const paddle1LeftX = 30;
        const paddle1RightX = 30 + PADDLE_WIDTH;
        if (ball.vx < 0 && ball.x - ball.radius <= paddle1RightX && ball.x - ball.radius >= paddle1LeftX) {
          if (ball.y >= p1.y && ball.y <= p1.y + p1.height) {
            // Bounce off left paddle
            ball.x = paddle1RightX + ball.radius;
            
            // Speed up on paddle deflection
            const speedScale = 1.07; // 7% increase
            let deflectionAngle = ((ball.y - (p1.y + p1.height / 2)) / (p1.height / 2)) * (Math.PI / 4); // max 45 degrees
            let curSpeed = Math.hypot(ball.vx, ball.vy) * speedScale;
            
            // Cap max ball speed to avoid visual glitching
            curSpeed = Math.min(curSpeed, 18);

            ball.vx = Math.cos(deflectionAngle) * curSpeed;
            ball.vy = Math.sin(deflectionAngle) * curSpeed;

            playSound("bounce");
            spawnParticles(ball.x, ball.y, "#06b6d4", 10);
          }
        }

        // Hit Right Paddle (P2)
        const paddle2LeftX = CANVAS_WIDTH - 30 - PADDLE_WIDTH;
        const paddle2RightX = CANVAS_WIDTH - 30;
        if (ball.vx > 0 && ball.x + ball.radius >= paddle2LeftX && ball.x + ball.radius <= paddle2RightX) {
          if (ball.y >= p2.y && ball.y <= p2.y + p2.height) {
            // Bounce off right paddle
            ball.x = paddle2LeftX - ball.radius;

            const speedScale = 1.07;
            let deflectionAngle = ((ball.y - (p2.y + p2.height / 2)) / (p2.height / 2)) * (Math.PI / 4);
            let curSpeed = Math.hypot(ball.vx, ball.vy) * speedScale;
            curSpeed = Math.min(curSpeed, 18);

            ball.vx = -Math.cos(deflectionAngle) * curSpeed;
            ball.vy = Math.sin(deflectionAngle) * curSpeed;

            playSound("bounce");
            spawnParticles(ball.x, ball.y, "#c084fc", 10);
          }
        }

        // Scoring boundaries check
        if (ball.x <= 0) {
          handleScoreScored("P2");
        } else if (ball.x >= CANVAS_WIDTH) {
          handleScoreScored("P1");
        }

        // Sync packet to guest
        if (isOnline && isHost && socket && socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              type: "game:sync",
              payload: {
                action: "host:state",
                p1: p1,
                p2: p2,
                ball: ball,
                scores: { p1: p1Score, p2: p2Score },
                event: null,
              },
            })
          );
        }
      }

      // 4. ANIMATION PARTICLES PHYSICS
      particlesRef.current = particlesRef.current
        .map((p) => ({
          ...p,
          x: p.x + p.vx,
          y: p.y + p.vy,
          alpha: p.alpha - 0.03,
        }))
        .filter((p) => p.alpha > 0);

      render();
      animFrame = requestAnimationFrame(runEngine);
    };

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Dark cyber-neon backdrop
      ctx.fillStyle = "#0c0a09"; // warm stone 950
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Center dash net dividing line
      ctx.strokeStyle = "#292524"; // stone 800
      ctx.lineWidth = 4;
      ctx.setLineDash([12, 18]);
      ctx.beginPath();
      ctx.moveTo(CANVAS_WIDTH / 2, 5);
      ctx.lineTo(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 5);
      ctx.stroke();
      ctx.setLineDash([]); // Reset line dash

      const p1 = p1PaddleRef.current;
      const p2 = p2PaddleRef.current;
      const ball = ballRef.current;

      // Draw Paddle 1 (Left Cyan)
      ctx.save();
      ctx.shadowColor = "#06b6d4";
      ctx.shadowBlur = 12;
      ctx.fillStyle = "#06b6d4";
      ctx.fillRect(30, p1.y, PADDLE_WIDTH, p1.height);
      ctx.restore();

      // Draw Paddle 2 (Right Purple)
      ctx.save();
      ctx.shadowColor = "#c084fc";
      ctx.shadowBlur = 12;
      ctx.fillStyle = "#c084fc";
      ctx.fillRect(CANVAS_WIDTH - 30 - PADDLE_WIDTH, p2.y, PADDLE_WIDTH, p2.height);
      ctx.restore();

      // Draw Ball with tail particles
      if (gameState === "playing") {
        // Draw ball trail sparkles
        if (Math.random() < 0.4) {
          spawnParticles(ball.x, ball.y, "#f43f5e", 1); // Rose trail
        }
      }

      ctx.save();
      ctx.shadowColor = "#f43f5e";
      ctx.shadowBlur = 15;
      ctx.fillStyle = "#f43f5e";
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Draw spark particles
      particlesRef.current.forEach((p) => {
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      // Simple grid boundary lines
      ctx.strokeStyle = "#1c1917";
      ctx.lineWidth = 3;
      ctx.strokeRect(5, 5, CANVAS_WIDTH - 10, CANVAS_HEIGHT - 10);
    };

    animFrame = requestAnimationFrame(runEngine);
    return () => cancelAnimationFrame(animFrame);
  }, [gameState, p1Score, p2Score, isOnline, isHost, socket, muted]);

  return (
    <div className="flex flex-col items-center bg-black rounded-2xl overflow-hidden shadow-2xl border border-zinc-800 w-full max-w-4xl p-4 md:p-6" id="tennis-game-arena">
      {/* HUD Header */}
      <div className="flex flex-col md:flex-row md:justify-between items-center w-full mb-4 gap-2 pb-3 border-b border-zinc-800">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-rose-400 to-purple-400 tracking-wider">
            HYPER TABLE TENNIS
          </h2>
          <p className="text-xs text-zinc-400 font-mono">
            🏓 SCORE 7 POINTS TO CLAIM NEON DOMINANCE
          </p>
        </div>

        {/* Live scores */}
        <div className="flex items-center gap-6 bg-zinc-950 px-4 py-2 rounded-lg border border-zinc-800">
          <div className="text-center">
            <span className="block text-xs font-semibold text-cyan-400">{p1Name}</span>
            <span className="font-mono text-lg font-bold text-white">{p1Score}</span>
          </div>
          <div className="text-zinc-700 text-lg font-bold font-mono">:</div>
          <div className="text-center">
            <span className="block text-xs font-semibold text-purple-400">{p2Name}</span>
            <span className="font-mono text-lg font-bold text-white">{p2Score}</span>
          </div>
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-2">
          <button
            id="tennis-mute"
            onClick={() => setMuted(!muted)}
            className="p-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg transition"
          >
            {muted ? <VolumeX className="w-5 h-5 text-red-500" /> : <Volume2 className="w-5 h-5 text-green-500" />}
          </button>
          <button
            id="tennis-quit"
            onClick={onQuit}
            className="flex items-center gap-1.5 px-3 py-2 bg-red-950/40 hover:bg-red-950 text-red-400 border border-red-900 rounded-lg text-sm transition font-medium"
          >
            <LogOut className="w-4 h-4" />
            Quit
          </button>
        </div>
      </div>

      {/* Screen Game Arena Canvas */}
      <div className="relative w-full overflow-hidden bg-zinc-950 border border-zinc-800 rounded-xl">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="w-full h-auto block aspect-[16/9]"
        />

        {/* COUNTDOWN VIEW OVERLAY */}
        {gameState === "countdown" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm z-10">
            <div className="text-center">
              <span className="text-6xl font-black font-mono text-transparent bg-clip-text bg-gradient-to-r from-rose-500 to-yellow-500 animate-pulse">
                {countdown > 0 ? countdown : "SMASH!"}
              </span>
              <p className="text-zinc-400 tracking-wider uppercase mt-4 text-xs font-semibold">
                Serving Neon Orb...
              </p>
            </div>
            <div className="mt-8 grid grid-cols-2 gap-8 max-w-md bg-zinc-900/80 p-4 rounded-xl border border-zinc-800">
              <div className="text-center border-r border-zinc-800 pr-4">
                <span className="block text-cyan-400 font-bold mb-1">{p1Name} Controls</span>
                <span className="inline-block bg-zinc-950 border border-zinc-800 font-mono text-xs text-white px-2.5 py-0.5 rounded mx-0.5">W</span> Up
                <span className="block mt-1"></span>
                <span className="inline-block bg-zinc-950 border border-zinc-800 font-mono text-xs text-white px-2.5 py-0.5 rounded mx-0.5">S</span> Down
              </div>
              <div className="text-center pl-4">
                <span className="block text-purple-400 font-bold mb-1">{p2Name} Controls</span>
                <span className="inline-block bg-zinc-950 border border-zinc-800 font-mono text-xs text-white px-2 py-0.5 rounded mx-0.5">▲</span> Up
                <span className="block mt-1"></span>
                <span className="inline-block bg-zinc-950 border border-zinc-800 font-mono text-xs text-white px-2 py-0.5 rounded mx-0.5">▼</span> Down
              </div>
            </div>
          </div>
        )}

        {/* FINISHED CUP MATCH SCREEN */}
        {gameState === "finished" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md z-10">
            <Award className="w-16 h-16 text-yellow-400 animate-bounce mb-3" />
            <h3 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-pink-500 via-rose-500 to-amber-500 tracking-wider">
              MATCH COMPLETED!
            </h3>
            <p className="text-white text-2xl font-bold mt-2">
              🏆 {winner} Dominates the Table!
            </p>

            <div className="flex gap-8 my-6 bg-zinc-950/80 p-5 rounded-xl border border-zinc-800 min-w-[280px] justify-center items-center">
              <div className="text-center">
                <span className="text-xs text-cyan-400 block mb-1">{p1Name}</span>
                <span className="text-3xl font-mono font-bold text-white">{p1Score}</span>
              </div>
              <div className="text-zinc-600 font-mono font-bold text-lg">vs</div>
              <div className="text-center">
                <span className="text-xs text-purple-400 block mb-1">{p2Name}</span>
                <span className="text-3xl font-mono font-bold text-white">{p2Score}</span>
              </div>
            </div>

            <div className="flex gap-4">
              {(!isOnline || isHost) && (
                <button
                  id="tennis-restart-btn"
                  onClick={handleRestart}
                  className="flex items-center gap-2 bg-gradient-to-r from-rose-500 to-orange-500 hover:from-rose-400 hover:to-orange-400 text-white px-6 py-3 rounded-lg font-bold tracking-wider transition hover:scale-105"
                >
                  <RotateCcw className="w-5 h-5" />
                  REPLAY TOURNAMENT
                </button>
              )}
              {isOnline && !isHost && (
                <div className="text-sm text-zinc-400 italic bg-zinc-900 border border-zinc-800 px-4 py-3 rounded-lg">
                  Waiting for host to restart game...
                </div>
              )}
              <button
                id="tennis-exit-btn"
                onClick={onQuit}
                className="bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-3 rounded-lg font-bold tracking-wider transition"
              >
                BACK TO LOBBY
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 w-full text-center text-xs text-zinc-500 font-sans">
        ⭐ Acceleration: The neon ball accelerates by <span className="text-rose-400 font-bold">7%</span> on every paddle bounce, making it progressively harder to block! Practice angles to serve spin-balls.
      </div>
    </div>
  );
}
