const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const ui = {
  roundLabel: document.getElementById("roundLabel"),
  staminaValue: document.getElementById("staminaValue"),
  staminaBar: document.getElementById("staminaBar"),
  shotsLabel: document.getElementById("shotsLabel"),
  dodgesLabel: document.getElementById("dodgesLabel"),
  bestLabel: document.getElementById("bestLabel"),
  prompt: document.getElementById("prompt"),
  promptTitle: document.getElementById("promptTitle"),
  promptText: document.getElementById("promptText"),
  statusText: document.getElementById("statusText"),
  boostCue: document.getElementById("boostCue"),
  pauseMenu: document.getElementById("pauseMenu"),
  resumeButton: document.getElementById("resumeButton"),
  musicToggle: document.getElementById("musicToggle"),
  musicVolume: document.getElementById("musicVolume"),
  sfxVolume: document.getElementById("sfxVolume"),
  trackSelect: document.getElementById("trackSelect"),
  audioButton: document.getElementById("audioButton"),
  resultScreen: document.getElementById("resultScreen"),
  resultKicker: document.getElementById("resultKicker"),
  resultTitle: document.getElementById("resultTitle"),
  resultText: document.getElementById("resultText"),
  resultStat: document.getElementById("resultStat"),
  resultImage: document.getElementById("resultImage"),
  resultMeta: document.getElementById("resultMeta"),
  resultOpponent: document.getElementById("resultOpponent"),
  resultBest: document.getElementById("resultBest"),
  resultButton: document.getElementById("resultButton")
};

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const TRACK_START = 118;
const TRACK_FINISH = 1064;
const PLAYER_Y = 548;
const ENEMY_Y = 418;
const PERFECT_BOOST_COST = 50;

const assets = {
  dojo: loadImage("assets/dojo-track.png"),
  title: loadImage("assets/title-screen.png"),
  fighter: loadImage("assets/fighter.png"),
  pistol: loadImage("assets/laser-pistol.png")
};

const keys = new Set();
const lastPadButtons = new Map();
let lastTime = performance.now();
let audioContext = null;

const musicTracks = {
  race: {
    title: "The Footrace",
    src: "assets/Music/The Footrace.mp3"
  },
  shoot: {
    title: "The High Ground Shooting",
    src: "assets/Music/The High Ground Shooting.mp3"
  },
  bullet: {
    title: "Bullet Time Bullets",
    src: "assets/Music/Bullet Time Bullets.mp3"
  },
  lose: {
    title: "The Empty Holster",
    src: "assets/Music/The Empty Holster (Lose).mp3"
  }
};

const resultArtwork = {
  "victory-shot": "assets/results/victory-shot.png",
  "victory-dodge": "assets/results/victory-dodge.png",
  "gameover-shot": "assets/results/gameover-shot.png",
  "gameover-miss": "assets/results/gameover-miss.png"
};

const music = new Audio();
music.loop = true;
music.preload = "auto";

const audioSettings = loadAudioSettings();

const game = {
  phase: "loading",
  level: 1,
  stamina: 100,
  playerX: TRACK_START,
  enemyX: TRACK_START,
  shotsLeft: 3,
  dodges: 0,
  message: "",
  phaseStarted: 0,
  signalAt: 0,
  deadline: 0,
  reactionWindow: 0,
  lastCountdownBeep: null,
  bestReaction: null,
  lastReaction: null,
  resultFlash: 0,
  exhausted: false,
  paused: false,
  pauseStarted: 0,
  pendingRaceResetAt: 0,
  boostCueAt: 0,
  boostCueEnd: 0,
  boostCueHit: false,
  wasBoosting: false,
  boostPromptUntil: 0,
  currentMusicKey: "",
  victoryType: "",
  victoryText: ""
};

initAudioControls();
game.phase = "menu";
setPrompt("Suit Jitsu", "Press Space, Enter, or Xbox A to start.");
game.message = "Race to the laser pistol. Hold boost carefully. Press Esc or P for audio.";
selectMusicForPhase("menu");
requestAnimationFrame(loop);

window.addEventListener("keydown", (event) => {
  if (["Space", "ArrowDown"].includes(event.code)) event.preventDefault();
  if (!event.repeat && isPauseKey(event.code, event.key)) {
    togglePause();
    return;
  }
  keys.add(event.code);
  if (!event.repeat) {
    if (isShootKey(event.code, event.key)) handleAction("shoot");
    if (isDodgeKey(event.code, event.key)) handleAction("dodge");
  }
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.code);
});

function loadImage(src) {
  const img = new Image();
  img.src = src;
  return img;
}

function loop(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;
  pollGamepads();
  if (!game.paused) update(dt, now);
  draw(now);
  renderHud();
  requestAnimationFrame(loop);
}

function update(dt, now) {
  if (game.pendingRaceResetAt && now >= game.pendingRaceResetAt) {
    game.pendingRaceResetAt = 0;
    resetRace();
  }
  if (game.phase === "race") updateRace(dt, now);
  if (game.phase === "playerAim" || game.phase === "enemyAim") updateReaction(now);
  if (game.phase === "punch" && now - game.phaseStarted > 1450) showVictoryScreen();
  if (game.resultFlash > 0) game.resultFlash = Math.max(0, game.resultFlash - dt);
}

function updateRace(dt, now) {
  const boost = isBoosting();
  const boostStarted = boost && !game.wasBoosting;
  const basePlayerSpeed = 246 + Math.min(42, game.level * 2);
  const boostWindowLive = game.level >= 2 && now >= game.boostCueAt && now <= game.boostCueEnd;
  const boostSpeed = boost && game.stamina > 0 ? 166 : 0;
  const opponentSpeed = 214 + game.level * 41 + Math.min(120, game.level * 8);

  if (boostStarted && game.stamina > 0) {
    playMidiSfx(boostWindowLive ? "boostCuePress" : "boostStart");
  }

  if (game.level >= 2 && boostWindowLive && boostStarted && !game.boostCueHit && game.stamina >= PERFECT_BOOST_COST) {
    game.boostCueHit = true;
    game.boostPromptUntil = now + 950;
    game.stamina = Math.max(0, game.stamina - PERFECT_BOOST_COST);
    game.playerX = TRACK_FINISH + 22;
    game.message = "Perfect boost. 50 stamina spent. You vanished to the pistol.";
    playMidiSfx("boost");
    game.wasBoosting = boost;
    beginPlayerAim(now);
    return;
  }

  if (game.level >= 2 && boostWindowLive && boostStarted && !game.boostCueHit && game.stamina < PERFECT_BOOST_COST) {
    game.message = "Perfect Boost needs 50 stamina.";
  }

  if (boost && game.stamina > 0) {
    game.stamina -= (boostWindowLive ? 16 : 42) * dt;
    if (game.stamina <= 0) {
      game.stamina = 0;
      game.exhausted = true;
      game.wasBoosting = boost;
      die("Exhausted", "You burned your stamina out before the draw.", "shot");
      return;
    }
  } else {
    game.stamina = Math.min(100, game.stamina + 8 * dt);
  }

  game.playerX += (basePlayerSpeed + boostSpeed) * dt;
  game.enemyX += opponentSpeed * dt;

  const playerDone = game.playerX >= TRACK_FINISH;
  const enemyDone = game.enemyX >= TRACK_FINISH;

  if (playerDone || enemyDone) {
    if (playerDone && (!enemyDone || game.playerX - TRACK_FINISH >= game.enemyX - TRACK_FINISH)) {
      beginPlayerAim(now);
    } else {
      beginEnemyAim(now);
    }
  }

  game.wasBoosting = boost;
}

function updateReaction(now) {
  const waiting = now < game.signalAt;
  const active = now >= game.signalAt && now <= game.deadline;

  if (waiting) {
    const remain = Math.ceil((game.signalAt - now) / 1000);
    playCountdownBeep(remain);
    if (game.phase === "playerAim") {
      setPrompt("Steady", `Shoot after the signal. ${remain}`);
    } else {
      setPrompt("Read The Draw", `Dodge after the signal. ${remain}`);
    }
    return;
  }

  if (active) {
    playCountdownBeep(0);
    if (game.phase === "playerAim") {
      setPrompt("Shoot", "Press Space or Xbox A now.", "hot");
    } else {
      setPrompt("Dodge", "Press S, Down, or Xbox B now.", "hot");
    }
    return;
  }

  if (game.phase === "playerAim") {
    missShot("Too slow. The opponent slipped the line of fire.");
  } else {
    die("Shot", "Too slow. The laser found you first.", "shot");
  }
}

function handleAction(action) {
  const now = performance.now();
  unlockAudio();
  if (game.phase === "loading") return;
  if (game.paused) return;
  if (game.phase === "victory") {
    if (action === "shoot") nextOpponent();
    return;
  }
  if (game.phase === "menu" || game.phase === "gameOver") {
    if (action === "shoot") startRun();
    return;
  }

  if (game.phase === "playerAim" && action === "shoot") {
    playMidiSfx("shoot");
    if (now < game.signalAt) {
      missShot("False start. Your opponent dodged before the shot.");
      return;
    }
    if (now <= game.deadline) {
      const reaction = Math.round(now - game.signalAt);
      game.lastReaction = reaction;
      game.bestReaction = game.bestReaction === null ? reaction : Math.min(game.bestReaction, reaction);
      beginPunch(now, `Hit in ${reaction} ms.`, "shot");
      return;
    }
    missShot("Late shot. Your opponent rolled under it.");
  }

  if (game.phase === "enemyAim" && action === "dodge") {
    if (now < game.signalAt) {
      die("False Dodge", "You moved early and the opponent adjusted.", "shot");
      return;
    }
    if (now <= game.deadline) {
      playMidiSfx("dodge");
      const reaction = Math.round(now - game.signalAt);
      game.lastReaction = reaction;
      game.bestReaction = game.bestReaction === null ? reaction : Math.min(game.bestReaction, reaction);
      game.dodges += 1;
      game.resultFlash = 0.42;
      if (game.dodges >= 3) {
        beginPunch(now, `Third dodge in ${reaction} ms.`, "dodge");
      } else {
        game.stamina = Math.min(100, game.stamina + 14);
        game.message = `Clean dodge in ${reaction} ms. Race again for the pistol.`;
        setPrompt("Dodged", `${game.dodges}/3 dodges. Race resumes.`, "win");
        game.phase = "raceReset";
        scheduleRaceReset(850);
      }
      return;
    }
    playMidiSfx("shoot");
    die("Shot", "The dodge came too late.", "shot");
  }
}

function startRun() {
  hideResultScreen();
  game.level = 1;
  game.stamina = 100;
  game.bestReaction = null;
  startOpponent();
}

function startOpponent() {
  game.shotsLeft = 3;
  game.dodges = 0;
  resetRace();
}

function resetRace() {
  game.phase = "race";
  game.playerX = TRACK_START;
  game.enemyX = TRACK_START;
  game.phaseStarted = performance.now();
  game.pendingRaceResetAt = 0;
  game.boostCueHit = false;
  game.wasBoosting = isBoosting();
  game.boostPromptUntil = 0;
  if (game.level >= 2) {
    scheduleBoostCue(game.phaseStarted);
    game.message = `Opponent ${game.level}: faster pace. Boost only when signaled.`;
  } else {
    game.boostCueAt = 0;
    game.boostCueEnd = 0;
    game.message = `Opponent ${game.level}: reach the pistol first.`;
  }
  selectMusicForPhase("race");
  clearPrompt();
}

function scheduleBoostCue(startTime) {
  const opponentSpeed = 214 + game.level * 41 + Math.min(120, game.level * 8);
  const opponentFinishMs = ((TRACK_FINISH - TRACK_START) / opponentSpeed) * 1000;
  const safetyLead = Math.min(220, Math.max(80, opponentFinishMs * 0.18));
  const cueWindow = Math.min(430, Math.max(190, opponentFinishMs * 0.24));
  const latestStart = Math.max(90, opponentFinishMs - safetyLead - cueWindow);
  const earliestStart = Math.min(latestStart, Math.max(70, latestStart * 0.42));
  const cueOffset = randomRange(earliestStart, latestStart);

  game.boostCueAt = startTime + cueOffset;
  game.boostCueEnd = Math.min(game.boostCueAt + cueWindow, startTime + opponentFinishMs - safetyLead);
}

function beginPlayerAim(now) {
  game.phase = "playerAim";
  game.phaseStarted = now;
  game.signalAt = now + randomRange(820, 1750);
  game.reactionWindow = Math.max(250, 760 - game.level * 34);
  game.deadline = game.signalAt + game.reactionWindow;
  game.lastCountdownBeep = null;
  game.message = "You grabbed the pistol. Do not shoot before the signal.";
  selectMusicForPhase("shoot");
}

function beginEnemyAim(now) {
  game.phase = "enemyAim";
  game.phaseStarted = now;
  game.signalAt = now + randomRange(780, 1680);
  game.reactionWindow = Math.max(270, 860 - game.level * 38);
  game.deadline = game.signalAt + game.reactionWindow;
  game.lastCountdownBeep = null;
  game.message = "Opponent has the pistol. Dodge only after the signal.";
  selectMusicForPhase("bullet");
}

function missShot(reason) {
  game.shotsLeft -= 1;
  game.resultFlash = 0.5;
  if (game.shotsLeft <= 0) {
    die("Out Of Shots", `${reason} You used all three chances.`, "miss");
    return;
  }
  game.stamina = Math.min(100, game.stamina + 10);
  game.message = `${reason} ${game.shotsLeft} shot chance${game.shotsLeft === 1 ? "" : "s"} left.`;
  setPrompt("Miss", "Resetting the race.", "hot");
  game.phase = "raceReset";
  scheduleRaceReset(950);
}

function beginPunch(now, text, victoryType) {
  game.phase = "punch";
  game.phaseStarted = now;
  game.resultFlash = 0.8;
  game.victoryType = victoryType;
  game.victoryText = text;
  game.message = `${text} Final punch finishes the duel.`;
  setPrompt("Knockout", "Final strike confirmed.", "win");
  playMidiSfx("punch");
}

function nextOpponent() {
  hideResultScreen();
  game.level += 1;
  game.stamina = Math.min(100, game.stamina + 32);
  startOpponent();
}

function die(title, text, type = "shot") {
  game.phase = "gameOver";
  game.message = text;
  clearPrompt();
  showGameOverScreen(type, text);
  selectMusicForPhase("lose");
}

function showVictoryScreen() {
  if (game.phase === "victory") return;
  game.phase = "victory";
  clearPrompt();

  if (game.victoryType === "dodge") {
    showResultScreen({
      className: "victory-dodge",
      kicker: "Victory By Evasion",
      title: "Three Dodges",
      text: "You read every draw, slipped three laser lines, and ended the duel with a final suit-jitsu strike.",
      stat: `${game.victoryText} Best: ${formatReaction(game.bestReaction)}`,
      button: "Next Opponent",
      showStats: false
    });
    return;
  }

  showResultScreen({
    className: "victory-shot",
    kicker: "Victory By Draw",
    title: "Clean Shot",
    text: "You reached the pistol first and fired before the opponent could vanish from the lane.",
    stat: `${game.victoryText} Best: ${formatReaction(game.bestReaction)}`,
    button: "Next Opponent",
    showStats: false
  });
}

function showGameOverScreen(type, reason) {
  if (type === "miss") {
    showResultScreen({
      className: "gameover-miss",
      kicker: "Game Over",
      title: "Empty Holster",
      text: "Three chances were spent and the opponent stayed standing. In Suit Jitsu, hesitation is expensive.",
      stat: reason,
      button: "Restart",
      showStats: true
    });
    return;
  }

  showResultScreen({
    className: "gameover-shot",
    kicker: "Game Over",
    title: "Laser Hit",
    text: "The opponent won the draw and the laser found its mark before you could clear the line.",
    stat: reason,
    button: "Restart",
    showStats: true
  });
}

function showResultScreen({ className, kicker, title, text, stat, button, showStats }) {
  ui.resultScreen.hidden = false;
  ui.resultScreen.className = `result-screen ${className}`;
  ui.resultImage.src = resultArtwork[className] || resultArtwork["victory-shot"];
  ui.resultKicker.textContent = kicker;
  ui.resultTitle.textContent = title;
  ui.resultText.textContent = text;
  ui.resultStat.textContent = stat;
  ui.resultMeta.hidden = !showStats;
  ui.resultOpponent.textContent = `Lost On Opponent: ${game.level}`;
  ui.resultBest.textContent = `Best Reaction: ${formatReaction(game.bestReaction)}`;
  ui.resultButton.textContent = button;
}

function hideResultScreen() {
  ui.resultScreen.hidden = true;
  ui.resultScreen.className = "result-screen";
}

function setPrompt(title, text, tone = "") {
  ui.promptTitle.textContent = title;
  ui.promptText.textContent = text;
  ui.prompt.className = `prompt ${tone}`.trim();
  ui.prompt.style.display = "block";
}

function clearPrompt() {
  ui.prompt.style.display = "none";
  ui.prompt.className = "prompt";
}

function renderHud() {
  ui.roundLabel.textContent = `Opponent ${game.level}`;
  ui.staminaValue.textContent = `${Math.round(game.stamina)}%`;
  ui.staminaBar.style.width = `${Math.max(0, Math.min(100, game.stamina))}%`;
  ui.staminaBar.style.background = game.stamina < 28
    ? "linear-gradient(90deg, #ff5f53, #f3c56c)"
    : "linear-gradient(90deg, #61d66f, #f3c56c)";
  ui.shotsLabel.textContent = `Shots: ${game.shotsLeft}`;
  ui.dodgesLabel.textContent = `Dodges: ${game.dodges}/3`;
  ui.bestLabel.textContent = game.bestReaction === null ? "Best: --" : `Best: ${game.bestReaction} ms`;
  ui.statusText.textContent = game.message || "";

  const now = performance.now();
  const boostLive = game.phase === "race" && game.level >= 2 && now >= game.boostCueAt && now <= game.boostCueEnd;
  const boostHitVisible = now < game.boostPromptUntil;
  ui.boostCue.classList.toggle("visible", boostLive || boostHitVisible);
  ui.boostCue.textContent = boostHitVisible && game.boostCueHit ? "Perfect Boost" : "Boost";
}

function draw(now) {
  drawBackground();
  drawTrackOverlays();
  drawGun();
  drawRunner(game.enemyX, ENEMY_Y, "opponent", now);
  drawRunner(game.playerX, PLAYER_Y, "player", now);
  drawEffects(now);
}

function drawBackground() {
  if (game.phase === "menu" && assets.title.complete) {
    coverImage(assets.title, 0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    return;
  }

  if (assets.dojo.complete) {
    coverImage(assets.dojo, 0, 0, WIDTH, HEIGHT);
  } else {
    ctx.fillStyle = "#211812";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
  ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawTrackOverlays() {
  ctx.save();
  ctx.globalAlpha = 0.92;
  drawLane(ENEMY_Y, "#d44b35", "Opponent");
  drawLane(PLAYER_Y, "#5cc8ff", "Player");

  ctx.strokeStyle = "rgba(248, 243, 231, 0.72)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(TRACK_START, 334);
  ctx.lineTo(TRACK_START, 612);
  ctx.moveTo(TRACK_FINISH, 334);
  ctx.lineTo(TRACK_FINISH, 612);
  ctx.stroke();

  ctx.fillStyle = "rgba(248, 243, 231, 0.8)";
  ctx.font = "700 14px sans-serif";
  ctx.fillText("START", TRACK_START - 26, 322);
  ctx.fillText("PISTOL", TRACK_FINISH - 30, 322);
  ctx.restore();
}

function drawLane(y, color, label) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(TRACK_START, y);
  ctx.lineTo(TRACK_FINISH, y);
  ctx.stroke();

  ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
  ctx.fillRect(TRACK_START - 8, y - 26, 74, 18);
  ctx.fillStyle = color;
  ctx.font = "700 12px sans-serif";
  ctx.fillText(label, TRACK_START - 2, y - 12);
}

function drawGun() {
  if (!["race", "raceReset", "playerAim", "enemyAim"].includes(game.phase)) return;
  const bob = Math.sin(performance.now() / 150) * 4;
  ctx.save();
  ctx.translate(TRACK_FINISH + 8, 470 + bob);
  ctx.shadowColor = "rgba(255, 75, 55, 0.7)";
  ctx.shadowBlur = 18;
  if (assets.pistol.complete) {
    const w = 132;
    const h = w * (assets.pistol.height / assets.pistol.width);
    ctx.drawImage(assets.pistol, -w / 2, -h / 2, w, h);
  } else {
    ctx.fillStyle = "#050505";
    ctx.fillRect(-44, -12, 88, 24);
  }
  ctx.restore();
}

function drawRunner(x, y, type, now) {
  const isPlayer = type === "player";
  const scale = isPlayer ? 0.22 : 0.2;
  const bob = Math.sin(now / 70 + x * 0.02) * 4;
  const stride = Math.sin(now / 85 + x * 0.05) * 6;
  const w = assets.fighter.width * scale;
  const h = assets.fighter.height * scale;

  ctx.save();
  ctx.translate(x, y + bob);
  ctx.shadowColor = isPlayer ? "rgba(92, 200, 255, 0.65)" : "rgba(212, 75, 53, 0.7)";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.beginPath();
  ctx.ellipse(0, 18, 68, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  if (!isPlayer) {
    ctx.filter = "brightness(0.82) saturate(0.9)";
  }

  if (assets.fighter.complete) {
    ctx.rotate(stride * 0.0018);
    ctx.drawImage(assets.fighter, -w * 0.47, -h + 24, w, h);
  } else {
    ctx.fillStyle = isPlayer ? "#111" : "#1b0f0e";
    ctx.fillRect(-25, -100, 50, 100);
  }

  ctx.filter = "none";
  ctx.fillStyle = isPlayer ? "#5cc8ff" : "#d44b35";
  ctx.fillRect(-46, -h - 3, 92, 6);
  ctx.restore();
}

function drawEffects(now) {
  if (game.phase === "playerAim" && now >= game.signalAt) {
    drawReactionArc(TRACK_FINISH - 38, PLAYER_Y - 170, "#ff5f53");
  }
  if (game.phase === "enemyAim" && now >= game.signalAt) {
    drawReactionArc(game.playerX + 40, PLAYER_Y - 150, "#5cc8ff");
  }
  if (game.phase === "punch") {
    const t = Math.min(1, (now - game.phaseStarted) / 1000);
    const punchX = lerp(game.playerX, TRACK_FINISH - 42, t);
    ctx.save();
    ctx.strokeStyle = "rgba(248, 243, 231, 0.9)";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(punchX - 70, PLAYER_Y - 112);
    ctx.lineTo(punchX + 74, ENEMY_Y - 118);
    ctx.stroke();
    ctx.fillStyle = "rgba(243, 197, 108, 0.88)";
    ctx.beginPath();
    ctx.arc(TRACK_FINISH + 10, ENEMY_Y - 115, 38 + Math.sin(now / 60) * 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (game.phase === "race" && game.level >= 2 && game.boostCueAt) {
    drawBoostWindow(now);
  }

  if (game.resultFlash > 0) {
    ctx.save();
    ctx.globalAlpha = game.resultFlash * 0.22;
    ctx.fillStyle = game.phase === "gameOver" ? "#ff5f53" : "#f3c56c";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.restore();
  }
}

function drawBoostWindow(now) {
  const active = now >= game.boostCueAt && now <= game.boostCueEnd;
  const hit = game.boostCueHit && now < game.boostPromptUntil;
  if (!active && !hit) return;

  const progress = active ? clamp((now - game.boostCueAt) / (game.boostCueEnd - game.boostCueAt), 0, 1) : 1;
  ctx.save();
  ctx.globalAlpha = active ? 0.95 : 0.75;
  ctx.strokeStyle = hit ? "rgba(97, 214, 111, 0.96)" : "rgba(243, 197, 108, 0.92)";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(TRACK_START + 10, PLAYER_Y + 36);
  ctx.lineTo(lerp(TRACK_START + 10, TRACK_FINISH - 10, 1 - progress), PLAYER_Y + 36);
  ctx.stroke();
  ctx.restore();
}

function drawReactionArc(x, y, color) {
  const now = performance.now();
  const progress = clamp((now - game.signalAt) / game.reactionWindow, 0, 1);
  ctx.save();
  ctx.strokeStyle = "rgba(0, 0, 0, 0.58)";
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.arc(x, y, 52, -Math.PI / 2, Math.PI * 1.5);
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(x, y, 52, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - progress));
  ctx.stroke();
  ctx.restore();
}

function coverImage(img, x, y, w, h) {
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function pollGamepads() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const pad of pads) {
    if (!pad) continue;
    const a = buttonPressed(pad, 0);
    const b = buttonPressed(pad, 1);
    const menu = buttonPressed(pad, 8) || buttonPressed(pad, 9);
    const prevA = lastPadButtons.get(`${pad.index}:0`) || false;
    const prevB = lastPadButtons.get(`${pad.index}:1`) || false;
    const prevMenu = lastPadButtons.get(`${pad.index}:menu`) || false;
    if (a && !prevA) handleAction("shoot");
    if (b && !prevB) handleAction("dodge");
    if (menu && !prevMenu) togglePause();
    lastPadButtons.set(`${pad.index}:0`, a);
    lastPadButtons.set(`${pad.index}:1`, b);
    lastPadButtons.set(`${pad.index}:menu`, menu);
  }
}

function buttonPressed(pad, index) {
  return Boolean(pad.buttons[index] && pad.buttons[index].pressed);
}

function isBoosting() {
  if (keys.has("ShiftLeft") || keys.has("ShiftRight") || keys.has("ControlLeft") || keys.has("ControlRight")) {
    return true;
  }
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const pad of pads) {
    if (!pad) continue;
    const rt = pad.buttons[7];
    const rb = pad.buttons[5];
    if ((rt && rt.value > 0.35) || (rb && rb.pressed)) return true;
  }
  return false;
}

function isShootKey(code, key = "") {
  return code === "Space" || code === "Enter" || code === "KeyX" || key === " " || key === "Enter" || key.toLowerCase() === "x";
}

function isDodgeKey(code, key = "") {
  return code === "ArrowDown" || code === "KeyS" || code === "KeyB" || key === "ArrowDown" || key.toLowerCase() === "s" || key.toLowerCase() === "b";
}

function isPauseKey(code, key = "") {
  const normalizedKey = key.toLowerCase();
  return code === "Escape" || code === "KeyP" || normalizedKey === "escape" || normalizedKey === "esc" || normalizedKey === "p";
}

function scheduleRaceReset(delayMs) {
  game.pendingRaceResetAt = performance.now() + delayMs;
}

function togglePause(force) {
  if (game.phase === "loading") return;
  const nextPaused = typeof force === "boolean" ? force : !game.paused;
  if (nextPaused === game.paused) return;
  setPaused(nextPaused);
}

function setPaused(paused) {
  const now = performance.now();
  game.paused = paused;
  ui.pauseMenu.hidden = !paused;

  if (paused) {
    game.pauseStarted = now;
  } else {
    const pausedFor = now - game.pauseStarted;
    game.phaseStarted += pausedFor;
    game.signalAt += pausedFor;
    game.deadline += pausedFor;
    game.boostCueAt += pausedFor;
    game.boostCueEnd += pausedFor;
    game.boostPromptUntil += pausedFor;
    if (game.pendingRaceResetAt) game.pendingRaceResetAt += pausedFor;
    game.pauseStarted = 0;
    lastTime = now;
    unlockAudio();
  }
}

function initAudioControls() {
  ui.musicToggle.checked = audioSettings.musicEnabled;
  ui.musicVolume.value = String(Math.round(audioSettings.musicVolume * 100));
  ui.sfxVolume.value = String(Math.round(audioSettings.sfxVolume * 100));
  ui.trackSelect.value = audioSettings.trackKey;

  ui.resumeButton.addEventListener("click", () => setPaused(false));
  ui.audioButton.addEventListener("click", () => togglePause(true));
  ui.resultButton.addEventListener("click", () => {
    if (game.phase === "victory") {
      nextOpponent();
    } else if (game.phase === "gameOver") {
      startRun();
    }
  });
  ui.musicToggle.addEventListener("change", () => {
    audioSettings.musicEnabled = ui.musicToggle.checked;
    applyAudioSettings(true);
  });
  ui.musicVolume.addEventListener("input", () => {
    audioSettings.musicVolume = Number(ui.musicVolume.value) / 100;
    applyAudioSettings(false);
  });
  ui.sfxVolume.addEventListener("input", () => {
    audioSettings.sfxVolume = Number(ui.sfxVolume.value) / 100;
    saveAudioSettings();
  });
  ui.trackSelect.addEventListener("change", () => {
    audioSettings.trackKey = ui.trackSelect.value;
    applyAudioSettings(true);
  });

  applyAudioSettings(false);
}

function loadAudioSettings() {
  const defaults = {
    musicEnabled: true,
    musicVolume: 0.58,
    sfxVolume: 0.74,
    trackKey: "auto"
  };

  try {
    const stored = JSON.parse(localStorage.getItem("suitJitsuAudio") || "null");
    return { ...defaults, ...(stored || {}) };
  } catch {
    return defaults;
  }
}

function saveAudioSettings() {
  try {
    localStorage.setItem("suitJitsuAudio", JSON.stringify(audioSettings));
  } catch {
    // Settings persistence is optional; the game should continue if storage is blocked.
  }
}

function applyAudioSettings(restartTrack) {
  music.volume = clamp(audioSettings.musicVolume, 0, 1);
  saveAudioSettings();

  if (!audioSettings.musicEnabled) {
    music.pause();
    return;
  }

  if (restartTrack) {
    selectMusicForPhase(currentAutoMusicKey());
  } else if (music.src && audioContext) {
    music.play().catch(() => {});
  }
}

function currentAutoMusicKey() {
  if (game.phase === "playerAim" || game.phase === "punch") return "shoot";
  if (game.phase === "enemyAim") return "bullet";
  if (game.phase === "gameOver") return "lose";
  return "race";
}

function selectMusicForPhase(phaseKey) {
  const key = audioSettings.trackKey === "auto" ? phaseKey : audioSettings.trackKey;
  const track = musicTracks[key] || musicTracks.race;
  if (game.currentMusicKey !== key || !music.src) {
    game.currentMusicKey = key;
    music.src = track.src;
  }
  music.volume = clamp(audioSettings.musicVolume, 0, 1);
  if (audioSettings.musicEnabled && audioContext) {
    music.play().catch(() => {});
  }
}

function unlockAudio() {
  if (!audioContext) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (AudioCtor) audioContext = new AudioCtor();
  }
  if (audioContext && audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
  if (audioSettings.musicEnabled && music.src) {
    music.play().catch(() => {});
  }
}

function playMidiSfx(type) {
  if (!audioSettings.sfxVolume) return;
  unlockAudio();
  if (!audioContext) return;

  const now = audioContext.currentTime;
  const volume = clamp(audioSettings.sfxVolume, 0, 1);
  const patterns = {
    shoot: [
      { note: 88, start: 0, duration: 0.07, type: "square", gain: 0.26 },
      { note: 76, start: 0.035, duration: 0.11, type: "sawtooth", gain: 0.18 },
      { note: 40, start: 0, duration: 0.08, type: "triangle", gain: 0.16 }
    ],
    dodge: [
      { note: 67, start: 0, duration: 0.08, type: "triangle", gain: 0.18 },
      { note: 74, start: 0.055, duration: 0.08, type: "triangle", gain: 0.16 },
      { note: 83, start: 0.11, duration: 0.09, type: "triangle", gain: 0.14 }
    ],
    boost: [
      { note: 52, start: 0, duration: 0.08, type: "square", gain: 0.13 },
      { note: 64, start: 0.055, duration: 0.1, type: "square", gain: 0.15 },
      { note: 76, start: 0.13, duration: 0.16, type: "square", gain: 0.18 }
    ],
    boostStart: [
      { note: 45, start: 0, duration: 0.06, type: "sawtooth", gain: 0.11 },
      { note: 57, start: 0.04, duration: 0.08, type: "sawtooth", gain: 0.12 }
    ],
    boostCuePress: [
      { note: 57, start: 0, duration: 0.06, type: "square", gain: 0.14 },
      { note: 69, start: 0.04, duration: 0.08, type: "square", gain: 0.16 }
    ],
    countdownHigh: [
      { note: 76, start: 0, duration: 0.06, type: "square", gain: 0.1 }
    ],
    countdownLow: [
      { note: 64, start: 0, duration: 0.07, type: "triangle", gain: 0.12 },
      { note: 88, start: 0.055, duration: 0.05, type: "square", gain: 0.1 }
    ],
    punch: [
      { note: 36, start: 0, duration: 0.12, type: "triangle", gain: 0.22 },
      { note: 43, start: 0.05, duration: 0.14, type: "square", gain: 0.16 }
    ]
  };

  for (const tone of patterns[type] || []) {
    playTone(now + tone.start, tone.duration, midiToFrequency(tone.note), tone.type, tone.gain * volume);
  }
}

function playCountdownBeep(value) {
  if (game.lastCountdownBeep === value) return;
  game.lastCountdownBeep = value;
  playMidiSfx(value === 0 ? "countdownLow" : "countdownHigh");
}

function playTone(start, duration, frequency, waveType, peakGain) {
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.type = waveType;
  osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peakGain), start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(audioContext.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function midiToFrequency(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function formatReaction(reaction) {
  return reaction === null ? "--" : `${reaction} ms`;
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
