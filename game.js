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
  statusText: document.getElementById("statusText")
};

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const TRACK_START = 118;
const TRACK_FINISH = 1064;
const PLAYER_Y = 548;
const ENEMY_Y = 418;

const assets = {
  dojo: loadImage("assets/dojo-track.png"),
  fighter: loadImage("assets/fighter.png"),
  pistol: loadImage("assets/laser-pistol.png")
};

const keys = new Set();
const lastPadButtons = new Map();
let lastTime = performance.now();

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
  bestReaction: null,
  lastReaction: null,
  resultFlash: 0,
  exhausted: false
};

Promise.all(Object.values(assets).map((img) => img.decode().catch(() => null))).then(() => {
  game.phase = "menu";
  setPrompt("Suit Jitsu", "Press Space, Enter, or Xbox A to start.");
  game.message = "Race to the laser pistol. Hold boost carefully.";
  requestAnimationFrame(loop);
});

window.addEventListener("keydown", (event) => {
  keys.add(event.code);
  if (!event.repeat) {
    if (isShootKey(event.code)) handleAction("shoot");
    if (isDodgeKey(event.code)) handleAction("dodge");
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
  update(dt, now);
  draw(now);
  renderHud();
  requestAnimationFrame(loop);
}

function update(dt, now) {
  if (game.phase === "race") updateRace(dt, now);
  if (game.phase === "playerAim" || game.phase === "enemyAim") updateReaction(now);
  if (game.phase === "punch" && now - game.phaseStarted > 1450) nextOpponent();
  if (game.resultFlash > 0) game.resultFlash = Math.max(0, game.resultFlash - dt);
}

function updateRace(dt, now) {
  const boost = isBoosting();
  const basePlayerSpeed = 246 + Math.min(42, game.level * 2);
  const boostSpeed = boost && game.stamina > 0 ? 198 : 0;
  const opponentSpeed = 208 + game.level * 27 + Math.min(70, game.level * 5);

  if (boost && game.stamina > 0) {
    game.stamina -= 42 * dt;
    if (game.stamina <= 0) {
      game.stamina = 0;
      game.exhausted = true;
      die("Exhausted", "You burned your stamina out before the draw.");
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
}

function updateReaction(now) {
  const waiting = now < game.signalAt;
  const active = now >= game.signalAt && now <= game.deadline;

  if (waiting) {
    const remain = Math.ceil((game.signalAt - now) / 1000);
    if (game.phase === "playerAim") {
      setPrompt("Steady", `Shoot after the signal. ${remain}`);
    } else {
      setPrompt("Read The Draw", `Dodge after the signal. ${remain}`);
    }
    return;
  }

  if (active) {
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
    die("Shot", "Too slow. The laser found you first.");
  }
}

function handleAction(action) {
  const now = performance.now();
  if (game.phase === "loading") return;
  if (game.phase === "menu" || game.phase === "gameOver") {
    if (action === "shoot") startRun();
    return;
  }

  if (game.phase === "playerAim" && action === "shoot") {
    if (now < game.signalAt) {
      missShot("False start. Your opponent dodged before the shot.");
      return;
    }
    if (now <= game.deadline) {
      const reaction = Math.round(now - game.signalAt);
      game.lastReaction = reaction;
      game.bestReaction = game.bestReaction === null ? reaction : Math.min(game.bestReaction, reaction);
      beginPunch(now, `Hit in ${reaction} ms.`);
      return;
    }
    missShot("Late shot. Your opponent rolled under it.");
  }

  if (game.phase === "enemyAim" && action === "dodge") {
    if (now < game.signalAt) {
      die("False Dodge", "You moved early and the opponent adjusted.");
      return;
    }
    if (now <= game.deadline) {
      const reaction = Math.round(now - game.signalAt);
      game.lastReaction = reaction;
      game.bestReaction = game.bestReaction === null ? reaction : Math.min(game.bestReaction, reaction);
      game.dodges += 1;
      game.resultFlash = 0.42;
      if (game.dodges >= 3) {
        beginPunch(now, `Third dodge in ${reaction} ms.`);
      } else {
        game.stamina = Math.min(100, game.stamina + 14);
        game.message = `Clean dodge in ${reaction} ms. Race again for the pistol.`;
        setPrompt("Dodged", `${game.dodges}/3 dodges. Race resumes.`, "win");
        game.phase = "raceReset";
        setTimeout(() => resetRace(), 850);
      }
      return;
    }
    die("Shot", "The dodge came too late.");
  }
}

function startRun() {
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
  game.message = `Opponent ${game.level}: reach the pistol first.`;
  clearPrompt();
}

function beginPlayerAim(now) {
  game.phase = "playerAim";
  game.phaseStarted = now;
  game.signalAt = now + randomRange(820, 1750);
  game.reactionWindow = Math.max(250, 760 - game.level * 34);
  game.deadline = game.signalAt + game.reactionWindow;
  game.message = "You grabbed the pistol. Do not shoot before the signal.";
}

function beginEnemyAim(now) {
  game.phase = "enemyAim";
  game.phaseStarted = now;
  game.signalAt = now + randomRange(780, 1680);
  game.reactionWindow = Math.max(270, 860 - game.level * 38);
  game.deadline = game.signalAt + game.reactionWindow;
  game.message = "Opponent has the pistol. Dodge only after the signal.";
}

function missShot(reason) {
  game.shotsLeft -= 1;
  game.resultFlash = 0.5;
  if (game.shotsLeft <= 0) {
    die("Out Of Shots", `${reason} You used all three chances.`);
    return;
  }
  game.stamina = Math.min(100, game.stamina + 10);
  game.message = `${reason} ${game.shotsLeft} shot chance${game.shotsLeft === 1 ? "" : "s"} left.`;
  setPrompt("Miss", "Resetting the race.", "hot");
  game.phase = "raceReset";
  setTimeout(() => resetRace(), 950);
}

function beginPunch(now, text) {
  game.phase = "punch";
  game.phaseStarted = now;
  game.resultFlash = 0.8;
  game.message = `${text} Final punch finishes the duel.`;
  setPrompt("Knockout", "Advancing to the next opponent.", "win");
}

function nextOpponent() {
  game.level += 1;
  game.stamina = Math.min(100, game.stamina + 32);
  startOpponent();
}

function die(title, text) {
  game.phase = "gameOver";
  game.message = text;
  setPrompt(title, `${text} Press Space, Enter, or Xbox A to restart.`, "hot");
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

  if (game.resultFlash > 0) {
    ctx.save();
    ctx.globalAlpha = game.resultFlash * 0.22;
    ctx.fillStyle = game.phase === "gameOver" ? "#ff5f53" : "#f3c56c";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.restore();
  }
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
    const prevA = lastPadButtons.get(`${pad.index}:0`) || false;
    const prevB = lastPadButtons.get(`${pad.index}:1`) || false;
    if (a && !prevA) handleAction("shoot");
    if (b && !prevB) handleAction("dodge");
    lastPadButtons.set(`${pad.index}:0`, a);
    lastPadButtons.set(`${pad.index}:1`, b);
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

function isShootKey(code) {
  return code === "Space" || code === "Enter" || code === "KeyX";
}

function isDodgeKey(code) {
  return code === "ArrowDown" || code === "KeyS" || code === "KeyB";
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
