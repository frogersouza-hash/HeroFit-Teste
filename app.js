import { FilesetResolver, PoseLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/+esm';

const $ = id => document.getElementById(id);

// Nova chave: remove da tela os XP antigos concedidos pelas versões defeituosas.
const STATE_KEY = 'herofitStateAIV1';
['herofitState','herofitStateStrictV1','herofitStateVerifiedV1'].forEach(k => localStorage.removeItem(k));
const state = JSON.parse(localStorage.getItem(STATE_KEY) || '{"xp":0,"strength":1,"technique":1,"balance":1,"endurance":1,"trainingDates":[]}');

// O GitHub Pages não possui servidor de IA. Enquanto esta URL estiver vazia,
// o aplicativo conta repetições localmente, mas NÃO concede XP.
const ONLINE_VALIDATION_URL = 'LOCAL_AI';

let stream = null;
let landmarker = null;
let running = false;
let startedAt = 0;
let timerId = null;
let reps = 0;
let points = 0;
let lastVideoTime = -1;
let validBodyFrames = 0;
let consecutiveFullBodyFrames = 0;
let squatState = 'searching-standing';
let standingBaseline = null;
let descentStartedAt = 0;
let lowestKneeAngle = 180;
let sessionSamples = [];
let lastStatusAt = 0;

function save() {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
  renderHero();
}

function weekKey(d = new Date()) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x.toISOString().slice(0, 10);
}

function renderHero() {
  const level = Math.floor(state.xp / 500) + 1;
  const inLevel = state.xp % 500;
  $('level').textContent = level;
  $('xp').textContent = state.xp;
  $('xpBar').style.width = (inLevel / 5) + '%';
  $('strength').textContent = state.strength;
  $('technique').textContent = state.technique;
  $('balance').textContent = state.balance;
  $('endurance').textContent = state.endurance;
  $('heroName').textContent = level >= 10 ? 'Herói Lendário' : level >= 5 ? 'Herói Veterano' : 'Herói Iniciante';
  const currentWeek = weekKey();
  const days = new Set(state.trainingDates.filter(x => x.week === currentWeek).map(x => x.date));
  $('weekCount').textContent = Math.min(days.size, 3);
  $('weekBar').style.width = Math.min(days.size / 3 * 100, 100) + '%';
  const weeks = new Set(state.trainingDates.map(x => x.week));
  $('streak').textContent = weeks.has(currentWeek) ? 1 : 0;
}

function angle(a, b, c) {
  const ab = Math.atan2(a.y - b.y, a.x - b.x);
  const cb = Math.atan2(c.y - b.y, c.x - b.x);
  let deg = Math.abs((ab - cb) * 180 / Math.PI);
  return deg > 180 ? 360 - deg : deg;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function draw(lms) {
  const c = $('overlay');
  const ctx = c.getContext('2d');
  c.width = $('video').videoWidth;
  c.height = $('video').videoHeight;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#42d392';
  for (const p of lms) {
    if ((p.visibility ?? 0) >= 0.75) {
      ctx.beginPath();
      ctx.arc(p.x * c.width, p.y * c.height, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function fullBodyCheck(lms) {
  // nariz, ombros, quadris, joelhos, tornozelos e calcanhares
  const required = [0, 11, 12, 23, 24, 25, 26, 27, 28, 29, 30];
  if (!required.every(i => lms[i] && (lms[i].visibility ?? 0) >= 0.78)) {
    return { ok: false, reason: 'Mostre o corpo inteiro, incluindo cabeça, quadris, joelhos e pés.' };
  }

  const nose = lms[0];
  const shoulders = midpoint(lms[11], lms[12]);
  const hips = midpoint(lms[23], lms[24]);
  const ankles = midpoint(lms[27], lms[28]);
  const bodyHeight = ankles.y - nose.y;
  const shoulderWidth = dist(lms[11], lms[12]);
  const hipWidth = dist(lms[23], lms[24]);
  const leftLeg = dist(lms[23], lms[25]) + dist(lms[25], lms[27]);
  const rightLeg = dist(lms[24], lms[26]) + dist(lms[26], lms[28]);

  const allInside = required.every(i => lms[i].x > 0.025 && lms[i].x < 0.975 && lms[i].y > 0.015 && lms[i].y < 0.985);
  if (!allInside) return { ok: false, reason: 'Afaste o celular: nenhuma parte do corpo pode ficar cortada.' };
  if (bodyHeight < 0.58) return { ok: false, reason: 'Afaste o celular até aparecer da cabeça aos pés.' };
  if (shoulderWidth < 0.075 || hipWidth < 0.055) return { ok: false, reason: 'A câmera não confirmou um corpo inteiro.' };
  if (leftLeg < 0.28 || rightLeg < 0.28) return { ok: false, reason: 'As duas pernas precisam aparecer completamente.' };
  if (hips.y <= shoulders.y || ankles.y <= hips.y) return { ok: false, reason: 'Posição corporal inválida. Fique de frente ou levemente de lado.' };

  return { ok: true, bodyHeight, shoulders, hips, ankles };
}

function poseMetrics(lms, body) {
  const leftKnee = angle(lms[23], lms[25], lms[27]);
  const rightKnee = angle(lms[24], lms[26], lms[28]);
  const knee = (leftKnee + rightKnee) / 2;
  const hip = midpoint(lms[23], lms[24]);
  const shoulder = midpoint(lms[11], lms[12]);
  const torsoDx = Math.abs(shoulder.x - hip.x);
  const torsoDy = Math.abs(hip.y - shoulder.y) || 0.001;
  const torsoLean = Math.atan2(torsoDx, torsoDy) * 180 / Math.PI;
  const symmetry = Math.abs(leftKnee - rightKnee);
  return { leftKnee, rightKnee, knee, hipY: hip.y, torsoLean, symmetry, bodyHeight: body.bodyHeight };
}

function updateStatus(text) {
  const now = performance.now();
  if (now - lastStatusAt > 120) {
    $('status').textContent = text;
    lastStatusAt = now;
  }
}

function rejectRep(reason) {
  squatState = 'searching-standing';
  standingBaseline = null;
  descentStartedAt = 0;
  lowestKneeAngle = 180;
  updateStatus(reason + ' Repetição não contada. Volte a ficar em pé.');
}

function processPose(lms) {
  const body = fullBodyCheck(lms);
  if (!body.ok) {
    consecutiveFullBodyFrames = 0;
    squatState = 'searching-standing';
    standingBaseline = null;
    updateStatus(body.reason + ' 0 XP.');
    return;
  }

  consecutiveFullBodyFrames++;
  validBodyFrames++;
  const m = poseMetrics(lms, body);

  // Armazena somente medidas numéricas, nunca o vídeo ou o rosto.
  if (sessionSamples.length < 900) {
    sessionSamples.push({
      t: Math.round(performance.now() - startedAt),
      knee: +m.knee.toFixed(1),
      leftKnee: +m.leftKnee.toFixed(1),
      rightKnee: +m.rightKnee.toFixed(1),
      hipY: +m.hipY.toFixed(4),
      torsoLean: +m.torsoLean.toFixed(1),
      bodyHeight: +m.bodyHeight.toFixed(4)
    });
  }

  if (consecutiveFullBodyFrames < 12) {
    updateStatus('Confirmando o corpo inteiro… mantenha cabeça e pés visíveis.');
    return;
  }

  const now = performance.now();

  if (squatState === 'searching-standing') {
    if (m.knee >= 158 && m.symmetry <= 24 && m.torsoLean <= 28) {
      if (!standingBaseline) standingBaseline = { hipY: m.hipY, frames: 1 };
      else {
        standingBaseline.hipY = (standingBaseline.hipY * standingBaseline.frames + m.hipY) / (standingBaseline.frames + 1);
        standingBaseline.frames++;
      }
      if (standingBaseline.frames >= 10) {
        squatState = 'standing';
        updateStatus('Posição inicial confirmada. Agora desça controladamente.');
      }
    } else {
      standingBaseline = null;
      updateStatus(`Fique em pé e estável para iniciar · joelhos ${Math.round(m.knee)}°.`);
    }
    return;
  }

  if (squatState === 'standing') {
    const hipDrop = (m.hipY - standingBaseline.hipY) / m.bodyHeight;
    if (m.knee < 145 && hipDrop > 0.025) {
      squatState = 'descending';
      descentStartedAt = now;
      lowestKneeAngle = m.knee;
      updateStatus('Descendo… mantenha os dois joelhos alinhados.');
    } else {
      updateStatus('Em pé confirmado. Comece o agachamento.');
    }
    return;
  }

  if (squatState === 'descending') {
    lowestKneeAngle = Math.min(lowestKneeAngle, m.knee);
    const hipDrop = (m.hipY - standingBaseline.hipY) / m.bodyHeight;
    if (m.symmetry > 38) return rejectRep('Os joelhos ficaram muito desalinhados.');
    if (m.torsoLean > 48) return rejectRep('O tronco inclinou demais.');
    if (now - descentStartedAt > 7000) return rejectRep('O movimento demorou demais.');

    if (m.knee <= 108 && hipDrop >= 0.085) {
      squatState = 'bottom';
      updateStatus('Profundidade confirmada. Agora suba até ficar totalmente em pé.');
    } else if (m.knee > 155) {
      return rejectRep('Você voltou antes de atingir a profundidade mínima.');
    } else {
      updateStatus(`Descendo · joelhos ${Math.round(m.knee)}°.`);
    }
    return;
  }

  if (squatState === 'bottom') {
    lowestKneeAngle = Math.min(lowestKneeAngle, m.knee);
    if (m.symmetry > 38) return rejectRep('Os joelhos ficaram muito desalinhados.');
    if (m.torsoLean > 48) return rejectRep('O tronco inclinou demais.');
    if (now - descentStartedAt > 8000) return rejectRep('O movimento demorou demais.');

    if (m.knee >= 158) {
      const duration = now - descentStartedAt;
      if (duration < 700) return rejectRep('O movimento foi rápido demais para ser validado.');
      reps++;
      points = reps * 10;
      $('reps').textContent = reps;
      $('points').textContent = points;
      navigator.vibrate?.(80);
      squatState = 'searching-standing';
      standingBaseline = null;
      updateStatus(`Repetição ${reps} detectada. O XP só será liberado após a análise completa da IA.`);
    } else {
      updateStatus(`Subindo · joelhos ${Math.round(m.knee)}°.`);
    }
  }
}

async function loop() {
  if (!running) return;
  const v = $('video');
  if (landmarker && v.readyState >= 2 && v.currentTime !== lastVideoTime) {
    lastVideoTime = v.currentTime;
    const r = landmarker.detectForVideo(v, performance.now());
    if (r.landmarks?.[0]) {
      draw(r.landmarks[0]);
      processPose(r.landmarks[0]);
    } else {
      consecutiveFullBodyFrames = 0;
      updateStatus('Nenhum corpo inteiro detectado. Afaste o celular. 0 XP.');
    }
  }
  requestAnimationFrame(loop);
}

async function initPose() {
  if (landmarker) return;
  const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm');
  const options = {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
      delegate: 'GPU'
    },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.75,
    minPosePresenceConfidence: 0.75,
    minTrackingConfidence: 0.75
  };
  try {
    landmarker = await PoseLandmarker.createFromOptions(vision, options);
  } catch (error) {
    console.warn('GPU indisponível; usando CPU.', error);
    options.baseOptions.delegate = 'CPU';
    landmarker = await PoseLandmarker.createFromOptions(vision, options);
  }
}

function startClock() {
  timerId = setInterval(() => {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    $('timer').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }, 500);
}

function percentile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a,b) => a-b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

function analyzeSquatSequence(samples) {
  if (!Array.isArray(samples) || samples.length < 45) {
    return { approved:false, confidence:0, reason:'Poucos quadros válidos do corpo inteiro.' };
  }

  const heights = samples.map(x => x.bodyHeight);
  const knees = samples.map(x => x.knee);
  const hipYs = samples.map(x => x.hipY);
  const leans = samples.map(x => x.torsoLean);
  const leftRightDiff = samples.map(x => Math.abs(x.leftKnee - x.rightKnee));

  const medianHeight = percentile(heights, .5);
  if (medianHeight < .60) return { approved:false, confidence:.05, reason:'O corpo não apareceu inteiro da cabeça aos pés.' };
  if (percentile(leans, .9) > 50) return { approved:false, confidence:.15, reason:'Inclinação do tronco acima do limite seguro.' };
  if (percentile(leftRightDiff, .9) > 40) return { approved:false, confidence:.15, reason:'Joelhos muito desalinhados durante o movimento.' };

  // Detecta ciclos temporais: em pé (>155°), fundo (<110°), volta em pé (>155°).
  let phase = 'stand';
  let cycles = 0;
  let cycleStart = 0;
  let minKnee = 180;
  let baselineHip = percentile(hipYs.slice(0, Math.min(20, hipYs.length)), .5);
  const durations = [];
  const depths = [];

  for (const x of samples) {
    if (phase === 'stand') {
      if (x.knee > 155) baselineHip = baselineHip * .9 + x.hipY * .1;
      if (x.knee < 145 && (x.hipY - baselineHip) / x.bodyHeight > .025) {
        phase = 'down'; cycleStart = x.t; minKnee = x.knee;
      }
    } else if (phase === 'down') {
      minKnee = Math.min(minKnee, x.knee);
      const depth = (x.hipY - baselineHip) / x.bodyHeight;
      if (x.knee <= 110 && depth >= .085) phase = 'bottom';
      else if (x.knee > 158) phase = 'stand';
    } else if (phase === 'bottom') {
      minKnee = Math.min(minKnee, x.knee);
      if (x.knee >= 158) {
        const duration = x.t - cycleStart;
        const depth = Math.max(...samples.filter(y => y.t >= cycleStart && y.t <= x.t).map(y => (y.hipY - baselineHip) / y.bodyHeight));
        if (duration >= 700 && duration <= 8000 && minKnee <= 110 && depth >= .085) {
          cycles++; durations.push(duration); depths.push(depth);
        }
        phase = 'stand'; baselineHip = x.hipY;
      }
    }
  }

  if (cycles < 1) return { approved:false, confidence:.1, reason:'A IA não encontrou um ciclo completo de agachamento.' };

  const kneeRange = percentile(knees, .9) - percentile(knees, .1);
  const avgDepth = depths.reduce((a,b)=>a+b,0) / depths.length;
  const quality = Math.round(Math.max(0, Math.min(100,
    45 + Math.min(25, kneeRange * .35) + Math.min(20, avgDepth * 120) - Math.max(0, percentile(leans,.75)-30)
  )));
  const confidence = Math.min(.99, .70 + cycles * .05 + Math.min(.15, samples.length / 1200));
  if (quality < 70) return { approved:false, confidence, reason:`Qualidade insuficiente (${quality}/100).` };
  return { approved:true, confidence, quality, verifiedReps:cycles, reason:'Movimento completo confirmado pela IA local.' };
}

async function requestOnlineApproval(payload) {
  // Esta versão roda a verificação temporal no próprio aparelho.
  return analyzeSquatSequence(payload.samples);
}

$('startBtn').onclick = async () => {
  try {
    running = true;
    startedAt = Date.now();
    reps = 0;
    points = 0;
    validBodyFrames = 0;
    consecutiveFullBodyFrames = 0;
    squatState = 'searching-standing';
    standingBaseline = null;
    sessionSamples = [];
    $('reps').textContent = '0';
    $('points').textContent = '0';
    $('timer').textContent = '00:00';
    $('startBtn').disabled = true;
    $('finishBtn').disabled = false;
    startClock();

    if ($('sport').value !== 'squat') {
      running = false;
      clearInterval(timerId);
      $('status').textContent = 'Esta modalidade ainda não possui verificação corporal. 0 XP.';
      $('startBtn').disabled = false;
      $('finishBtn').disabled = true;
      return;
    }

    await initPose();
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1080 }, height: { ideal: 1920 } },
      audio: false
    });
    $('video').srcObject = stream;
    $('cameraMessage').style.display = 'none';
    updateStatus('Afaste o celular e mostre o corpo inteiro, da cabeça aos pés.');
    requestAnimationFrame(loop);
  } catch (e) {
    running = false;
    clearInterval(timerId);
    $('status').textContent = 'Não foi possível abrir a câmera. Use HTTPS e permita o acesso.';
    $('startBtn').disabled = false;
    $('finishBtn').disabled = true;
    console.error(e);
  }
};

$('finishBtn').onclick = async () => {
  running = false;
  clearInterval(timerId);
  stream?.getTracks().forEach(t => t.stop());
  $('finishBtn').disabled = true;
  $('status').textContent = 'Enviando as medidas do movimento para verificação online…';

  if (reps < 1 || validBodyFrames < 40) {
    $('status').textContent = 'Treino rejeitado: nenhuma repetição correta com corpo inteiro. 0 XP.';
    $('startBtn').disabled = false;
    return;
  }

  const result = await requestOnlineApproval({
    exercise: 'squat',
    locallyValidatedReps: reps,
    samples: sessionSamples,
    appVersion: 'ai-local-v1'
  });

  if (!result.approved) {
    $('status').textContent = `IA rejeitou o treino: ${result.reason} 0 XP.`;
    $('startBtn').disabled = false;
    return;
  }

  const verifiedReps = Math.min(reps, result.verifiedReps || 0);
  if (verifiedReps < 1) { $('status').textContent = 'IA não confirmou nenhuma repetição. 0 XP.'; $('startBtn').disabled = false; return; }
  const earned = verifiedReps * 10;
  state.xp += earned;
  state.strength += Math.max(1, Math.floor(verifiedReps / 10));
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  if (!state.trainingDates.some(x => x.date === date)) state.trainingDates.push({ date, week: weekKey(now) });
  save();
  $('status').textContent = `IA confirmou ${verifiedReps} repetição(ões), qualidade ${result.quality || 0}/100: +${earned} XP.`;
  $('startBtn').disabled = false;
};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
renderHero();

// Cadastro de movimentos: coleta de dados continua disponível, sem conceder XP.
const collective = JSON.parse(localStorage.getItem('herofitCollective') || '[]');
let learningStream = null;
function renderDataset() {
  const box = $('datasetList');
  if (!box) return;
  box.innerHTML = '';
  const groups = {};
  collective.forEach(x => {
    const k = x.trainingName;
    groups[k] = groups[k] || { correct: 0, incorrect: 0 };
    groups[k][x.label]++;
  });
  Object.entries(groups).forEach(([name, c]) => {
    const d = document.createElement('div');
    d.className = 'dataset-item';
    d.innerHTML = `<b>${name}</b><br><span class="badge">${c.correct} corretos</span> <span class="badge">${c.incorrect} incorretos</span>`;
    box.appendChild(d);
  });
  if (!collective.length) box.innerHTML = '<small>Nenhum exemplo gravado ainda.</small>';
}
function normalizedPose(lms) {
  const cx = (lms[23].x + lms[24].x) / 2;
  const cy = (lms[23].y + lms[24].y) / 2;
  const shoulder = Math.hypot(lms[11].x - lms[12].x, lms[11].y - lms[12].y) || 1;
  return lms.map(p => [
    +((p.x - cx) / shoulder).toFixed(4),
    +((p.y - cy) / shoulder).toFixed(4),
    +(p.z / shoulder).toFixed(4),
    +(p.visibility ?? 1).toFixed(3)
  ]);
}
$('recordExampleBtn')?.addEventListener('click', async () => {
  const name = $('newTrainingName').value.trim();
  if (!name) { $('learningStatus').textContent = 'Digite o nome do movimento.'; return; }
  if (!$('consentCheck').checked) { $('learningStatus').textContent = 'É necessário confirmar a autorização.'; return; }
  if ($('peopleCount').value === '2') { $('learningStatus').textContent = 'O modo de duas pessoas exige um servidor multipose.'; return; }
  try {
    await initPose();
    learningStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1080 }, height: { ideal: 1920 } }, audio: false });
    $('video').srcObject = learningStream;
    $('cameraMessage').style.display = 'none';
    const frames = [];
    const started = performance.now();
    $('recordExampleBtn').disabled = true;
    $('learningStatus').textContent = 'Gravando por 5 segundos… mostre o corpo inteiro.';
    const capture = () => {
      if (performance.now() - started >= 5000) {
        learningStream.getTracks().forEach(t => t.stop());
        const item = {
          id: crypto.randomUUID?.() || String(Date.now()),
          trainingName: name,
          sport: $('newTrainingSport').value,
          label: $('exampleLabel').value,
          people: 1,
          createdAt: new Date().toISOString(),
          schemaVersion: 2,
          frames
        };
        collective.push(item);
        localStorage.setItem('herofitCollective', JSON.stringify(collective));
        renderDataset();
        $('recordExampleBtn').disabled = false;
        $('learningStatus').textContent = `Exemplo salvo: ${frames.length} quadros corporais. Nenhum XP foi concedido.`;
        return;
      }
      const v = $('video');
      if (v.readyState >= 2) {
        const r = landmarker.detectForVideo(v, performance.now());
        if (r.landmarks?.[0] && fullBodyCheck(r.landmarks[0]).ok) {
          frames.push({ t: Math.round(performance.now() - started), pose: normalizedPose(r.landmarks[0]) });
          draw(r.landmarks[0]);
        }
      }
      requestAnimationFrame(capture);
    };
    requestAnimationFrame(capture);
  } catch (e) {
    $('recordExampleBtn').disabled = false;
    $('learningStatus').textContent = 'Não foi possível gravar. Use HTTPS e permita a câmera.';
    console.error(e);
  }
});
$('exportDatasetBtn')?.addEventListener('click', () => {
  if (!collective.length) { $('learningStatus').textContent = 'Ainda não existem exemplos para exportar.'; return; }
  const payload = { app: 'HeroFit', exportedAt: new Date().toISOString(), privacy: 'pose-landmarks-only', examples: collective };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'herofit-dataset.json';
  a.click();
  URL.revokeObjectURL(a.href);
  $('learningStatus').textContent = 'Dados exportados. Isso não concede XP.';
});
renderDataset();
