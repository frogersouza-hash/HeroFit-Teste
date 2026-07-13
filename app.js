import { FilesetResolver, PoseLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/+esm';

const $=id=>document.getElementById(id);
const state=JSON.parse(localStorage.getItem('herofitState')||'{"xp":0,"strength":1,"technique":1,"balance":1,"endurance":1,"trainingDates":[]}');
let stream=null, landmarker=null, running=false, startedAt=0, timerId=null, reps=0, points=0, phase='up', lastVideoTime=-1;
let validPoseFrames=0, invalidPoseFrames=0, currentPoseValid=false;

function save(){localStorage.setItem('herofitState',JSON.stringify(state));renderHero()}
function weekKey(d=new Date()){const x=new Date(d);const day=(x.getDay()+6)%7;x.setDate(x.getDate()-day);return x.toISOString().slice(0,10)}
function renderHero(){
  const level=Math.floor(state.xp/500)+1, inLevel=state.xp%500;
  $('level').textContent=level;$('xp').textContent=state.xp;$('xpBar').style.width=(inLevel/5)+'%';
  $('strength').textContent=state.strength;$('technique').textContent=state.technique;$('balance').textContent=state.balance;$('endurance').textContent=state.endurance;
  $('heroName').textContent=level>=10?'Herói Lendário':level>=5?'Herói Veterano':'Herói Iniciante';
  const currentWeek=weekKey(); const days=new Set(state.trainingDates.filter(x=>x.week===currentWeek).map(x=>x.date));
  $('weekCount').textContent=Math.min(days.size,3);$('weekBar').style.width=Math.min(days.size/3*100,100)+'%';
  const weeks=new Set(state.trainingDates.map(x=>x.week));$('streak').textContent=weeks.has(currentWeek)?1:0;
}
function angle(a,b,c){const ab=Math.atan2(a.y-b.y,a.x-b.x),cb=Math.atan2(c.y-b.y,c.x-b.x);let deg=Math.abs((ab-cb)*180/Math.PI);return deg>180?360-deg:deg}
function draw(lms){const c=$('overlay'),ctx=c.getContext('2d');c.width=$('video').videoWidth;c.height=$('video').videoHeight;ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle='#42d392';for(const p of lms){if((p.visibility??1)>.55){ctx.beginPath();ctx.arc(p.x*c.width,p.y*c.height,4,0,Math.PI*2);ctx.fill()}}}
function fullBodyVisible(lms){
  const required=[11,12,23,24,25,26,27,28];
  const confident=required.every(i=>(lms[i]?.visibility??0)>=0.65);
  if(!confident) return false;
  const top=Math.min(lms[11].y,lms[12].y), bottom=Math.max(lms[27].y,lms[28].y);
  const bodyHeight=bottom-top;
  const hipsInside=lms[23].x>0.03&&lms[23].x<0.97&&lms[24].x>0.03&&lms[24].x<0.97;
  return bodyHeight>=0.42&&hipsInside;
}
function processPose(lms){
  currentPoseValid=fullBodyVisible(lms);
  if(!currentPoseValid){
    invalidPoseFrames++;
    phase='up';
    $('status').textContent='Corpo incompleto. Afaste o celular e mostre ombros, quadris, joelhos e pés.';
    return;
  }
  validPoseFrames++;
  const left=angle(lms[23],lms[25],lms[27]), right=angle(lms[24],lms[26],lms[28]);
  const knee=(left+right)/2;
  $('status').textContent=`Corpo validado · ângulo dos joelhos: ${Math.round(knee)}°`;
  if(knee<100) phase='down';
  if(phase==='down'&&knee>160){
    phase='up'; reps++; points+=10;
    $('reps').textContent=reps; $('points').textContent=points;
    navigator.vibrate?.(80);
  }
}
async function loop(){if(!running)return;const v=$('video');if(landmarker&&v.readyState>=2&&v.currentTime!==lastVideoTime){lastVideoTime=v.currentTime;const r=landmarker.detectForVideo(v,performance.now());if(r.landmarks?.[0]){draw(r.landmarks[0]);processPose(r.landmarks[0])}}requestAnimationFrame(loop)}
async function initPose(){
  if(landmarker)return;
  const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm');
  const options={baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',delegate:'GPU'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.55,minTrackingConfidence:.55};
  try{landmarker=await PoseLandmarker.createFromOptions(vision,options)}
  catch(error){console.warn('GPU indisponível; usando CPU.',error);options.baseOptions.delegate='CPU';landmarker=await PoseLandmarker.createFromOptions(vision,options)}
}
function startClock(){timerId=setInterval(()=>{const s=Math.floor((Date.now()-startedAt)/1000);$('timer').textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');if($('sport').value!=='squat'){points=Math.floor(s/6);$('points').textContent=points}},500)}
$('startBtn').onclick=async()=>{
  try{running=true;startedAt=Date.now();reps=points=0;validPoseFrames=invalidPoseFrames=0;currentPoseValid=false;phase='up';$('reps').textContent=0;$('points').textContent=0;$('startBtn').disabled=true;$('finishBtn').disabled=false;startClock();
    if($('sport').value==='squat'){await initPose();stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:720},height:{ideal:1280}},audio:false});$('video').srcObject=stream;$('cameraMessage').style.display='none';requestAnimationFrame(loop)}else{$('cameraMessage').textContent='Treino por tempo ativo. A câmera não é necessária nesta versão.';$('cameraMessage').style.display='grid';$('status').textContent='Mantenha o treino ativo e finalize quando terminar.'}
  }catch(e){running=false;clearInterval(timerId);$('status').textContent='Não foi possível abrir a câmera. Use HTTPS e permita o acesso.';$('startBtn').disabled=false;$('finishBtn').disabled=true;console.error(e)}
};
$('finishBtn').onclick=()=>{
  running=false; clearInterval(timerId); stream?.getTracks().forEach(t=>t.stop());
  const sport=$('sport').value;
  let earned=0, approved=false, message='';
  if(sport==='squat'){
    const enoughBodyData=validPoseFrames>=20;
    approved=enoughBodyData&&reps>0;
    if(approved){
      earned=points;
      state.xp+=earned;
      state.strength+=Math.max(1,Math.floor(reps/10));
      message=`Treino validado: ${reps} agachamento(s), +${earned} XP.`;
    }else{
      message='Treino não validado: nenhum agachamento completo com o corpo inteiro visível. 0 XP.';
    }
  }else{
    message='Treino registrado, mas 0 XP: esta modalidade ainda precisa de verificação online por um modelo aprovado.';
  }
  if(approved){
    const now=new Date(),date=now.toISOString().slice(0,10);
    if(!state.trainingDates.some(x=>x.date===date)) state.trainingDates.push({date,week:weekKey(now)});
    save();
  }else renderHero();
  $('status').textContent=message;
  $('startBtn').disabled=false; $('finishBtn').disabled=true;
};
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js');renderHero();

// --- Base coletiva: captura sequências anonimizadas de poses ---
const collective = JSON.parse(localStorage.getItem('herofitCollective') || '[]');
let learningStream = null;
function renderDataset(){
  const box=$('datasetList'); if(!box) return;
  box.innerHTML='';
  const groups={}; collective.forEach(x=>{const k=x.trainingName;groups[k]=groups[k]||{correct:0,incorrect:0};groups[k][x.label]++});
  Object.entries(groups).forEach(([name,c])=>{const d=document.createElement('div');d.className='dataset-item';d.innerHTML=`<b>${name}</b><br><span class="badge">${c.correct} corretos</span> <span class="badge">${c.incorrect} incorretos</span>`;box.appendChild(d)});
  if(!collective.length) box.innerHTML='<small>Nenhum exemplo gravado ainda.</small>';
}
function normalizedPose(lms){
  const cx=(lms[23].x+lms[24].x)/2, cy=(lms[23].y+lms[24].y)/2;
  const shoulder=Math.hypot(lms[11].x-lms[12].x,lms[11].y-lms[12].y)||1;
  return lms.map(p=>[+( (p.x-cx)/shoulder ).toFixed(4), +( (p.y-cy)/shoulder ).toFixed(4), +(p.z/shoulder).toFixed(4), +(p.visibility??1).toFixed(3)]);
}
$('recordExampleBtn')?.addEventListener('click',async()=>{
  const name=$('newTrainingName').value.trim();
  if(!name){$('learningStatus').textContent='Digite o nome do movimento.';return}
  if(!$('consentCheck').checked){$('learningStatus').textContent='É necessário confirmar a autorização.';return}
  if($('peopleCount').value==='2'){$('learningStatus').textContent='O modo de duas pessoas exige o modelo multipose do servidor. Neste protótipo, grave uma pessoa por vez.';return}
  try{
    await initPose();
    learningStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:720},height:{ideal:1280}},audio:false});
    $('video').srcObject=learningStream;$('cameraMessage').style.display='none';
    const frames=[];const started=performance.now();$('recordExampleBtn').disabled=true;
    $('learningStatus').textContent='Gravando por 5 segundos... faça o movimento completo.';
    const capture=()=>{
      if(performance.now()-started>=5000){
        learningStream.getTracks().forEach(t=>t.stop());
        const item={id:crypto.randomUUID?.()||String(Date.now()),trainingName:name,sport:$('newTrainingSport').value,label:$('exampleLabel').value,people:1,createdAt:new Date().toISOString(),device:'browser-pwa',schemaVersion:1,frames};
        collective.push(item);localStorage.setItem('herofitCollective',JSON.stringify(collective));renderDataset();$('recordExampleBtn').disabled=false;
        $('learningStatus').textContent=`Exemplo salvo: ${frames.length} quadros corporais. Grave vários ângulos e velocidades.`;return;
      }
      const v=$('video');if(v.readyState>=2){const r=landmarker.detectForVideo(v,performance.now());if(r.landmarks?.[0]){frames.push({t:Math.round(performance.now()-started),pose:normalizedPose(r.landmarks[0])});draw(r.landmarks[0])}}
      requestAnimationFrame(capture);
    };requestAnimationFrame(capture);
  }catch(e){$('recordExampleBtn').disabled=false;$('learningStatus').textContent='Não foi possível gravar. Use HTTPS e permita a câmera.';console.error(e)}
});
$('exportDatasetBtn')?.addEventListener('click',()=>{
  if(!collective.length){$('learningStatus').textContent='Ainda não existem exemplos para exportar.';return}
  const payload={app:'HeroFit',exportedAt:new Date().toISOString(),privacy:'pose-landmarks-only',examples:collective};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='herofit-dataset.json';a.click();URL.revokeObjectURL(a.href);
  $('learningStatus').textContent='Dados exportados. Na versão com servidor, este arquivo será enviado para revisão e treinamento coletivo.';
});
renderDataset();
